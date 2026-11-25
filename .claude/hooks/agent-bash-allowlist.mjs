#!/usr/bin/env node
// PreToolUse Bash allowlist for OxEye subagents.
// Usage (subagent frontmatter): node ".../agent-bash-allowlist.mjs" <implementer|qa|reviewer>
// Spec: doc/specs/2026-11-25-claude-code-security-setup.md, section 5.4 (v4 revision).
// The project-level guard-bash.mjs also runs for subagents and keeps enforcing
// its own rules (credentials, find -exec, sed, protected paths...). This hook
// narrows subagents to a per-role allowlist:
// - every role: read-only Git, read-only text tools, eslint, tsc, vitest,
//   playwright test, npm run test|lint|build|test:e2e, chained with ; && || |
// - implementer and qa: prettier --write / eslint --fix on explicit files that
//   the approved plan allows (qa: only under tests/)
// - never: installs, Git writes, commits, background jobs, file redirections,
//   environment assignments. The AI Lead commits.

import fs from 'node:fs';
import path from 'node:path';
import { runHook, deny, repoRoot, canonical, relativeInRepo, repoWriteProblem } from './lib/common.mjs';
import { parse, ParseError, ASSIGN_RE } from './lib/shell.mjs';

const ROLES = new Set(['implementer', 'qa', 'reviewer']);
const GIT_SUBS = new Set(['status', 'diff', 'log', 'show', 'rev-parse', 'ls-files', 'ls-tree', 'merge-base', 'blame', 'grep', 'shortlog', 'rev-list', 'cat-file', 'describe']);
const GIT_BAD = /^(--output|--ext-diff|--exec|--open-files-in-pager|-c$|-C$|-O)/;
const PATH_RE = /^[A-Za-z0-9_@*?[\]][A-Za-z0-9_./@:*?[\]-]*$/;
// Read-only text tools. guard-bash still applies its finer rules to them.
const READ_TOOLS = new Set(['ls', 'cat', 'head', 'tail', 'wc', 'grep', 'rg', 'sort', 'uniq', 'cut', 'tr', 'nl', 'diff', 'echo', 'pwd', 'find', 'sed', 'tree', 'basename', 'dirname', 'file', 'stat', 'du', 'true', 'false', 'test']);
const NPM_SCRIPTS = ['test', 'lint', 'build', 'test:e2e'];
const SEPARATORS = new Set([';', '&&', '||', '|', '|&', 'newline', 'end']);

const role = process.argv[2];

runHook(`agent-bash:${role ?? 'none'}`, (input) => {
  if (!ROLES.has(role)) deny(`unknown or missing agent role "${role ?? ''}"`);
  if (input.tool_name !== 'Bash') deny(`unexpected tool "${input.tool_name}"`);
  const cmd = input.tool_input && input.tool_input.command;
  if (typeof cmd !== 'string') deny('missing tool_input.command');
  let segs;
  try {
    segs = parse(cmd);
  } catch (e) {
    if (e instanceof ParseError) deny(`command could not be safely interpreted (${e.message})`);
    throw e;
  }
  if (segs.length > 12) deny('too many chained commands; split the work');
  const root = repoRoot(input);
  const cwd = typeof input.cwd === 'string' && input.cwd ? canonical(input.cwd) : root;
  for (const seg of segs) {
    if (!SEPARATORS.has(seg.sep)) deny('background jobs (&) are not allowed for subagents');
    checkSegment(seg, { root, cwd, cmd });
  }
});

function checkSegment(seg, ctx) {
  for (const r of seg.redirects) {
    const ok = (r.op.endsWith('>&') && /^\d+$/.test(r.target)) || (/^\d?>$/.test(r.op) && r.target === '/dev/null');
    if (!ok) deny('subagents may only redirect to /dev/null or merge streams (2>&1); file output is not allowed');
  }
  const words = seg.words;
  if (!words.length) deny('empty command');
  if (ASSIGN_RE.test(words[0].text)) deny('environment assignments are not allowed for subagents');
  const t = words.map((w) => w.text);
  if (/[\\/]/.test(t[0])) deny('commands must be invoked by name');
  if (words[0].glob) deny('wildcards in the command name are not allowed');
  if (allowed(t, words, ctx)) return;
  deny(`"${t.join(' ')}" is not in the ${role} allowlist. Ask the AI Lead if you need it`);
}

