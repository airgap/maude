// ---------------------------------------------------------------------------
// Golem Runner — core execution logic for headless golem runs
// ---------------------------------------------------------------------------
// Orchestrates the full lifecycle: clone → install → agent → checks → commit → push → report
// ---------------------------------------------------------------------------

import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { existsSync } from 'fs';
import type {
  GolemSpec,
  GolemRunStatus,
  GolemRunPhase,
  GolemExitCodeValue,
  QualityCheckConfig,
  QualityCheckResult,
  StoryResultReport,
} from '@e/shared';
import { GolemExitCode, GOLEM_DEFAULTS } from '@e/shared';
import { GolemLogger } from './logger.js';
import { GolemHealthServer } from './health.js';
import { CoordinatorClient } from './coordinator-client.js';
import {
  shallowClone,
  createBranch,
  commitChanges,
  pushBranch,
  configureGitUser,
  hasChanges,
} from './git-ops.js';

/**
 * Result of a golem run.
 */
export interface GolemRunResult {
  exitCode: GolemExitCodeValue;
  branchName: string | null;
  commitSha: string | null;
  qualityResults: QualityCheckResult[];
  agentOutput: string;
  error: string | null;
  duration: number;
}

/**
 * Headless golem runner — drives a single story execution end-to-end.
 */
export class GolemRunner {
  private spec: GolemSpec;
  private logger: GolemLogger;
  private healthServer: GolemHealthServer | null = null;
  private coordinator: CoordinatorClient | null = null;
  private phase: GolemRunPhase = 'initializing';
  private startTime = Date.now();
  private workDir = '';
  private branchName: string;
  private commitSha: string | null = null;
  private qualityResults: QualityCheckResult[] = [];
  private agentOutput = '';
  private cancelled = false;
  private active = true;
  private logLines: string[] = [];

  constructor(spec: GolemSpec) {
    this.spec = spec;
    this.branchName = `${GOLEM_DEFAULTS.branchPrefix}${spec.story.storyId}`;

    // Resolve executor ID
    if (!spec.executorId) {
      spec.executorId = `golem-${crypto.randomUUID().slice(0, 8)}`;
    }

    // Resolve machine ID
    if (!spec.machineId) {
      spec.machineId = this.getHostname();
    }

    this.logger = new GolemLogger(spec.executorId, spec.story.storyId);
  }

