#!/usr/bin/env node
// PreToolUse guard for Bash (and PowerShell, which is always blocked).
// Spec: doc/specs/2026-11-25-claude-code-security-setup.md, section 5.3.
// This is defence in depth, not a sandbox. Commands are checked against a
// command-name allowlist; Git subcommands against a subcommand allowlist.
// Anything the tokenizer cannot interpret statically is blocked.

import path from 'node:path';
import os from 'node:os';
import {
  runHook,
  deny,
  repoRoot,
  canonical,
  relativeInRepo,
  isProtectedRel,
  outsideAllowed,
  currentBranch,
  key,
  BRANCH_RE,
} from './lib/common.mjs';
import { parse, ParseError, ASSIGN_RE, cmdName } from './lib/shell.mjs';

const CREDENTIAL_RE =
  /GH_TOKEN|GITHUB_TOKEN|GH_ENTERPRISE_TOKEN|GITHUB_ENTERPRISE_TOKEN|GIT_ASKPASS|SSH_ASKPASS|credential|\.git-credentials|hosts\.yml|GitHub CLI|[\\/]\.ssh([\\/]|$)|id_rsa|id_ed25519|id_ecdsa/i;
const SENSITIVE_VAR_RE = /^(GIT_|GH_|GITHUB_|GCM_|SSH_|PATH$|HOME$|NODE_OPTIONS$|NODE_PATH$|NPM_CONFIG_|CLAUDE|BASH_ENV$|ENV$|PROMPT_COMMAND$|LD_|DYLD_)/i;

// Commands with dedicated explanations (also blocked by the allowlist).
const EXPLAINED = {
  gh: 'GitHub CLI is disabled for Claude Code; the user runs it personally',
  hub: 'GitHub tooling is disabled for Claude Code',
  curl: 'network clients are disabled for Claude Code',
  wget: 'network clients are disabled for Claude Code',
  ssh: 'remote shells are disabled for Claude Code',
  scp: 'remote copy is disabled for Claude Code',
  claude: 'nested Claude Code sessions are not allowed; the user starts them',
  powershell: 'PowerShell is disabled in this project',
  pwsh: 'PowerShell is disabled in this project',
  bash: 'nested shells are not allowed; run the commands directly',
  sh: 'nested shells are not allowed; run the commands directly',
  cmd: 'nested shells are not allowed; run the commands directly',
  eval: 'eval is not allowed',
  env: 'env is not allowed (it can print credentials or run commands)',
  printenv: 'printing the environment is not allowed',
  export: 'changing the shell environment is not allowed',
  xargs: 'xargs is not allowed (indirect command execution)',
};

const READ_ONLY = new Set([
  'ls', 'cat', 'head', 'tail', 'wc', 'grep', 'egrep', 'fgrep', 'rg', 'diff', 'cmp', 'comm',
  'sha256sum', 'sha1sum', 'md5sum', 'echo', 'printf', 'pwd', 'cut', 'tr', 'basename', 'dirname',
  'realpath', 'readlink', 'date', 'stat', 'file', 'du', 'df', 'test', '[', 'true', 'false',
  'which', 'nl', 'od', 'sort', 'tree', 'find', 'sed',
]);
const WRITE = new Set(['mkdir', 'cp', 'mv', 'rm', 'rmdir', 'touch', 'tee']);
const SPECIAL = new Set(['git', 'npm', 'npx', 'node', 'cd']);
const PATH_INVOCATION_OK = new Set(['git', 'node', 'npm', 'npx']);

const GIT_READ = new Set([
  'status', 'diff', 'log', 'show', 'blame', 'grep', 'rev-parse', 'ls-files', 'ls-tree', 'cat-file',
  'merge-base', 'describe', 'shortlog', 'fetch', 'diff-tree', 'name-rev', 'for-each-ref',
  'check-ignore', 'rev-list', 'show-ref', 'ls-remote', 'range-diff', 'whatchanged', 'cherry',
  'count-objects', 'version', 'check-attr', 'check-ref-format',
]);
const GIT_READ_BAD_OPTS = ['--output', '--ext-diff', '--open-files-in-pager', '--upload-pack', '--receive-pack', '--exec', '--run'];
const REF_RE = /^[A-Za-z0-9][A-Za-z0-9._/@~^-]*$/;

