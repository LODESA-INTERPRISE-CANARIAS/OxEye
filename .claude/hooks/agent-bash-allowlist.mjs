#!/usr/bin/env node
// PreToolUse Bash allowlist for OxEye subagents.
// Usage (subagent frontmatter): node ".../agent-bash-allowlist.mjs" <implementer|qa|reviewer>
// Spec: doc/specs/2026-11-25-claude-code-security-setup.md, section 5.4.
// The project-level guard-bash.mjs also runs for subagents; this hook narrows
// the allowed commands further to one simple command from a per-role list.

import { runHook, deny } from './lib/common.mjs';
import { parse, ParseError, ASSIGN_RE } from './lib/shell.mjs';

const ROLES = new Set(['implementer', 'qa', 'reviewer']);
const GIT_SUBS = new Set(['status', 'diff', 'log', 'show', 'rev-parse', 'ls-files', 'merge-base', 'blame']);
const GIT_BAD = /^(--output|--ext-diff|--exec|--open-files-in-pager|-c$|-C$|-O)/;
const PATH_RE = /^[A-Za-z0-9_@][A-Za-z0-9_./@:-]*$/;

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
  if (segs.length !== 1) deny('subagents may run only one simple command (no ;, &&, ||, | or &)');
  const seg = segs[0];
  if (seg.redirects.length) deny('redirections are not allowed for subagents');
  const words = seg.words;
  if (!words.length || ASSIGN_RE.test(words[0].text)) deny('environment assignments are not allowed for subagents');
  if (words.some((w) => w.glob)) deny('wildcards are not allowed for subagents; list explicit paths');
  const t = words.map((w) => w.text);
  if (/[\\/]/.test(t[0])) deny('commands must be invoked by name');

  if (allowed(t)) return;
  deny(`"${cmd}" is not in the ${role} allowlist. Report the need to the AI Lead instead of working around it`);
});

function allowed(t) {
  if (t[0] === 'git') return gitAllowed(t.slice(1));
  if (t[0] === 'npx') {
    if (t[1] === 'eslint') return eslintAllowed(t.slice(2));
    if (t[1] === 'tsc') return t.length === 5 && t[2] === '--noEmit' && t[3] === '-p' && t[4] === 'tsconfig.json';
    if (t[1] === 'vitest') return t[2] === 'run' && optionsAllowed(t.slice(3), ['--reporter', '-t', '--testNamePattern'], []);
    if (t[1] === 'playwright' && role === 'qa') {
      return t[2] === 'test' && optionsAllowed(t.slice(3), ['--project', '--grep', '-g', '--reporter', '--workers'], []);
    }
    return false;
  }
  if (t[0] === 'npm' && role === 'qa') {
    if (t[1] !== 'run' || !['test', 'lint', 'test:e2e'].includes(t[2])) return false;
    if (t.length === 3) return true;
    return t[3] === '--' && optionsAllowed(t.slice(4), ['--reporter', '-t', '--project', '--grep', '-g'], []);
  }
  return false;
}

function gitAllowed(a) {
  if (a.length === 2 && a[0] === 'branch' && a[1] === '--show-current') return true;
  if (!GIT_SUBS.has(a[0])) return false;
  return a.slice(1).every((x) => !GIT_BAD.test(x) && !/^(ext|fd)::/i.test(x));
}

function eslintAllowed(a) {
  return optionsAllowed(a, ['--max-warnings', '--format', '-f'], ['--quiet', '--no-warn-ignored', '--no-error-on-unmatched-pattern']);
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
