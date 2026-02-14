import type { QualityCheckConfig, QualityCheckResult } from '@maude/shared';

/**
 * Run a single quality check by spawning the configured command.
 */
export async function runQualityCheck(
  check: QualityCheckConfig,
  projectPath: string,
): Promise<QualityCheckResult> {
  const start = Date.now();

  try {
    // Split command respecting quotes
    const parts = check.command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [check.command];
    const cleanParts = parts.map((p) => p.replace(/^["']|["']$/g, ''));

    const proc = Bun.spawn(cleanParts, {
      cwd: projectPath,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, FORCE_COLOR: '0', CI: '1' },
    });

    // Apply timeout
    const timeoutId = setTimeout(() => proc.kill(), check.timeout);

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    clearTimeout(timeoutId);

    return {
      checkId: check.id,
      checkName: check.name,
      checkType: check.type,
      passed: exitCode === 0,
      output: (stdout + '\n' + stderr).trim().slice(0, 5000),
      duration: Date.now() - start,
      exitCode,
    };
  } catch (err) {
    return {
      checkId: check.id,
      checkName: check.name,
      checkType: check.type,
      passed: false,
      output: String(err).slice(0, 2000),
      duration: Date.now() - start,
      exitCode: -1,
    };
  }
}

/**
 * Run all enabled quality checks sequentially.
 */
export async function runAllQualityChecks(
  checks: QualityCheckConfig[],
  projectPath: string,
): Promise<QualityCheckResult[]> {
  const enabledChecks = checks.filter((c) => c.enabled);
  const results: QualityCheckResult[] = [];
  for (const check of enabledChecks) {
    results.push(await runQualityCheck(check, projectPath));
  }
  return results;
}