  /**
   * Run the full golem execution lifecycle.
   * Returns an exit code reflecting the result.
   */
  async run(): Promise<GolemRunResult> {
    const startTime = Date.now();

    try {
      // --- Initialize ---
      this.setPhase('initializing');
      this.logger.info('init', 'Headless golem starting', {
        storyId: this.spec.story.storyId,
        repoUrl: this.spec.repoUrl,
        branch: this.spec.branch,
        model: this.spec.llm.model,
        executorId: this.spec.executorId,
        machineId: this.spec.machineId,
      });

      // Connect WebSocket for log streaming if configured
      if (this.spec.logStreamUrl) {
        this.logger.connectWebSocket(this.spec.logStreamUrl);
      }

      // Start health check server
      const healthPort = this.spec.healthPort ?? GOLEM_DEFAULTS.healthPort;
      if (healthPort > 0) {
        this.healthServer = new GolemHealthServer(() => this.getStatus());
        const actualPort = this.healthServer.start(healthPort);
        this.logger.info('init', `Health server listening on port ${actualPort}`);
      }

      // Initialize coordinator client if URL provided
      if (this.spec.coordinatorUrl) {
        this.coordinator = new CoordinatorClient(this.spec.coordinatorUrl, this.logger);
      }

      // --- Claim story from coordinator (if connected) ---
      if (this.coordinator) {
        await this.claimStory();
      }

      // --- Clone repository ---
      this.setPhase('cloning');
      this.workDir = this.spec.workDir || (await mkdtemp(join(tmpdir(), 'golem-')));
      const cloneTarget = this.spec.workDir ? this.workDir : join(this.workDir, 'repo');
      if (!this.spec.workDir) {
        await shallowClone(this.spec.repoUrl, this.spec.branch, cloneTarget, this.logger);
        this.workDir = cloneTarget;
      }

      if (this.cancelled) return this.cancelledResult(startTime);

      // Configure git user for commits
      await configureGitUser(this.workDir);

      // Create result branch
      await createBranch(this.workDir, this.branchName, this.logger);

      // --- Install dependencies ---
      this.setPhase('installing');
      await this.installDependencies();

      if (this.cancelled) return this.cancelledResult(startTime);

      // --- Start heartbeat ---
      if (this.coordinator) {
        this.coordinator.startHeartbeat(
          this.spec.story.storyId,
          this.spec.executorId!,
          GOLEM_DEFAULTS.heartbeatIntervalMs,
        );
      }

      // --- Run agent loop ---
      this.setPhase('running_agent');
      const timeoutMs = this.spec.timeoutMs ?? GOLEM_DEFAULTS.timeoutMs;
      const agentResult = await this.runAgent(timeoutMs);

      if (this.cancelled) return this.cancelledResult(startTime);

      if (agentResult.timedOut) {
        // Handle timeout — commit WIP and report
        this.logger.warn('agent', 'Agent timed out');
        await this.commitWipAndPush(startTime, 'timeout');
        return {
          exitCode: GolemExitCode.TIMEOUT,
          branchName: this.branchName,
          commitSha: this.commitSha,
          qualityResults: [],
          agentOutput: agentResult.output,
          error: `Agent timed out after ${timeoutMs}ms`,
          duration: Date.now() - startTime,
        };
      }

      if (agentResult.error) {
        this.logger.error('agent', `Agent error: ${agentResult.error}`);
      }

      // --- Run quality checks ---
      this.setPhase('running_checks');
      const checks = this.spec.qualityChecks?.filter((c) => c.enabled) ?? [];
      if (checks.length > 0) {
        this.qualityResults = await this.runQualityChecks(checks);
      }

      // Determine outcome
      const requiredChecksFailed = this.qualityResults.some((qr) => {
        const checkConfig = checks.find((c) => c.id === qr.checkId);
        return checkConfig?.required && !qr.passed;
      });

      const hasError = !!agentResult.error;
      let exitCode: GolemExitCodeValue;
      let resultStatus: StoryResultReport['status'];

      if (hasError && agentResult.error?.includes('timed out')) {
        exitCode = GolemExitCode.TIMEOUT;
        resultStatus = 'timeout';
      } else if (hasError || requiredChecksFailed) {
        exitCode = GolemExitCode.STORY_FAILURE;
        resultStatus = 'failure';
      } else {
        exitCode = GolemExitCode.SUCCESS;
        resultStatus = 'success';
      }

      // --- Commit and push ---
      const autoCommit = this.spec.autoCommit !== false;
      const autoPush = this.spec.autoPush !== false;

      if (autoCommit && (await hasChanges(this.workDir))) {
        this.setPhase('committing');
        const msg = exitCode === GolemExitCode.SUCCESS
          ? `feat: implement ${this.spec.story.title}\n\nStory: ${this.spec.story.storyId}\nGolem: ${this.spec.executorId}`
          : `wip: partial implementation of ${this.spec.story.title}\n\nStory: ${this.spec.story.storyId}\nGolem: ${this.spec.executorId}\nStatus: ${resultStatus}`;

        this.commitSha = await commitChanges(this.workDir, msg, this.logger);
      }

      if (autoPush && this.commitSha) {
        this.setPhase('pushing');
        try {
          await pushBranch(this.workDir, this.branchName, this.logger, true);
        } catch (err) {
          this.logger.error('push', `Push failed: ${String(err)}`);
          // Push failure is not fatal — the work is still committed locally
        }
      }

      // --- Report result to coordinator ---
      this.setPhase('reporting');
      if (this.coordinator) {
        await this.reportResult(resultStatus, agentResult.output, agentResult.error);
      }

      // --- Done ---
      this.setPhase(exitCode === GolemExitCode.SUCCESS ? 'completed' : 'failed');
      this.active = false;

      const passedCount = this.qualityResults.filter((qr) => qr.passed).length;
      this.logger.info('report', `Execution complete: ${resultStatus}`, {
        exitCode,
        duration: Date.now() - startTime,
        qualityChecks: `${passedCount}/${this.qualityResults.length} passed`,
        branchName: this.branchName,
        commitSha: this.commitSha,
      });

      return {
        exitCode,
        branchName: this.branchName,
        commitSha: this.commitSha,
        qualityResults: this.qualityResults,
        agentOutput: agentResult.output,
        error: agentResult.error,
        duration: Date.now() - startTime,
      };
    } catch (err) {
      // Infrastructure failure
      const errMsg = String(err);
      this.logger.fatal(this.phase as any, `Infrastructure failure: ${errMsg}`);
      this.active = false;
      this.setPhase('failed');

      // Try to report failure to coordinator
      if (this.coordinator) {
        try {
          await this.reportResult('failure', '', errMsg);
        } catch {
          // Best effort
        }
      }

      return {
        exitCode: GolemExitCode.INFRA_FAILURE,
        branchName: null,
        commitSha: null,
        qualityResults: [],
        agentOutput: '',
        error: errMsg,
        duration: Date.now() - startTime,
      };
    } finally {
      this.cleanup();
    }
  }

