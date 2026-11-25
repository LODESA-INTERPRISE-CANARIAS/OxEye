import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { runScript, makeRepo, setBranch, cleanup } from './helpers.mjs';

const root = makeRepo('main');
after(() => cleanup(root));

function bash(command, { branch = 'main', cwd = root, tool = 'Bash' } = {}) {
  setBranch(root, branch);
  return runScript(
    'guard-bash.mjs',
    { hook_event_name: 'PreToolUse', tool_name: tool, tool_input: { command }, cwd },
    { env: { CLAUDE_PROJECT_DIR: root } },
  );
}

const DENY = [
  'mkdir -p src/new',
  'cp src/a.ts src/b.ts',
  'rm src/old.ts',
  'echo x > src/out.txt',
  'npx prettier --write src/a.ts',
  'git push',
  'git push origin main',
  'git -C . push origin main',
  '/usr/bin/git push',
  'git.exe push',
  '"C:/Program Files/Git/cmd/git.exe" push',
  'GIT_DIR=x git status',
  'git -c alias.p=push p',
  'git p',
  'git send-pack origin',
  'git http-push x',
  'git remote add evil https://x',
  'git remote set-url origin https://x',
  'git config user.name x',
  'git config --add remote.origin.pushurl x',
  'git credential fill',
  'git reset --hard',
  'git clean -fd',
  'git checkout -- src/a.ts',
  'git checkout main',
  'git switch main',
  'git rebase -i HEAD~2',
  'git merge feat/x',
  'git branch -D feat/x',
  'git stash',
  'git stash drop',
  'git tag -d v1',
  'git reflog expire --all',
  'git fetch --upload-pack=evil origin',
  'git fetch ext::sh',
  'git diff --output=x.txt',
  'git grep -Ovim x',
  'git add .',
  'git add -A',
  'git add .claude/settings.json',
  'git add src/*.ts',
  'git status && git push',
  'git status; git push',
  'git status | git push',
  'git status\ngit push',
  'bash -c "git push"',
  'sh script.sh',
  'cmd /c git push',
  'powershell -Command x',
  'node -e "require(1)"',
  'node x.mjs',
  'node --test src',
  'python -c 1',
  'npx -c "git push"',
  'npx --yes cowsay',
  'npx eslint --fix src',
  'npx prettier --write --plugin=evil src/a.ts',
  'npx vitest',
  'npm run deploy',
  'npm install left-pad',
  'npm publish',
  'gh pr create',
  'gh auth status',
  'curl -X POST https://api.github.com',
  'wget https://x',
  'echo $GH_TOKEN',
  'echo "$HOME"',
  'printenv',
  'env',
  'export X=1',
  'claude -p hi',
  'echo x > .claude/settings.json',
  'echo x >> CLAUDE.md',
  'echo x > src/CLAUDE.md',
  'cp a .git/hooks/pre-push',
  'rm -rf .',
  'rm -rf .claude',
  'mv .github x',
  'touch ~/.gitconfig',
  'tee .mcp.json',
  'rm src/*.ts',
  'echo `git push`',
  'echo $(git push)',
  'cat <<EOF\nx\nEOF',
  'echo "unbalanced',
  "echo 'unbalanced",
  '(git push)',
  '{ git push; }',
  'if true; then git push; fi',
  '! git status',
  'git status # comment',
  'cd .git && rm config',
  './script.sh',
  'scripts/run.sh',
  'awk "{print}" x',
  'sed -i s/a/b/ src/a.ts',
  "sed 'e git push' x",
  'find . -exec git push \\;',
  'find . -delete',
  'sort -o x y',
  'git commit -m x',
  'cat ~/.git-credentials',
  'cat ~/.ssh/id_rsa',
  'echo credential',
  'xargs git push',
  'timeout 5 git push',
  'nohup git push',
  'chmod +x x',
  'ln -s a b',
  '',
  '   ',
];

for (const c of DENY) {
  test(`deny: ${JSON.stringify(c)}`, () => {
    const r = bash(c);
    assert.equal(r.status, 2, `expected block, got ${r.status}: ${r.stderr}`);
    assert.match(r.stderr, /\[oxeye-guard:bash\] BLOCKED/);
  });
}

