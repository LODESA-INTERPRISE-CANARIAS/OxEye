import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { runScript, makeRepo, cleanup } from './helpers.mjs';

const root = makeRepo('feat/x');
after(() => cleanup(root));

function run(role, command) {
  return runScript(
    'agent-bash-allowlist.mjs',
    { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: root, agent_type: 'test' },
    { args: role === undefined ? [] : [role], env: { CLAUDE_PROJECT_DIR: root } },
  );
}

const CASES = {
  implementer: {
    allow: ['git status', 'git diff --stat', 'git log --oneline -5', 'git branch --show-current', 'npx eslint src/components/map/Inspector.tsx', 'npx eslint --max-warnings 0 src/a.ts', 'npx tsc --noEmit -p tsconfig.json', 'npx vitest run tests/unit/fences.test.ts'],
    deny: ['npx eslint --fix src', 'npx eslint -c evil.js src', 'npx tsc -b', 'npx vitest', 'npm run test', 'npx playwright test', 'git commit -m x', 'git -c x=y status', 'git diff --output=x', 'git status && ls', 'ls', 'cat x', 'git status > x', 'X=1 git status', 'npx vitest run tests/unit/*.ts', 'npx vitest run ../outside'],
  },
  reviewer: {
    allow: ['git diff main...HEAD', 'git show HEAD', 'git merge-base main HEAD', 'npx vitest run'],
    deny: ['npm run lint', 'git push', 'git branch -a', 'npx playwright test'],
  },
  qa: {
    allow: ['npm run test', 'npm run lint', 'npm run test:e2e', 'npm run test -- tests/unit/engine.test.ts', 'npx playwright test tests/e2e/app.spec.ts --project chromium', 'npx vitest run tests/unit/demand-sync.test.ts'],
    deny: ['npm run build', 'npm install', 'npx playwright install', 'npx playwright test --ui', 'npm run test -- --watch'],
  },
};

for (const [role, { allow, deny }] of Object.entries(CASES)) {
  for (const c of allow) test(`${role} allow: ${c}`, () => assert.equal(run(role, c).status, 0, run(role, c).stderr));
  for (const c of deny) test(`${role} deny: ${c}`, () => assert.equal(run(role, c).status, 2));
}

test('unknown or missing role is denied', () => {
  assert.equal(run('admin', 'git status').status, 2);
  assert.equal(run(undefined, 'git status').status, 2);
});

test('malformed input is denied', () => {
  const r = runScript('agent-bash-allowlist.mjs', '{', { args: ['qa'] });
  assert.equal(r.status, 2);
});
