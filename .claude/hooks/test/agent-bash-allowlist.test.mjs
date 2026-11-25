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
    allow: [
      'git status', 'git diff --stat', 'git log --oneline -5', 'git branch --show-current', 'git grep -n foo',
      'npx eslint src/components/map/Inspector.tsx', 'npx eslint --max-warnings 0 src/a.ts', 'npx tsc --noEmit -p tsconfig.json',
      'npx vitest run tests/unit/fences.test.ts', 'npx vitest run tests/unit/*.test.ts', 'npm run test', 'npm run build',
      'npx playwright test tests/e2e/visual-palettes.spec.ts -g workspace', 'git status && ls', 'ls', 'cat x',
      'grep -rn foo src | head -5', 'npx tsc --noEmit -p tsconfig.json 2>&1 | tail -20', 'npm run lint > /dev/null; echo done',
      'npx prettier --check src',
      // v5.1: Logistics Manager backend checks
      'npx tsc --noEmit -p server/tsconfig.json', 'npx vitest run --root server', 'npx vitest run --root=server',
      'npx vitest run --root server tests/orders.test.ts -t conflict', 'npx tsc --noEmit -p server/tsconfig.json && npx vitest run --root server',
    ],
    deny: [
      'npx eslint --fix src', 'npx eslint -c evil.js src', 'npx tsc -b', 'npx vitest', 'git commit -m x', 'git -c x=y status',
      'git diff --output=x', 'git status > x', 'X=1 git status', 'npx vitest run ../outside', 'npm install left-pad',
      'npx playwright install', 'npm run dev', 'npm run format', 'git push', 'git add src/a.ts', 'npx vitest run &',
      'ls && npm install x', 'npx prettier --write src', 'npx prettier --write src/missing.ts', 'echo x >> src/a.ts', 'node x.js',
      // v5.1: only the exact server project and root are accepted; subagents never install
      'npx tsc --noEmit -p server/other.json', 'npx tsc --noEmit -p ../tsconfig.json', 'npx tsc -p server/tsconfig.json',
      'npx vitest run --root ..', 'npx vitest run --root src', 'npx vitest run --root', 'npx vitest run --root server --root server',
      'npx vitest run --root=../server', 'npm --prefix server install left-pad', 'npm --prefix server ci', 'npm --prefix server run test',
    ],
  },
  reviewer: {
    allow: ['git diff main...HEAD', 'git show HEAD', 'git merge-base main HEAD', 'npx vitest run', 'npm run lint', 'npx playwright test', 'npm run build'],
    deny: ['git push', 'git branch -a', 'npx prettier --write src/a.ts', 'npx eslint --fix src/a.ts'],
  },
  qa: {
    allow: ['npm run test', 'npm run lint', 'npm run test:e2e', 'npm run build', 'npm run test -- tests/unit/engine.test.ts', 'npx playwright test tests/e2e/app.spec.ts --project chromium', 'npx vitest run tests/unit/demand-sync.test.ts'],
    deny: ['npm install', 'npx playwright install', 'npx playwright test --ui', 'npm run test -- --watch'],
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
