import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

const TMP_DIR = join(import.meta.dir, '__tmp_verify__');

// Import the module fresh to avoid mock interference from other test files
const { verifyFile } = await import('../code-verifier');

describe('Code Verifier', () => {
  beforeAll(() => {
    mkdirSync(TMP_DIR, { recursive: true });
  });

  afterAll(() => {
    rmSync(TMP_DIR, { recursive: true, force: true });
  });

  test('passes valid TypeScript', async () => {
    const filePath = join(TMP_DIR, 'valid.ts');
    writeFileSync(filePath, 'const x: number = 42;\nconsole.log(x);\n');
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  test('detects syntax errors in TypeScript', async () => {
    const filePath = join(TMP_DIR, 'invalid.ts');
    writeFileSync(filePath, 'const x: number = ;\n');
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0].severity).toBe('error');
  });

  test('passes valid JavaScript', async () => {
    const filePath = join(TMP_DIR, 'valid.js');
    writeFileSync(filePath, 'const x = 42;\nconsole.log(x);\n');
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(true);
  });

  test('returns pass for unsupported extensions', async () => {
    const filePath = join(TMP_DIR, 'readme.md');
    writeFileSync(filePath, '# Hello\n');
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(true);
    expect(result.tool).toBe('none');
  });
});
