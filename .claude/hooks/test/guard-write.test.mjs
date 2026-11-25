import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runScript, makeRepo, setBranch, writePlan, approve, cleanup } from './helpers.mjs';

const root = makeRepo('main');
fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
after(() => cleanup(root));

function write(file, { tool = 'Write', branch, key = 'file_path' } = {}) {
  if (branch !== undefined) setBranch(root, branch);
  const tool_input = { [key]: file, content: 'x' };
  return runScript('guard-write.mjs', { hook_event_name: 'PreToolUse', tool_name: tool, tool_input, cwd: root }, { env: { CLAUDE_PROJECT_DIR: root } });
}
const p = (...xs) => path.join(root, ...xs);

test('protected paths are denied in every spelling', () => {
  setBranch(root, 'main');
  for (const f of [
    p('CLAUDE.md'),
    p('claude.md'),
    path.join(root, '.', 'CLAUDE.md'),
    `${root}\\.\\CLAUDE.md`,
    p('CLAUDE.md.'),
    `${p('CLAUDE.md')}::$DATA`,
    p('.claude', 'settings.json'),
    p('.CLAUDE', 'settings.local.json'),
    p('.git', 'claude-oxeye', 'approvals.json'),
    p('.git', 'hooks', 'pre-push'),
    p('.github', 'workflows', 'deploy-pages.yml'),
    p('.mcp.json'),
    p('src', 'CLAUDE.md'),
    p('src', 'node_modules', 'x.js'),
    p('.gitignore'),
    p('CLAUDE~1.MD'),
    p('src', '..', '.claude', 'x'),
    root,
  ]) {
    const r = write(f);
    assert.equal(r.status, 2, `${f}: ${r.stderr}`);
  }
});

test('junction into a protected directory is denied', () => {
  const link = p('src', 'lnk');
  try {
    fs.symlinkSync(p('.claude'), link, 'junction');
  } catch {
    return; // junctions unavailable: skip
  }
  assert.equal(write(path.join(link, 'settings.json')).status, 2);
});

test('outside the repository: only scratchpad and memory', () => {
  assert.equal(write(path.join(os.tmpdir(), 'claude', 'sess', 'scratchpad', 'f.txt')).status, 0);
  assert.equal(write(path.join(os.homedir(), '.claude', 'projects', 'proj', 'memory', 'm.md')).status, 0);
  assert.equal(write(path.join(os.homedir(), '.claude', 'projects', 'proj', 'other.md')).status, 2);
  assert.equal(write(path.join(os.homedir(), '.gitconfig')).status, 2);
  assert.equal(write(path.join(os.homedir(), '.claude', 'settings.json')).status, 2);
  assert.equal(write(path.join(root, '..', 'outside.txt')).status, 2);
  assert.equal(write('\\\\server\\share\\x').status, 2);
});

test('plan files are writable on main; source files are not', () => {
  assert.equal(write(p('doc', 'specs', '2026-11-25-new-plan.md'), { branch: 'main' }).status, 0);
  assert.equal(write(p('src', 'a.ts'), { branch: 'main' }).status, 2);
  assert.equal(write(p('doc', 'specs', 'notes.md'), { branch: 'main' }).status, 2);
});

test('feature branch without approval is denied', () => {
  assert.equal(write(p('src', 'a.ts'), { branch: 'feat/no-approval' }).status, 2);
});

test('approved plan allows only its listed paths, and the plan is frozen', () => {
  writePlan(root, 'alpha', { branch: 'feat/alpha', allowed: ['- `src/a.ts`', '- `src/dir/**`'] });
  const a = approve(root, 'alpha');
  assert.match(a.stdout, /Approval recorded/);
  assert.equal(write(p('src', 'a.ts'), { branch: 'feat/alpha' }).status, 0);
  assert.equal(write(p('SRC', 'A.ts'), { branch: 'feat/alpha' }).status, process.platform === 'win32' ? 0 : 2);
  assert.equal(write(p('src', 'dir', 'deep', 'x.ts'), { branch: 'feat/alpha' }).status, 0);
  assert.equal(write(p('src', 'b.ts'), { branch: 'feat/alpha' }).status, 2);
  assert.equal(write(p('src', 'dir2', 'x.ts'), { branch: 'feat/alpha' }).status, 2);
  assert.equal(write(p('src', 'a.ts'), { branch: 'feat/other' }).status, 2);
  assert.equal(write(p('doc', 'specs', '2026-11-25-alpha.md'), { branch: 'feat/alpha' }).status, 2);
  assert.equal(write(p('.claude', 'x'), { branch: 'feat/alpha' }).status, 2);
  assert.equal(write(p('src', 'a.ts'), { branch: 'feat/alpha', tool: 'NotebookEdit', key: 'notebook_path' }).status, 0);
});

test('tampered plan invalidates the approval', () => {
  writePlan(root, 'beta', { branch: 'feat/beta', allowed: ['- `src/a.ts`'] });
  approve(root, 'beta');
  assert.equal(write(p('src', 'a.ts'), { branch: 'feat/beta' }).status, 0);
  fs.appendFileSync(p('doc', 'specs', '2026-11-25-beta.md'), '- `src/b.ts`\n');
  const r = write(p('src', 'a.ts'), { branch: 'feat/beta' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /plan changed since approval/);
});

test('detached HEAD and unknown branch patterns are denied', () => {
  assert.equal(write(p('src', 'a.ts'), { branch: null }).status, 2);
  assert.equal(write(p('src', 'a.ts'), { branch: 'mapa-y-perimetros' }).status, 2);
});

test('malformed input fails closed', () => {
  const env = { env: { CLAUDE_PROJECT_DIR: root } };
  assert.equal(runScript('guard-write.mjs', 'x', env).status, 2);
  assert.equal(runScript('guard-write.mjs', { tool_name: 'Write', tool_input: {} }, env).status, 2);
  assert.equal(runScript('guard-write.mjs', { tool_name: 'Write', tool_input: { file_path: '' } }, env).status, 2);
  assert.equal(runScript('guard-write.mjs', { tool_name: 'Bash', tool_input: { file_path: p('src', 'a.ts') } }, env).status, 2);
  assert.equal(runScript('guard-write.mjs', { tool_name: 'Write', tool_input: { file_path: p('src', 'a.ts') } }, { env: { CLAUDE_PROJECT_DIR: os.tmpdir() } }).status, 2);
});

test('malformed approval state is treated as no approval', () => {
  writePlan(root, 'gamma', { branch: 'feat/gamma', allowed: ['- `src/a.ts`'] });
  approve(root, 'gamma');
  fs.writeFileSync(p('.git', 'claude-oxeye', 'approvals.json'), '{not json');
  assert.equal(write(p('src', 'a.ts'), { branch: 'feat/gamma' }).status, 2);
});