runHook('bash', (input) => {
  if (input.tool_name === 'PowerShell') deny('the PowerShell tool is disabled in this project');
  if (input.tool_name !== 'Bash') deny(`unexpected tool "${input.tool_name}"`);
  const ti = input.tool_input;
  if (!ti || typeof ti !== 'object' || typeof ti.command !== 'string') deny('missing tool_input.command');
  const cmd = ti.command;
  const root = repoRoot(input);
  const cwd = typeof input.cwd === 'string' && input.cwd ? canonical(input.cwd) : root;

  if (CREDENTIAL_RE.test(cmd)) deny('the command references credentials or credential stores');

  let segs;
  try {
    segs = parse(cmd);
  } catch (e) {
    if (e instanceof ParseError) {
      deny(`command could not be safely interpreted (${e.message}); use plain commands without expansions, substitutions or heredocs, or ask the user to run it`);
    }
    throw e;
  }
  const cwdRel = relativeInRepo(cwd, root);
  const ctx = {
    root,
    cwd,
    cwdProtected: cwdRel !== null && cwdRel !== '' && isProtectedRel(cwdRel),
    multi: segs.length > 1,
  };
  for (const s of segs) checkSegment(s, ctx);
});

function checkSegment(seg, ctx) {
  let k = 0;
  while (k < seg.words.length && ASSIGN_RE.test(seg.words[k].text)) {
    const name = seg.words[k].text.split('=')[0];
    if (SENSITIVE_VAR_RE.test(name)) deny(`setting ${name} is not allowed`);
    k++;
  }
  const argv = seg.words.slice(k);
  for (const r of seg.redirects) checkRedirect(r, ctx);
  if (!argv.length) return;

  const w0 = argv[0];
  if (w0.glob) deny('wildcards in the command name are not allowed');
  const name = cmdName(w0.text);
  if (/[\\/]/.test(w0.text) && !PATH_INVOCATION_OK.has(name)) {
    deny(`executing a file by path is not allowed: ${w0.text}`);
  }
  if (EXPLAINED[name]) deny(EXPLAINED[name]);
  if (!READ_ONLY.has(name) && !WRITE.has(name) && !SPECIAL.has(name)) {
    deny(`"${name}" is not in the project's command allowlist; ask the user to run it`);
  }
  const args = argv.slice(1);

  if (name === 'cd') {
    if (ctx.multi) deny('cd inside a compound command is not allowed; run cd on its own');
    return;
  }
  if (name === 'git') return checkGit(args, ctx);
  if (name === 'npm') return checkNpm(args);
  if (name === 'npx') return checkNpx(args);
  if (name === 'node') return checkNode(args, ctx);

  if (READ_ONLY.has(name)) return checkReadOnly(name, args);

  // Write-capable commands.
  if (ctx.cwdProtected) deny('the working directory is inside a protected path');
  for (const a of args) {
    if (a.text.startsWith('-') && a.text !== '-') continue;
    checkWriteTarget(a, ctx, name);
  }
}

function checkReadOnly(name, args) {
  const t = args.map((a) => a.text);
  if (name === 'find') {
    const bad = t.find((x) => /^-(exec|execdir|ok|okdir|delete|fprint|fprint0|fprintf|fls)$/.test(x));
    if (bad) deny(`find ${bad} is not allowed`);
  }
  if (name === 'sort' && t.some((x) => x === '-o' || x.startsWith('--output') || /^-[a-zA-Z]*o/.test(x))) {
    deny('sort -o is not allowed');
  }
  if (name === 'tree' && t.some((x) => x === '-o')) deny('tree -o is not allowed');
  if (name === 'sed') {
    // Only "sed -n '<range>p' <files>" is allowed: GNU sed can write files and execute commands.
    const ok = t[0] === '-n' && t.length >= 2 && /^(\d+|\$)(,(\d+|\$))?p$/.test(t[1]) && t.slice(2).every((x) => !x.startsWith('-'));
    if (!ok) deny("only \"sed -n '<start>,<end>p' <file>\" is allowed");
  }
}

