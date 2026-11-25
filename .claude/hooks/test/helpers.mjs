// Test helpers: run a hook script as Claude Code would (JSON on stdin) and
// build throwaway fixture repositories under the OS temp directory.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HOOKS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function runScript(script, stdin, { args = [], env = {} } = {}) {
  const r = spawnSync(process.execPath, [path.join(HOOKS, script), ...args], {
    input: typeof stdin === 'string' ? stdin : JSON.stringify(stdin),
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 15000,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

export function makeRepo(branch = 'main') {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'oxeye-hooktest-')));
  fs.mkdirSync(path.join(root, '.git'));
  fs.mkdirSync(path.join(root, 'doc', 'specs'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  setBranch(root, branch);
  return root;
}

export function setBranch(root, branch) {
  const head = branch === null ? '0123456789abcdef0123456789abcdef01234567\n' : `ref: refs/heads/${branch}\n`;
  fs.writeFileSync(path.join(root, '.git', 'HEAD'), head);
}

export function writePlan(root, slug, { branch = `feat/${slug}`, allowed = ['- `src/a.ts`'], date = '2026-11-25', extra = '' } = {}) {
  const rel = `doc/specs/${date}-${slug}.md`;
  const text = [
    `# Plan ${slug}`,
    '',
    `- Slug: \`${slug}\``,
    `- Branch: \`${branch}\``,
    '',
    extra,
    '## Allowed paths',
    '',
    ...allowed,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(root, rel), text);
  return rel;
}

export function approve(root, slug, prompt = `APPROVE IMPLEMENTATION ${slug}`) {
  return runScript('approval-token.mjs', { hook_event_name: 'UserPromptSubmit', prompt, cwd: root }, { env: { CLAUDE_PROJECT_DIR: root } });
}

export function readState(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, '.git', 'claude-oxeye', 'approvals.json'), 'utf8'));
  } catch {
    return null;
  }
}

export function sha256(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

export function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true });
}