function allowed(t, words, ctx) {
  if (READ_TOOLS.has(t[0])) return true;
  if (t[0] === 'git') return gitAllowed(t.slice(1));
  if (t[0] === 'npm') {
    if (t[1] !== 'run' || !NPM_SCRIPTS.includes(t[2])) return false;
    if (t.length === 3) return true;
    return t[3] === '--' && optionsAllowed(t.slice(4), ['--reporter', '-t', '--project', '--grep', '-g'], []);
  }
  if (t[0] !== 'npx') return false;
  switch (t[1]) {
    case 'tsc':
      return t.length === 5 && t[2] === '--noEmit' && t[3] === '-p' && t[4] === 'tsconfig.json';
    case 'vitest':
      return t[2] === 'run' && optionsAllowed(t.slice(3), ['--reporter', '-t', '--testNamePattern'], []);
    case 'playwright':
      return t[2] === 'test' && optionsAllowed(t.slice(3), ['--project', '--grep', '-g', '--reporter', '--workers'], []);
    case 'eslint':
      if (t.includes('--fix')) return formatAllowed(words.slice(2), ctx, ['--fix'], ['--max-warnings', '--format', '-f']);
      return optionsAllowed(t.slice(2), ['--max-warnings', '--format', '-f'], ['--quiet', '--no-warn-ignored', '--no-error-on-unmatched-pattern']);
    case 'prettier':
      if (t.includes('--write') || t.includes('-w')) return formatAllowed(words.slice(2), ctx, ['--write', '-w'], ['--log-level']);
      return optionsAllowed(t.slice(2), [], ['--check', '-c', '--list-different', '-l']);
    default:
      return false;
  }
}

function gitAllowed(a) {
  if (a.length === 2 && a[0] === 'branch' && a[1] === '--show-current') return true;
  if (!GIT_SUBS.has(a[0])) return false;
  return a.slice(1).every((x) => !GIT_BAD.test(x) && !/^(ext|fd)::/i.test(x));
}

/** Paths, value options (separate or --opt=value) and boolean flags from explicit lists only. */
function optionsAllowed(a, withValue, flags) {
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    if (flags.includes(x)) continue;
    if (withValue.includes(x)) {
      if (i + 1 >= a.length) return false;
      i++;
      continue;
    }
    const eq = x.indexOf('=');
    if (x.startsWith('--') && eq > 0 && withValue.includes(x.slice(0, eq))) continue;
    if (x.startsWith('-')) return false;
    if (!PATH_RE.test(x) || x.split('/').includes('..')) return false;
  }
  return true;
}

/** Write-mode formatters: explicit existing files that the approved plan allows. */
function formatAllowed(words, ctx, flags, withValue) {
  if (role === 'reviewer') deny('reviewers do not modify files');
  let files = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const x = w.text;
    if (flags.includes(x)) continue;
    if (withValue.includes(x)) {
      i++;
      continue;
    }
    if (x.startsWith('-')) return false;
    if (w.glob) deny('formatters that write must receive explicit files, not wildcards');
    const abs = canonical(path.resolve(ctx.cwd, x));
    let st;
    try {
      st = fs.statSync(abs);
    } catch {
      deny(`file not found: ${x}`);
    }
    if (!st.isFile()) deny(`formatters that write must receive explicit files, not directories: ${x}`);
    const rel = relativeInRepo(abs, ctx.root);
    if (rel === null) deny(`file outside the repository: ${x}`);
    if (role === 'qa' && !rel.startsWith('tests/')) deny('qa-engineer formats only files under tests/');
    const problem = repoWriteProblem(ctx.root, rel);
    if (problem) deny(problem);
    files++;
  }
  if (!files) deny('formatters that write require explicit file paths');
  return true;
}
