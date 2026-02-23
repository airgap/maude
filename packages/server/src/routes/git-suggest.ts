/**
 * AI-powered commit staging suggestions.
 *
 * Analyzes git diffs and groups changed files into logical commit groups,
 * each with a suggested commit message.
 */

import { Hono } from 'hono';
import { resolve } from 'path';
import { callLlm } from '../services/llm-oneshot';

const app = new Hono();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function run(
  args: string[],
  opts: { cwd: string },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(args, {
    cwd: opts.cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

function validateWorkspacePath(rawPath: string): {
  valid: boolean;
  resolved: string;
  reason?: string;
} {
  const resolved = resolve(rawPath);
  const blockedPrefixes = ['/proc', '/sys', '/dev', '/boot', '/sbin'];
  for (const prefix of blockedPrefixes) {
    if (resolved.startsWith(prefix)) {
      return { valid: false, resolved, reason: `Path ${prefix} is not a valid workspace` };
    }
  }
  return { valid: true, resolved };
}

// ---------------------------------------------------------------------------
// POST /suggest-commit-groups
// ---------------------------------------------------------------------------

export interface CommitGroup {
  name: string;
  message: string;
  files: string[];
  reason: string;
}

app.post('/suggest-commit-groups', async (c) => {
  const body = await c.req.json();
  const { path: rootPath } = body;

  if (!rootPath) return c.json({ ok: false, error: 'path required' }, 400);

  const pathCheck = validateWorkspacePath(rootPath);
  if (!pathCheck.valid) {
    return c.json({ ok: false, error: pathCheck.reason }, 403);
  }

  try {
    // Get status of all changed files
    const statusResult = await run(['git', 'status', '--porcelain', '-uall'], {
      cwd: pathCheck.resolved,
    });

    if (!statusResult.stdout.trim()) {
      return c.json({ ok: false, error: 'No changes to group' }, 400);
    }

    // Parse file list from porcelain output
    const changedFiles: string[] = [];
    for (const line of statusResult.stdout.trim().split('\n')) {
      if (!line.trim()) continue;
      // porcelain format: "XY filename" or "XY orig -> renamed"
      const file = line.slice(3).split(' -> ').pop()?.trim();
      if (file) changedFiles.push(file);
    }

    if (changedFiles.length === 0) {
      return c.json({ ok: false, error: 'No changed files found' }, 400);
    }

    // If there's only 1-2 files, just return a single group
    if (changedFiles.length <= 2) {
      const diffResult = await run(['git', 'diff', 'HEAD'], { cwd: pathCheck.resolved });
      let diffText = diffResult.stdout.trim();
      if (diffText.length > 8_000) {
        diffText = diffText.slice(0, 8_000) + '\n... [truncated]';
      }

      // Generate a message for the single group
      const message = await callLlm({
        system:
          'You generate concise git commit messages. Output ONLY the commit message, nothing else. ' +
          'Use the imperative mood. Keep it to one line, under 72 characters.',
        user: `Git diff:\n\`\`\`\n${diffText}\n\`\`\``,
        timeoutMs: 30_000,
      });

      return c.json({
        ok: true,
        data: {
          groups: [
            {
              name: 'All changes',
              message: message.trim(),
              files: changedFiles,
              reason: 'All changed files grouped together',
            },
          ],
        },
      });
    }

    // Gather per-file diffs (abbreviated)
    const fileDiffs: string[] = [];
    let totalDiffLen = 0;
    const MAX_TOTAL_DIFF = 16_000;
    const MAX_PER_FILE = 2_000;

    for (const file of changedFiles) {
      if (totalDiffLen > MAX_TOTAL_DIFF) {
        fileDiffs.push(`--- ${file}\n[diff omitted due to length]`);
        continue;
      }

      // Try staged diff first, then unstaged
      let diffResult = await run(['git', 'diff', '--cached', '--', file], {
        cwd: pathCheck.resolved,
      });
      if (!diffResult.stdout.trim()) {
        diffResult = await run(['git', 'diff', '--', file], { cwd: pathCheck.resolved });
      }
      if (!diffResult.stdout.trim()) {
        // Untracked file — show filename only
        fileDiffs.push(`--- ${file}\n[new untracked file]`);
        continue;
      }

      let diff = diffResult.stdout;
      if (diff.length > MAX_PER_FILE) {
        diff = diff.slice(0, MAX_PER_FILE) + '\n... [truncated]';
      }
      fileDiffs.push(`--- ${file}\n${diff}`);
      totalDiffLen += diff.length;
    }

    const prompt = fileDiffs.join('\n\n');

    const llmResult = await callLlm({
      system: `You analyze git diffs and group changed files into logical atomic commits for code review.

RULES:
- Each group should contain related files that work toward one feature, fix, or refactoring
- Every file in the input must appear in exactly one group
- Each group needs a concise commit message (imperative mood, under 72 chars)
- Provide a brief reason for each grouping

Respond with ONLY valid JSON — no markdown fences, no explanation outside the JSON:
[
  {
    "name": "Short group name",
    "message": "feat: commit message here",
    "files": ["path/to/file1.ts", "path/to/file2.ts"],
    "reason": "These files implement the new X feature"
  }
]`,
      user: `Group these ${changedFiles.length} changed files into logical commit groups:\n\n${prompt}`,
      timeoutMs: 60_000,
    });

    // Parse LLM response
    let groups: CommitGroup[];
    try {
      // Strip markdown fences if present
      let cleaned = llmResult.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }
      groups = JSON.parse(cleaned);

      // Validate structure
      if (!Array.isArray(groups)) {
        throw new Error('Expected array');
      }

      // Ensure every file is accounted for
      const assignedFiles = new Set(groups.flatMap((g) => g.files));
      const missing = changedFiles.filter((f) => !assignedFiles.has(f));
      if (missing.length > 0) {
        // Add a catch-all group for missed files
        groups.push({
          name: 'Other changes',
          message: 'chore: miscellaneous changes',
          files: missing,
          reason: 'Files not covered by other groups',
        });
      }
    } catch (parseErr) {
      console.error('[git/suggest-commit-groups] Failed to parse LLM response:', parseErr);
      // Fallback: single group with all files
      groups = [
        {
          name: 'All changes',
          message: 'chore: update files',
          files: changedFiles,
          reason: 'Could not parse AI grouping suggestion',
        },
      ];
    }

    return c.json({ ok: true, data: { groups } });
  } catch (err) {
    console.error('[git/suggest-commit-groups] Error:', err);
    return c.json({ ok: false, error: String(err) }, 500);
  }
});

export const gitSuggestRoutes = app;