const ALLOW = [
  'git status',
  'git status --short',
  'git diff --stat',
  'git log --oneline -3',
  'git -C . status',
  'git --no-pager log -1',
  'git show HEAD:package.json',
  'git branch',
  'git branch --show-current',
  'git branch -a',
  'git branch feat/new-thing',
  'git switch -c fix/some-bug',
  'git checkout -b chore/cleanup main',
  'git remote -v',
  'git config --get remote.origin.url',
  'git config --list --show-origin',
  'git stash list',
  'git worktree list',
  'git fetch origin',
  'git reflog',
  'git add src/a.ts tests/unit/a.test.ts',
  'npx vitest run tests/unit/demand-sync.test.ts',
  'npx tsc --noEmit -p tsconfig.json',
  'npx eslint src/engine',
  'npx playwright test tests/e2e/app.spec.ts',
  'npx prettier --check src',
  'npm run lint',
  'npm run test',
  'npm run test -- tests/unit/engine.test.ts',
  'npm test',
  'node --test .claude/hooks/test',
  'node --test .claude/hooks/test/*.test.mjs',
  'echo x > dist/out.txt',
  'rm -rf test-results',
  'node --version',
  'ls -la .claude',
  'cat .claude/agents/qa-engineer.md',
  "sed -n '1,30p' src/App.tsx",
  'grep -rn foo src | head -5',
  'sha256sum .claude/hooks/guard-bash.mjs',
  'echo hello 2>&1',
  'ls missing 2>/dev/null',
  'cd src',
  'echo ok && git status',
  'find . -name "*.ts"',
  'wc -l src/App.tsx',
];

for (const c of ALLOW) {
  test(`allow: ${JSON.stringify(c)}`, () => {
    const r = bash(c);
    assert.equal(r.status, 0, `expected allow, got ${r.status}: ${r.stderr}`);
  });
}

test('commit allowed on a feature branch', () => {
  assert.equal(bash('git commit -m "FEAT: titulo"', { branch: 'feat/x' }).status, 0);
  assert.equal(bash('git commit -s -m "FIX: a" -m "body"', { branch: 'chore/claude-code-setup' }).status, 0);
});

test('commit restrictions on a feature branch', () => {
  for (const c of ['git commit --amend -m x', 'git commit --no-verify -m x', 'git commit -n -m x', 'git commit -am x', 'git commit -a -m x', 'git commit', 'git commit -m x src/a.ts', 'git -C . commit -m x']) {
    assert.equal(bash(c, { branch: 'feat/x' }).status, 2, c);
  }
});

test('commit denied on detached HEAD and non-conforming branches', () => {
  assert.equal(bash('git commit -m x', { branch: null }).status, 2);
  assert.equal(bash('git commit -m x', { branch: 'mapa-y-perimetros' }).status, 2);
});

test('writes into scratchpad allowed, elsewhere outside the repo denied', () => {
  const scratch = path.join(os.tmpdir(), 'claude', 'x', 'out.txt').replace(/\\/g, '/');
  assert.equal(bash(`echo x > "${scratch}"`).status, 0);
  const other = path.join(os.homedir(), 'evil.txt').replace(/\\/g, '/');
  assert.equal(bash(`echo x > "${other}"`).status, 2);
});

test('write commands denied when cwd is inside a protected directory', () => {
  assert.equal(bash('rm settings.json', { cwd: path.join(root, '.git') }).status, 2);
  assert.equal(bash('echo x > y', { cwd: path.join(root, '.git') }).status, 2);
});

test('PowerShell tool always denied', () => {
  const r = bash('Get-ChildItem', { tool: 'PowerShell' });
  assert.equal(r.status, 2);
});

test('malformed inputs fail closed', () => {
  const env = { env: { CLAUDE_PROJECT_DIR: root } };
  assert.equal(runScript('guard-bash.mjs', 'not json', env).status, 2);
  assert.equal(runScript('guard-bash.mjs', '[]', env).status, 2);
  assert.equal(runScript('guard-bash.mjs', { tool_name: 'Bash', tool_input: {} }, env).status, 2);
  assert.equal(runScript('guard-bash.mjs', { tool_name: 'Bash', tool_input: { command: 5 } }, env).status, 2);
  assert.equal(runScript('guard-bash.mjs', { tool_name: 'Read', tool_input: { command: 'ls' } }, env).status, 2);
  assert.equal(runScript('guard-bash.mjs', { tool_name: 'Bash', tool_input: { command: 'ls' } }, { env: { CLAUDE_PROJECT_DIR: os.tmpdir() } }).status, 2);
});
