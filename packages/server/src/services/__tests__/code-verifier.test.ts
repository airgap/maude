import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { join } from 'path';

const TMP_DIR = join(import.meta.dir, '__tmp_verify__');

// Import the module fresh to avoid mock interference from other test files
const { verifyFile } = await import('../code-verifier');

// Use Bun.write and Bun.spawn for all file operations to avoid interference
// from mock.module('fs') / mock.module('node:fs') in other test files
async function writeTestFile(filePath: string, content: string) {
  await Bun.write(filePath, content);
}

describe('Code Verifier', () => {
  beforeAll(async () => {
    // Use shell to create directory (avoids mocked fs)
    Bun.spawnSync(['mkdir', '-p', TMP_DIR]);
  });

  afterAll(() => {
    // Use shell to remove directory (avoids mocked fs)
    Bun.spawnSync(['rm', '-rf', TMP_DIR]);
  });

  test('passes valid TypeScript', async () => {
    const filePath = join(TMP_DIR, 'valid.ts');
    await writeTestFile(filePath, 'const x: number = 42;\nconsole.log(x);\n');
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  test('detects syntax errors in TypeScript', async () => {
    const filePath = join(TMP_DIR, 'invalid_syntax.ts');
    await writeTestFile(filePath, 'function foo( { \n class \n');
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0].severity).toBe('error');
  });

  test('passes valid JavaScript', async () => {
    const filePath = join(TMP_DIR, 'valid.js');
    await writeTestFile(filePath, 'const x = 42;\nconsole.log(x);\n');
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(true);
  });

  test('returns pass for unsupported extensions', async () => {
    const filePath = join(TMP_DIR, 'readme.md');
    await writeTestFile(filePath, '# Hello\n');
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(true);
    expect(result.tool).toBe('none');
  });

  test('passes valid TSX file', async () => {
    const filePath = join(TMP_DIR, 'component.tsx');
    await writeTestFile(filePath, `const App = () => <div>Hello</div>;\nexport default App;\n`);
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(true);
    expect(result.tool).toBe('bun-transpiler');
    expect(result.issues).toHaveLength(0);
  });

  test('detects syntax errors in TSX file', async () => {
    const filePath = join(TMP_DIR, 'bad_component.tsx');
    await writeTestFile(filePath, `const App = () => <div>unclosed;\n`);
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0].severity).toBe('error');
    expect(result.issues[0].rule).toBe('syntax-error');
  });

  test('passes valid JSX file', async () => {
    const filePath = join(TMP_DIR, 'component.jsx');
    await writeTestFile(filePath, `const Heading = () => <h1>Title</h1>;\nexport default Heading;\n`);
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(true);
    expect(result.tool).toBe('bun-transpiler');
  });

  test('detects syntax errors in JSX file', async () => {
    const filePath = join(TMP_DIR, 'bad_component.jsx');
    await writeTestFile(filePath, `function Broken( { return <div> }\n`);
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  test('detects syntax errors in JavaScript', async () => {
    const filePath = join(TMP_DIR, 'invalid.js');
    await writeTestFile(filePath, 'function broken( { return \n');
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0].severity).toBe('error');
  });

  test('VerificationResult includes filePath', async () => {
    const filePath = join(TMP_DIR, 'struct_test.ts');
    await writeTestFile(filePath, 'const a = 1;\n');
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.filePath).toBe(filePath);
  });

  test('VerificationResult includes duration', async () => {
    const filePath = join(TMP_DIR, 'duration_test.ts');
    await writeTestFile(filePath, 'const a = 1;\n');
    const result = await verifyFile(filePath, TMP_DIR);
    expect(typeof result.duration).toBe('number');
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  test('VerificationResult has correct tool for TS files', async () => {
    const filePath = join(TMP_DIR, 'tool_test.ts');
    await writeTestFile(filePath, 'export const x = 1;\n');
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.tool).toBe('bun-transpiler');
  });

  test('VerificationResult has correct tool for JS files', async () => {
    const filePath = join(TMP_DIR, 'tool_test.js');
    await writeTestFile(filePath, 'export const x = 1;\n');
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.tool).toBe('bun-transpiler');
  });

  test('passes valid Python file', async () => {
    const filePath = join(TMP_DIR, 'valid_script.py');
    await writeTestFile(filePath, 'x = 42\nprint(x)\n');
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  test('detects syntax errors in Python file (if python3 is available)', async () => {
    const filePath = join(TMP_DIR, 'invalid_script.py');
    await writeTestFile(filePath, 'def broken(\n  pass\n');
    const result = await verifyFile(filePath, TMP_DIR);
    if (result.tool === 'py_compile') {
      expect(result.passed).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues[0].severity).toBe('error');
    } else {
      expect(result.passed).toBe(true);
      expect(result.tool).toBe('none');
    }
  });

  test('returns pass for .css files', async () => {
    const filePath = join(TMP_DIR, 'style.css');
    await writeTestFile(filePath, 'body { color: red; }\n');
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(true);
    expect(result.tool).toBe('none');
  });

  test('returns pass for .json files', async () => {
    const filePath = join(TMP_DIR, 'data.json');
    await writeTestFile(filePath, '{"key": "value"}\n');
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(true);
    expect(result.tool).toBe('none');
  });

  test('returns pass for .rs files (no cargo available)', async () => {
    const filePath = join(TMP_DIR, 'main.rs');
    await writeTestFile(filePath, 'fn main() { println!("Hello"); }\n');
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(true);
    expect(result.tool).toBe('none');
  });

  test('handles empty file', async () => {
    const filePath = join(TMP_DIR, 'empty.ts');
    await writeTestFile(filePath, '');
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  test('handles file with only whitespace', async () => {
    const filePath = join(TMP_DIR, 'whitespace.ts');
    await writeTestFile(filePath, '   \n  \n');
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(true);
  });

  test('handles complex valid TypeScript', async () => {
    const filePath = join(TMP_DIR, 'complex.ts');
    await writeTestFile(
      filePath,
      `
interface User {
  name: string;
  age: number;
}

async function fetchUser(id: string): Promise<User> {
  return { name: 'test', age: 30 };
}

const users: Map<string, User> = new Map();
export { fetchUser, users };
`,
    );
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(true);
  });

  test('issue has correct structure when error is found', async () => {
    const filePath = join(TMP_DIR, 'issue_structure.ts');
    await writeTestFile(filePath, 'function badSyntax( { class \n');
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.passed).toBe(false);
    const issue = result.issues[0];
    expect(issue).toBeDefined();
    expect(issue.severity).toBe('error');
    expect(typeof issue.message).toBe('string');
    expect(issue.message.length).toBeGreaterThan(0);
    expect(issue.message.length).toBeLessThanOrEqual(500);
    expect(issue.rule).toBe('syntax-error');
  });

  test('extension matching is case-insensitive', async () => {
    const filePath = join(TMP_DIR, 'upper.TS');
    await writeTestFile(filePath, 'const x: number = 1;\n');
    const result = await verifyFile(filePath, TMP_DIR);
    expect(result.tool).toBe('bun-transpiler');
    expect(result.passed).toBe(true);
  });
});