  /**
   * Handle graceful shutdown (SIGTERM).
   * Commits work-in-progress, pushes partial branch, reports cancellation.
   */
  async shutdown(): Promise<void> {
    if (this.cancelled) return;
    this.cancelled = true;
    this.logger.info('shutdown', 'Graceful shutdown initiated (SIGTERM)');

    try {
      await this.commitWipAndPush(this.startTime, 'cancelled');
    } catch (err) {
      this.logger.error('shutdown', `Shutdown cleanup failed: ${String(err)}`);
    }

    this.active = false;
    this.setPhase('cancelled');
  }

  /**
   * Get the current run status.
   */
  getStatus(): GolemRunStatus {
    return {
      phase: this.phase,
      storyId: this.spec.story.storyId,
      executorId: this.spec.executorId!,
      startedAt: new Date(this.startTime).toISOString(),
      elapsedMs: Date.now() - this.startTime,
      qualityResults: this.qualityResults,
      active: this.active,
      branchName: this.branchName,
      commitSha: this.commitSha ?? undefined,
      error: undefined,
    };
  }

  // --- Private methods ---

  private setPhase(phase: GolemRunPhase): void {
    this.phase = phase;
  }

  private getHostname(): string {
    try {
      const proc = Bun.spawnSync(['hostname'], { stdout: 'pipe', stderr: 'pipe' });
      return proc.stdout.toString().trim() || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /**
   * Claim a story from the coordinator.
   */
  private async claimStory(): Promise<void> {
    if (!this.coordinator) return;

    this.logger.info('init', 'Claiming story from coordinator', {
      storyId: this.spec.story.storyId,
      coordinatorUrl: this.spec.coordinatorUrl,
    });

    const result = await this.coordinator.claimStory({
      storyId: this.spec.story.storyId,
      executorId: this.spec.executorId!,
      executorType: 'headless-golem',
      machineId: this.spec.machineId!,
      assignedBranch: this.branchName,
    });

    if (!result.claimed) {
      throw new Error(`Failed to claim story: ${result.reason}`);
    }

    this.logger.info('init', 'Story claimed successfully', {
      leaseExpiresAt: result.leaseExpiresAt,
    });
  }

  /**
   * Install dependencies in the working directory.
   */
  private async installDependencies(): Promise<void> {
    const packageJsonPath = join(this.workDir, 'package.json');
    if (!existsSync(packageJsonPath)) {
      this.logger.info('install', 'No package.json found, skipping dependency installation');
      return;
    }

    const nodeModulesPath = join(this.workDir, 'node_modules');
    if (existsSync(nodeModulesPath)) {
      this.logger.info('install', 'node_modules already exists, skipping install');
      return;
    }

    this.logger.info('install', 'Installing dependencies...');

    // Detect package manager
    const hasLockBun = existsSync(join(this.workDir, 'bun.lock')) || existsSync(join(this.workDir, 'bun.lockb'));
    const hasLockNpm = existsSync(join(this.workDir, 'package-lock.json'));
    const hasLockYarn = existsSync(join(this.workDir, 'yarn.lock'));
    const hasLockPnpm = existsSync(join(this.workDir, 'pnpm-lock.yaml'));

    let cmd: string[];
    if (hasLockBun) {
      cmd = ['bun', 'install', '--frozen-lockfile'];
    } else if (hasLockPnpm) {
      cmd = ['pnpm', 'install', '--frozen-lockfile'];
    } else if (hasLockYarn) {
      cmd = ['yarn', 'install', '--frozen-lockfile'];
    } else if (hasLockNpm) {
      cmd = ['npm', 'ci'];
    } else {
      cmd = ['bun', 'install'];
    }

    const proc = Bun.spawn(cmd, {
      cwd: this.workDir,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, FORCE_COLOR: '0', CI: '1' },
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    if (exitCode !== 0) {
      const output = (stdout + '\n' + stderr).trim();
      this.logger.error('install', `Dependency installation failed (exit ${exitCode}): ${output.slice(0, 1000)}`);
      throw new Error(`Dependency installation failed: ${output.slice(0, 500)}`);
    }

    this.logger.info('install', 'Dependencies installed successfully');
  }

  /**
   * Run the Claude agent to implement the story.
   */
  private async runAgent(timeoutMs: number): Promise<{ output: string; error: string | null; timedOut: boolean }> {
    const prompt = this.buildPrompt();
    this.logger.info('agent', 'Starting agent execution', {
      model: this.spec.llm.model,
      timeoutMs,
      promptLength: prompt.length,
    });

    // Resolve API key
    const apiKey = this.spec.llm.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      // Try Claude Code OAuth credentials
      try {
        const { readFileSync } = await import('fs');
        const { join: pathJoin } = await import('path');
        const { homedir: getHome } = await import('os');
        const credPath = pathJoin(getHome(), '.claude', '.credentials.json');
        const creds = JSON.parse(readFileSync(credPath, 'utf-8'));
        const oauthToken = creds?.claudeAiOauth?.accessToken;
        if (!oauthToken) {
          throw new Error('No API key or OAuth token found');
        }
        return this.runClaudeAgent(prompt, oauthToken, 'oauth', timeoutMs);
      } catch {
        throw new Error(
          'No Anthropic API key found. Set ANTHROPIC_API_KEY env var or provide llm.apiKey in spec.',
        );
      }
    }

    return this.runClaudeAgent(prompt, apiKey, 'api-key', timeoutMs);
  }

  /**
   * Execute the agent via the Anthropic Messages API (streaming).
   */
  private async runClaudeAgent(
    prompt: string,
    token: string,
    tokenType: 'api-key' | 'oauth',
    timeoutMs: number,
  ): Promise<{ output: string; error: string | null; timedOut: boolean }> {
    const model = this.spec.llm.model || GOLEM_DEFAULTS.model;
    const systemPrompt = this.spec.llm.systemPrompt || this.buildSystemPrompt();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    };

    if (tokenType === 'api-key') {
      headers['x-api-key'] = token;
    } else {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const body = {
      model,
      max_tokens: 16384,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }],
      stream: true,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const apiUrl = process.env.ANTHROPIC_API_URL || 'https://api.anthropic.com/v1/messages';
      const resp = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const text = await resp.text();
        return {
          output: '',
          error: `Anthropic API error (${resp.status}): ${text.slice(0, 1000)}`,
          timedOut: false,
        };
      }

      // Read SSE stream
      let output = '';
      const reader = resp.body?.getReader();
      if (!reader) {
        return { output: '', error: 'No response body', timedOut: false };
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        if (this.cancelled) {
          reader.cancel();
          return { output, error: 'Execution cancelled', timedOut: false };
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;

            try {
              const event = JSON.parse(data);
              if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
                output += event.delta.text;
              }
            } catch {
              // Ignore malformed SSE lines
            }
          }
        }
      }

      this.agentOutput = output;
      this.logger.info('agent', 'Agent execution completed', { outputLength: output.length });
      return { output, error: null, timedOut: false };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return { output: this.agentOutput, error: `Agent timed out after ${timeoutMs}ms`, timedOut: true };
      }
      return { output: '', error: String(err), timedOut: false };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Run quality checks on the working directory.
   */
  private async runQualityChecks(checks: QualityCheckConfig[]): Promise<QualityCheckResult[]> {
    const results: QualityCheckResult[] = [];

    for (const check of checks) {
      this.logger.info('quality_check', `Running check: ${check.name} (${check.command})`);

      const start = Date.now();

      try {
        const parts = check.command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [check.command];
        const cleanParts = parts.map((p) => p.replace(/^["']|["']$/g, ''));

        const proc = Bun.spawn(cleanParts, {
          cwd: this.workDir,
          stdout: 'pipe',
          stderr: 'pipe',
          env: { ...process.env, FORCE_COLOR: '0', CI: '1' },
        });

        let timedOut = false;
        const timeoutId = setTimeout(() => {
          timedOut = true;
          proc.kill();
        }, check.timeout);

        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
        clearTimeout(timeoutId);

        const rawOutput = (stdout + '\n' + stderr).trim();
        const passed = exitCode === 0;

        const result: QualityCheckResult = {
          checkId: check.id,
          checkName: check.name,
          checkType: check.type,
          passed,
          output: rawOutput.slice(0, 15000),
          duration: Date.now() - start,
          exitCode: exitCode ?? -1,
          timedOut,
          storyId: this.spec.story.storyId,
        };

        results.push(result);

        this.logger.info('quality_check', `Check ${check.name}: ${passed ? 'PASSED' : 'FAILED'}`, {
          exitCode,
          duration: result.duration,
          timedOut,
        });
      } catch (err) {
        results.push({
          checkId: check.id,
          checkName: check.name,
          checkType: check.type,
          passed: false,
          output: String(err).slice(0, 5000),
          duration: Date.now() - start,
          exitCode: -1,
          storyId: this.spec.story.storyId,
        });

        this.logger.error('quality_check', `Check ${check.name} threw: ${String(err)}`);
      }
    }

    this.qualityResults = results;
    return results;
  }

  /**
   * Build the prompt for the agent from the story spec.
   */
  private buildPrompt(): string {
    const story = this.spec.story;
    const criteria = story.acceptanceCriteria.map((ac, i) => `${i + 1}. ${ac}`).join('\n');

    let prompt = `## User Story: ${story.title}

${story.description}

## Acceptance Criteria
${criteria}
`;

    if (story.attempt !== undefined && story.maxAttempts !== undefined) {
      prompt += `\n## Attempt ${story.attempt} of ${story.maxAttempts}`;
    }

    if (story.learnings && story.learnings.length > 0) {
      prompt += '\n\n## Learnings from Previous Attempts\n';
      for (const learning of story.learnings) {
        prompt += `- ${learning}\n`;
      }
      prompt += '\nPlease address these issues in this attempt. Do not repeat the same mistakes.';
    }

    const qualityChecks = this.spec.qualityChecks?.filter((c) => c.enabled) ?? [];
    if (qualityChecks.length > 0) {
      prompt += '\n\n## Quality Checks That Will Run';
      for (const qc of qualityChecks) {
        prompt += `\n- **${qc.name}** (${qc.type}${qc.required ? ', required' : ''}): \`${qc.command}\``;
      }
      prompt += '\n\nMake sure your changes pass these checks before completion.';
    }

    return prompt;
  }

  /**
   * Build the system prompt for the agent.
   */
  private buildSystemPrompt(): string {
    return `You are an autonomous AI agent implementing user stories for a software project.

## Instructions
1. Read the user story carefully, including all acceptance criteria
2. Implement the story completely — make all necessary code changes
3. Ensure every acceptance criterion is met
4. Follow existing project conventions and patterns
5. Write clean, well-structured code
6. Do NOT ask questions — make reasonable decisions and document them
7. After implementation, the system will automatically run quality checks
8. IMPORTANT: Before declaring you are done, run the project's typecheck/build commands yourself to catch errors early
9. If this is a monorepo, ensure your changes maintain type compatibility across packages (especially shared types)`;
  }

  /**
   * Commit work-in-progress and push partial branch.
   */
  private async commitWipAndPush(startTime: number, reason: string): Promise<void> {
    if (!this.workDir || !existsSync(this.workDir)) return;

    try {
      if (await hasChanges(this.workDir)) {
        this.setPhase('committing');
        const msg = `wip: partial work on ${this.spec.story.title}\n\nStory: ${this.spec.story.storyId}\nReason: ${reason}\nGolem: ${this.spec.executorId}`;
        this.commitSha = await commitChanges(this.workDir, msg, this.logger);

        if (this.spec.autoPush !== false && this.commitSha) {
          this.setPhase('pushing');
          try {
            await pushBranch(this.workDir, this.branchName, this.logger, true);
          } catch {
            // Push failure during shutdown is non-fatal
          }
        }
      }

      // Report to coordinator
      if (this.coordinator) {
        this.setPhase('reporting');
        const status = reason === 'timeout' ? 'timeout' : 'cancelled';
        await this.reportResult(status as StoryResultReport['status'], this.agentOutput, reason);
      }
    } catch (err) {
      this.logger.error('shutdown', `WIP commit/push failed: ${String(err)}`);
    }
  }

  /**
   * Report execution result to the coordinator.
   */
  private async reportResult(
    status: StoryResultReport['status'],
    agentOutput: string,
    error: string | null,
  ): Promise<void> {
    if (!this.coordinator) return;

    try {
      const report: StoryResultReport = {
        executorId: this.spec.executorId!,
        status,
        branchName: this.branchName,
        commitSha: this.commitSha ?? undefined,
        logs: this.logLines,
        durationMs: Date.now() - this.startTime,
        qualityResults: this.qualityResults,
        agentOutput: agentOutput.slice(0, 50000),
        agentError: error ?? undefined,
      };

      this.coordinator.stopHeartbeat();
      const result = await this.coordinator.reportResult(this.spec.story.storyId, report);

      this.logger.info('report', 'Result reported to coordinator', {
        accepted: result.accepted,
        newStatus: result.newStatus,
        mergeTriggered: result.mergeTriggered,
      });
    } catch (err) {
      this.logger.error('report', `Failed to report result: ${String(err)}`);
    }
  }

  /**
   * Create a cancelled result.
   */
  private cancelledResult(startTime: number): GolemRunResult {
    return {
      exitCode: GolemExitCode.STORY_FAILURE,
      branchName: this.branchName,
      commitSha: this.commitSha,
      qualityResults: this.qualityResults,
      agentOutput: this.agentOutput,
      error: 'Execution cancelled',
      duration: Date.now() - startTime,
    };
  }

  /**
   * Clean up resources.
   */
  private cleanup(): void {
    if (this.coordinator) {
      this.coordinator.dispose();
    }
    if (this.healthServer) {
      this.healthServer.stop();
    }
    this.logger.close();
  }
}