function resolveArg(a, ctx) {
  let t = a.text;
  if (a.tilde && (t === '~' || t.startsWith('~/'))) t = path.join(os.homedir(), t.slice(1));
  return canonical(path.resolve(ctx.cwd, t));
}

function checkWriteTarget(a, ctx, what) {
  if (a.glob) deny(`wildcards in arguments of ${what} are not allowed`);
  if (a.tilde && !(a.text === '~' || a.text.startsWith('~/'))) deny(`unsupported tilde form: ${a.text}`);
  if (a.text === '/dev/null') return;
  const abs = resolveArg(a, ctx);
  const rel = relativeInRepo(abs, ctx.root);
  if (rel === null) {
    if (outsideAllowed(abs)) return;
    deny(`${what}: path outside the repository and scratchpad: ${a.text}`);
  }
  if (isProtectedRel(rel)) deny(`${what}: protected path: ${rel || '<repository root>'}`);
}

function checkRedirect(r, ctx) {
  if (r.op.includes('<')) return; // input redirections
  if (r.op.endsWith('>&') && /^(\d+|-)$/.test(r.target)) return; // descriptor duplication
  if (ctx.cwdProtected) deny('the working directory is inside a protected path');
  checkWriteTarget({ text: r.target, glob: /[*?[]/.test(r.target), tilde: r.target.startsWith('~') }, ctx, 'redirection');
}

// ---------------------------------------------------------------- git

function checkGit(args, ctx) {
  let i = 0;
  let hasC = false;
  while (i < args.length && args[i].text.startsWith('-')) {
    const t = args[i].text;
    if (t === '-C') {
      if (i + 1 >= args.length) deny('git -C without a directory');
      hasC = true;
      i += 2;
      continue;
    }
    if (t === '--no-pager') {
      i++;
      continue;
    }
    deny(`git global option ${t} is not allowed`);
  }
  if (i >= args.length) deny('git without a subcommand');
  const sub = args[i].text;
  const rest = args.slice(i + 1);
  const t = rest.map((a) => a.text);
  for (const x of t) {
    if (/^(ext|fd)::/i.test(x)) deny('git remote-helper URLs are not allowed');
  }

  if (GIT_READ.has(sub)) {
    for (const x of t) {
      if (GIT_READ_BAD_OPTS.some((o) => x === o || x.startsWith(o + '='))) deny(`git ${sub} ${x} is not allowed`);
      if (/^-O/.test(x)) deny(`git ${sub} ${x} is not allowed`);
    }
    return;
  }
  const refuse = () =>
    deny(`git ${[sub, ...t].join(' ')} is not allowed from Claude Code. Publication, remote/config changes, history rewriting, destructive operations, merges and unknown subcommands or aliases are reserved to the user`);

  switch (sub) {
    case 'reflog':
      if (t.length === 0 || t[0] === 'show') return;
      return refuse();
    case 'branch':
      return gitBranch(t, refuse);
    case 'switch':
    case 'checkout': {
      const flag = sub === 'switch' ? '-c' : '-b';
      if (t[0] === flag && t.length >= 2 && t.length <= 3 && BRANCH_RE.test(t[1]) && (t.length === 2 || REF_RE.test(t[2]))) return;
      return refuse();
    }
    case 'add':
      return gitAdd(rest, ctx, refuse);
    case 'commit':
      return gitCommit(t, ctx, hasC, refuse);
    case 'stash':
      if (t[0] === 'list' || t[0] === 'show') return;
      return refuse();
    case 'tag':
      if (t.length === 0 || ((t[0] === '-l' || t[0] === '--list') && t.slice(1).every((x) => !x.startsWith('-')))) return;
      return refuse();
    case 'worktree':
      if (t[0] === 'list' && t.slice(1).every((x) => x === '--porcelain' || x === '-v')) return;
      return refuse();
    case 'remote':
      if (t.length === 0 || (t.length === 1 && t[0] === '-v')) return;
      if ((t[0] === 'show' || t[0] === 'get-url') && t.length <= 2 && t.slice(1).every((x) => !x.startsWith('-'))) return;
      return refuse();
    case 'config':
      return gitConfig(t, refuse);
    default:
      return refuse();
  }
}

function gitBranch(t, refuse) {
  const FLAGS = new Set(['-a', '-r', '-v', '-vv', '-l', '-av', '-avv', '-rv', '--list', '--all', '--remotes', '--show-current', '--verbose', '--no-color', '--no-abbrev']);
  const opts = t.filter((x) => x.startsWith('-'));
  const pos = t.filter((x) => !x.startsWith('-'));
  if (opts.some((o) => !FLAGS.has(o))) return refuse();
  if (!pos.length) return;
  if (opts.length || pos.length > 2) return refuse();
  if (!BRANCH_RE.test(pos[0])) deny(`new branch names must match feat|fix|chore/<slug>: ${pos[0]}`);
  if (pos[1] && !REF_RE.test(pos[1])) return refuse();
}

function gitAdd(rest, ctx, refuse) {
  const paths = rest.filter((a) => a.text !== '--');
  if (!paths.length) return refuse();
  for (const a of paths) {
    const x = a.text;
    if (x.startsWith('-')) deny(`git add ${x} is not allowed; list explicit paths`);
    if (a.glob) deny('git add with wildcards is not allowed; list explicit paths');
    if (x.startsWith(':') || x === '.' || x === './') deny('git add of the whole tree or pathspec magic is not allowed');
    const rel = relativeInRepo(resolveArg(a, ctx), ctx.root);
    if (rel === null) deny(`git add outside the repository: ${x}`);
    if (isProtectedRel(rel)) deny(`git add of a protected path is reserved to the user: ${rel || '<repository root>'}`);
  }
}

function gitCommit(t, ctx, hasC, refuse) {
  if (hasC) deny('git -C with commit is not allowed');
  const b = currentBranch(ctx.root);
  if (!b || b === 'main' || b === 'master') deny(`commits on ${b || 'a detached or unknown HEAD'} are forbidden`);
  if (!BRANCH_RE.test(b)) deny(`commits are only allowed on feat|fix|chore/<slug> branches (current: ${b})`);
  const WITH_VALUE = new Set(['-m', '--message', '-F', '--file', '--author', '--date', '--trailer']);
  const FLAGS = new Set(['-s', '--signoff', '-q', '--quiet', '-v', '--verbose', '-S', '--gpg-sign']);
  let hasMessage = false;
  for (let i = 0; i < t.length; i++) {
    const x = t[i];
    if (WITH_VALUE.has(x)) {
      if (i + 1 >= t.length) return refuse();
      if (x === '-m' || x === '--message' || x === '-F' || x === '--file') hasMessage = true;
      i++;
      continue;
    }
    if (/^--(message|file|author|date|trailer)=/.test(x)) {
      if (/^--(message|file)=/.test(x)) hasMessage = true;
      continue;
    }
    if (FLAGS.has(x) || /^--cleanup=/.test(x)) continue;
    return refuse(); // --amend, --no-verify, -n, -a, --fixup, --squash, paths, clusters ...
  }
  if (!hasMessage) deny('git commit requires -m or -F (no editor sessions)');
}

function gitConfig(t, refuse) {
  const READ = new Set(['--get', '--get-all', '--get-regexp', '--list', '-l', 'get', 'list']);
  const MOD = new Set(['--global', '--local', '--system', '--show-origin', '--show-scope', '--name-only', '-z', '--null', '--includes', '--no-includes']);
  let sawRead = false;
  for (let i = 0; i < t.length; i++) {
    const x = t[i];
    if (READ.has(x)) {
      sawRead = true;
      continue;
    }
    if (MOD.has(x)) continue;
    if (x.startsWith('-')) return refuse();
    if (!sawRead) return refuse(); // "git config key value" is a write
  }
  if (!sawRead) return refuse();
}

// ---------------------------------------------------------------- npm / npx / node

function checkNpm(args) {
  const t = args.map((a) => a.text);
  const SCRIPTS = ['lint', 'test', 'build', 'test:e2e'];
  if (t[0] === 'run' || t[0] === 'run-script') {
    if (!SCRIPTS.includes(t[1])) deny(`npm run ${t[1] ?? ''} is not allowed (allowed: ${SCRIPTS.join(', ')})`);
    if (t.length > 2 && t[2] !== '--') deny('npm run options are not allowed');
    return;
  }
  if (t[0] === 'test' && (t.length === 1 || t[1] === '--')) return;
  if (t[0] === 'ci' && t.length === 1) return;
  if ((t[0] === 'ls' || t[0] === 'list') && t.slice(1).every((x) => /^(--depth=\d+|--all|--json|[@a-z0-9._/-]+)$/.test(x))) return;
  if (t.length === 1 && (t[0] === '--version' || t[0] === '-v')) return;
  deny(`npm ${t[0] ?? ''} is not allowed from Claude Code (publication, installs and arbitrary scripts are reserved to the user)`);
}

function checkNpx(args) {
  const t = args.map((a) => a.text);
  const [pkg, ...r] = t;
  if (!pkg || pkg.startsWith('-')) deny('npx options are not allowed');
  const has = (...xs) => r.some((x) => xs.includes(x) || xs.some((o) => o.startsWith('--') && x.startsWith(o + '=')));
  switch (pkg) {
    case 'eslint':
      if (r.some((x) => x.startsWith('--fix')) || has('-c', '--config', '--rulesdir', '--plugin', '--resolve-plugins-relative-to', '-o', '--output-file', '--init', '--inspect-config')) {
        deny('this eslint option is not allowed (no fixes, custom configs, plugins or output files)');
      }
      return;
    case 'tsc':
      if (has('-w', '--watch', '--init')) deny('tsc watch/init is not allowed');
      return;
    case 'vitest':
      if (r[0] !== 'run') deny('only "npx vitest run" is allowed');
      if (has('--ui', '--api', '--watch', '-w', '-u', '--update')) deny('this vitest option is not allowed');
      return;
    case 'playwright':
      if (r[0] !== 'test') deny('only "npx playwright test" is allowed');
      if (has('--ui', '-u', '--update-snapshots')) deny('this playwright option is not allowed');
      return;
    case 'prettier':
      if (!has('--check', '-c') || has('--write', '-w')) deny('only "npx prettier --check" is allowed');
      return;
    default:
      deny(`npx ${pkg} is not allowed (allowed: eslint, tsc, vitest run, playwright test, prettier --check)`);
  }
}

function checkNode(args, ctx) {
  const t = args.map((a) => a.text);
  if (t.length === 1 && (t[0] === '--version' || t[0] === '-v')) return;
  if (t[0] !== '--test') deny('node may only run the guard test suite: node --test .claude/hooks/test');
  const testDir = key(path.join(ctx.root, '.claude', 'hooks', 'test'));
  let paths = 0;
  for (const a of args.slice(1)) {
    if (/^--test-(reporter|name-pattern|concurrency)=[\w.-]+$/.test(a.text)) continue;
    if (a.text.startsWith('-')) deny(`node option ${a.text} is not allowed`);
    if (a.glob) deny('wildcards are not allowed in node --test paths');
    const k = key(resolveArg(a, ctx));
    if (k !== testDir && !k.startsWith(testDir + '/')) deny('node --test may only run files under .claude/hooks/test');
    paths++;
  }
  if (!paths) deny('node --test requires an explicit path under .claude/hooks/test');
}
