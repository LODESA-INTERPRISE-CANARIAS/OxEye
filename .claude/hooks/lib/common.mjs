// Shared helpers for the OxEye Claude Code guard hooks.
// Spec: doc/specs/2026-11-25-claude-code-security-setup.md (sections 5.2 and 5.8).
// Only Node built-ins are used. Every guard fails closed: any unexpected
// condition ends the hook with exit code 2.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

export const IS_WIN = process.platform === 'win32';
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const BRANCH_RE = /^(feat|fix|chore)\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const PLAN_FILE_RE = /^doc\/specs\/\d{4}-\d{2}-\d{2}-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;
// Execution log that accompanies an approved plan: doc/specs/<date>-<slug>.log.md
export const LOG_FILE_RE = /^doc\/specs\/\d{4}-\d{2}-\d{2}-([a-z0-9]+(?:-[a-z0-9]+)*)\.log\.md$/;
// npm package name (optionally scoped) and an optional version or range after "@".
export const NPM_NAME_RE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
export const NPM_VERSION_RE = /^[~^]?\d+(?:\.\d+){0,2}(?:-[0-9A-Za-z.-]+)?$/;

// Git-ignored build and test output: writable without an approval.
const GENERATED_TOP = new Set(['dist', 'playwright-report', 'test-results', 'coverage']);
// Top-level areas where the AI Lead may extend an approved scope through the execution log.
// Root files (package.json, lockfiles, build and tool configuration, index.html) are excluded:
// changing them needs an amended and re-approved plan.
const EXTENDABLE_TOP = new Set(['src', 'tests', 'doc', 'public']);
const MAX_EXTENSIONS = 40;

// Path components that are protected wherever they appear in the repository.
const PROTECTED_ANYWHERE = new Set([
  '.claude',
  '.git',
  'claude.md',
  'claude.local.md',
  '.mcp.json',
  'node_modules',
]);
// Top-level entries that are protected.
const PROTECTED_TOP = new Set(['.github', '.gitignore', '.gitattributes', '.vscode', '.husky']);

export class Deny extends Error {}

export function deny(message) {
  throw new Deny(message);
}

export function readStdin(timeoutMs = 5000, maxBytes = 2_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const timer = setTimeout(() => reject(new Deny('timed out reading hook input')), timeoutMs);
    process.stdin.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) {
        clearTimeout(timer);
        reject(new Deny('hook input too large'));
        return;
      }
      chunks.push(c);
    });
    process.stdin.on('end', () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    process.stdin.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

export function parseInput(raw) {
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    deny('malformed hook input (invalid JSON)');
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) deny('malformed hook input');
  return input;
}

/** Runs a blocking guard. Exit 0 = allow, exit 2 = block (message on stderr). */
export async function runHook(name, handler) {
  try {
    const input = parseInput(await readStdin());
    await handler(input);
  } catch (e) {
    const msg = e instanceof Deny ? e.message : `internal error: ${(e && e.message) || e}`;
    process.stderr.write(`[oxeye-guard:${name}] BLOCKED: ${msg}\n`);
    process.exit(2);
  }
  process.exit(0);
}

/** Resolves symlinks and junctions on the deepest existing ancestor. */
export function canonical(p) {
  const start = path.resolve(p);
  let cur = start;
  const rest = [];
  for (;;) {
    try {
      const real = fs.realpathSync.native(cur);
      return rest.length ? path.join(real, ...rest.reverse()) : real;
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return start;
      rest.push(path.basename(cur));
      cur = parent;
    }
  }
}

/** Comparison key: forward slashes, no trailing slash, lower-case on Windows. */
export function key(p) {
  let k = p.replace(/\\/g, '/');
  if (k.length > 1 && k.endsWith('/') && !/^[a-zA-Z]:\/$/.test(k)) k = k.slice(0, -1);
  return IS_WIN ? k.toLowerCase() : k;
}

export function repoRoot(input) {
  const cand = process.env.CLAUDE_PROJECT_DIR || (input && input.cwd);
  if (typeof cand !== 'string' || !cand) deny('cannot determine the project root');
  const root = canonical(cand);
  let st;
  try {
    st = fs.statSync(path.join(root, '.git'));
  } catch {
    deny(`project root has no .git directory: ${root}`);
  }
  if (!st.isDirectory()) deny('.git is not a directory (Git worktrees are not supported by the guards)');
  return root;
}

/** Rejects raw path spellings that Windows may reinterpret. */
export function checkRawPath(raw) {
  if (typeof raw !== 'string' || !raw) deny('empty path');
  if (raw.includes('\0')) deny('path contains NUL');
  if (/^[\\/]{2}/.test(raw)) deny(`UNC and device paths are not allowed: ${raw}`);
  const noDrive = raw.replace(/^[a-zA-Z]:/, '');
  if (noDrive.includes(':')) deny(`path contains ':' (alternate data streams are not allowed): ${raw}`);
}

/** Returns the repository-relative POSIX path, '' for the root itself, or null if outside. */
export function relativeInRepo(abs, root) {
  const ka = key(abs);
  const kr = key(root);
  if (ka === kr) return '';
  if (!ka.startsWith(kr + '/')) return null;
  return abs.replace(/\\/g, '/').slice(kr.length + 1).replace(/\/+$/, '');
}

/** Component checks on a repository-relative path. */
export function checkRelComponents(rel) {
  for (const c of rel.split('/')) {
    if (!c || c === '.' || c === '..') continue;
    if (/[. ]$/.test(c)) deny(`path component ends with a dot or space: "${c}"`);
    if (/~\d/.test(c)) deny(`8.3 short-name path components are not allowed: "${c}"`);
  }
}

export function isProtectedRel(rel) {
  if (rel === '') return true; // the repository root itself
  const comps = rel.toLowerCase().split('/').filter(Boolean);
  if (comps.some((c) => PROTECTED_ANYWHERE.has(c))) return true;
  return PROTECTED_TOP.has(comps[0]);
}

/** Outside the repository, only the Claude scratchpad and project memory are writable. */
export function outsideAllowed(abs) {
  const k = key(abs);
  const tmp = key(path.join(canonical(os.tmpdir()), 'claude')) + '/';
  if (k.startsWith(tmp)) return true;
  const proj = key(path.join(canonical(os.homedir()), '.claude', 'projects')) + '/';
  if (k.startsWith(proj)) {
    const parts = k.slice(proj.length).split('/');
    return parts.length >= 3 && parts[0] !== '' && parts[1] === 'memory';
  }
  return false;
}

export function currentBranch(root) {
  let head;
  try {
    head = fs.readFileSync(path.join(root, '.git', 'HEAD'), 'utf8').trim();
  } catch {
    return null;
  }
  const m = /^ref: refs\/heads\/(\S+)$/.exec(head);
  return m ? m[1] : null;
}

export function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

// ---------------------------------------------------------------- plans

/** Strict plan parser (spec section 5.8). Throws Error on an invalid Allowed paths section. */
export function parsePlan(text) {
  const lines = text.split(/\r?\n/);
  let inFence = false;
  let slug = null;
  let branch = null;
  let headingIdx = -1;
  let headingCount = 0;
  lines.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    if (slug === null) {
      const m = /^- Slug: `([^`]+)`/.exec(l);
      if (m) slug = m[1];
    }
    if (branch === null) {
      const m = /^- Branch: `([^`]+)`/.exec(l);
      if (m) branch = m[1];
    }
    if (l.trim() === '## Allowed paths') {
      headingCount += 1;
      headingIdx = i;
    }
  });
  if (headingCount !== 1) throw new Error('plan must contain exactly one "## Allowed paths" section');
  const entries = [];
  for (let i = headingIdx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^## /.test(l)) break;
    if (!l.trim()) continue;
    const m = /^- `([^`]+)`\s*$/.exec(l);
    if (!m) throw new Error(`invalid line in Allowed paths: "${l.trim()}"`);
    entries.push(m[1]);
  }
  return { slug, branch, entries };
}

/** Returns null if the entry is valid, or a reason string. */
export function entryProblem(entry) {
  if (typeof entry !== 'string' || !entry) return 'empty entry';
  if (entry.includes('\\')) return `backslash in entry "${entry}"`;
  if (entry.startsWith('/') || /^[a-zA-Z]:/.test(entry)) return `absolute path in entry "${entry}"`;
  const base = entry.endsWith('/**') ? entry.slice(0, -3) : entry;
  if (!base) return `bare wildcard entry "${entry}"`;
  if (/[*?[\]{}]/.test(base)) return `unsupported wildcard in entry "${entry}"`;
  const comps = base.split('/');
  if (comps.some((c) => c === '' || c === '.' || c === '..')) return `invalid component in entry "${entry}"`;
  if (isProtectedRel(base)) return `protected path in entry "${entry}"`;
  return null;
}

export function matchEntry(rel, entry) {
  const r = IS_WIN ? rel.toLowerCase() : rel;
  const e = IS_WIN ? entry.toLowerCase() : entry;
  if (e.endsWith('/**')) return r.startsWith(e.slice(0, -2));
  return r === e;
}

export function findPlanFiles(root, slug) {
  const dir = path.join(root, 'doc', 'specs');
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const re = new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${slug}\\.md$`);
  return names.filter((n) => re.test(n)).map((n) => `doc/specs/${n}`);
}

/** Validates a plan for approval. Returns { plan } or { error }. */
export function validatePlanForApproval(root, slug) {
  const files = findPlanFiles(root, slug);
  if (files.length !== 1) return { error: `expected exactly one plan doc/specs/<date>-${slug}.md, found ${files.length}` };
  const planPath = files[0];
  let text;
  try {
    text = fs.readFileSync(path.join(root, planPath), 'utf8');
  } catch (e) {
    return { error: `cannot read ${planPath}: ${e.message}` };
  }
  let plan;
  try {
    plan = parsePlan(text);
  } catch (e) {
    return { error: `${planPath}: ${e.message}` };
  }
  if (plan.slug !== slug) return { error: `${planPath}: "- Slug:" line must be \`${slug}\`` };
  if (!plan.branch || !BRANCH_RE.test(plan.branch)) {
    return { error: `${planPath}: "- Branch:" must match feat|fix|chore/<slug>` };
  }
  if (!plan.entries.length) return { error: `${planPath}: Allowed paths section is empty` };
  for (const e of plan.entries) {
    const p = entryProblem(e);
    if (p) return { error: `${planPath}: ${p}` };
  }
  return { plan: { ...plan, planPath, planSha256: sha256File(path.join(root, planPath)) } };
}

// ---------------------------------------------------------------- approval state

export function statePath(root) {
  return path.join(root, '.git', 'claude-oxeye', 'approvals.json');
}

export function emptyState() {
  return { version: 1, approvals: {}, dependencies: {}, log: [] };
}

export function loadState(root) {
  let raw;
  try {
    raw = fs.readFileSync(statePath(root), 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { state: emptyState() };
    return { state: emptyState(), error: `unreadable approval state (${e.message}); treated as empty` };
  }
  try {
    const s = JSON.parse(raw);
    if (!s || s.version !== 1 || !s.approvals || typeof s.approvals !== 'object' || Array.isArray(s.approvals)) {
      throw new Error('unexpected structure');
    }
    if (!Array.isArray(s.log)) s.log = [];
    if (!s.dependencies || typeof s.dependencies !== 'object' || Array.isArray(s.dependencies)) s.dependencies = {};
    return { state: s };
  } catch (e) {
    return { state: emptyState(), error: `malformed approval state (${e.message}); treated as empty` };
  }
}

export function saveState(root, state) {
  const p = statePath(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
  fs.renameSync(tmp, p);
}

/** Approved plans bound to `branch` whose plan file is unchanged since approval. */
export function approvedPlansForBranch(root, branch) {
  const { state, error } = loadState(root);
  const notes = error ? [error] : [];
  const plans = [];
  for (const [slug, a] of Object.entries(state.approvals)) {
    if (!a || typeof a !== 'object' || a.branch !== branch) continue;
    if (typeof a.planPath !== 'string' || !PLAN_FILE_RE.test(a.planPath) || !/^[0-9a-f]{64}$/.test(a.planSha256 || '')) {
      notes.push(`approval ${slug}: malformed record ignored`);
      continue;
    }
    let sha;
    try {
      sha = sha256File(path.join(root, a.planPath));
    } catch {
      notes.push(`approval ${slug}: plan file missing`);
      continue;
    }
    if (sha !== a.planSha256) {
      notes.push(`approval ${slug}: plan changed since approval (re-approval required)`);
      continue;
    }
    let plan;
    try {
      plan = parsePlan(fs.readFileSync(path.join(root, a.planPath), 'utf8'));
    } catch (e) {
      notes.push(`approval ${slug}: ${e.message}`);
      continue;
    }
    if (plan.slug !== slug || plan.branch !== branch) {
      notes.push(`approval ${slug}: plan slug/branch mismatch`);
      continue;
    }
    const entries = plan.entries.filter((e) => entryProblem(e) === null);
    const ext = readExtensions(root, a.planPath);
    for (const p of ext.problems) notes.push(`execution log ${slug}: ${p}`);
    plans.push({ slug, entries: [...entries, ...ext.entries], planEntries: entries, extensions: ext.entries });
  }
  return { plans, notes };
}

// ---------------------------------------------------------------- execution log

export function logPathFor(planPath) {
  return planPath.replace(/\.md$/, '.log.md');
}

/** Returns null if a scope-extension entry is acceptable, or a reason string. */
export function extensionProblem(entry) {
  const p = entryProblem(entry);
  if (p) return p;
  const base = entry.endsWith('/**') ? entry.slice(0, -3) : entry;
  const comps = base.split('/');
  if (!EXTENDABLE_TOP.has(comps[0])) return `"${entry}" is outside src/, tests/, doc/ and public/; root files and configuration need an amended plan`;
  if (comps.length < 2) return `"${entry}" is too broad; name a module or file`;
  if (comps[0] === 'doc' && comps[1] === 'specs') return `"${entry}": doc/specs is managed by the plan workflow`;
  return null;
}

/**
 * Parses "## Scope extensions" in an execution log. Entries look like
 *   - `src/engine/emergency/**`: reason
 * Invalid lines are ignored and reported; they never widen the scope.
 */
export function parseLog(text) {
  const lines = text.split(/\r?\n/);
  const entries = [];
  const problems = [];
  let inSection = false;
  let inFence = false;
  for (const l of lines) {
    if (/^\s*(```|~~~)/.test(l)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^## /.test(l)) {
      inSection = l.trim() === '## Scope extensions';
      continue;
    }
    if (!inSection || !l.trim()) continue;
    const m = /^- `([^`]+)`\s*(?::|-|\u2014)\s*(\S.*)$/.exec(l);
    if (!m) {
      problems.push(`ignored line "${l.trim()}" (expected: - \`path\`: reason)`);
      continue;
    }
    const why = extensionProblem(m[1]);
    if (why) {
      problems.push(`ignored extension: ${why}`);
      continue;
    }
    if (entries.length >= MAX_EXTENSIONS) {
      problems.push(`more than ${MAX_EXTENSIONS} extensions; the rest are ignored (amend the plan instead)`);
      break;
    }
    entries.push(m[1]);
  }
  return { entries, problems };
}

function readExtensions(root, planPath) {
  let text;
  try {
    text = fs.readFileSync(path.join(root, logPathFor(planPath)), 'utf8');
  } catch {
    return { entries: [], problems: [] };
  }
  return parseLog(text);
}

// ---------------------------------------------------------------- write policy

/** True if `rel` (file or directory) lies inside the scope described by `entries`. */
export function inScope(rel, entries, { dir = false } = {}) {
  return entries.some((e) => matchEntry(rel, e) || (dir && e.endsWith('/**') && matchEntry(rel + '/', e)));
}

/**
 * Shared write policy for Edit/Write and for shell commands that write inside the repository.
 * Returns null when the write is allowed, or the reason it is not.
 */
export function repoWriteProblem(root, rel, { dir = false } = {}) {
  if (isProtectedRel(rel)) return `protected path: ${rel || '<repository root>'}. Protected configuration is installed manually by the user`;

  const top = rel.split('/')[0];
  if (GENERATED_TOP.has(top) || /^[^/]+\.tsbuildinfo$/.test(rel)) return null;

  const { state } = loadState(root);
  const pm = PLAN_FILE_RE.exec(rel);
  if (pm) {
    if (Object.prototype.hasOwnProperty.call(state.approvals, pm[1])) {
      return `plan "${pm[1]}" has an active approval and is frozen. Record decisions and scope extensions in ${logPathFor(rel)}; to change requirements the user sends REVOKE IMPLEMENTATION ${pm[1]}`;
    }
    return null;
  }

  const branch = currentBranch(root);
  const lm = LOG_FILE_RE.exec(rel);
  if (lm) {
    const a = state.approvals[lm[1]];
    if (!a || a.branch !== branch || logPathFor(a.planPath) !== rel) {
      return `execution log ${rel} is writable only while plan "${lm[1]}" is approved and its branch is checked out`;
    }
    return null;
  }

  if (!branch || branch === 'main' || branch === 'master' || !BRANCH_RE.test(branch)) {
    return `writes outside doc/specs/ require an approved feat|fix|chore/<slug> branch (current: ${branch ?? 'detached or unknown'})`;
  }
  const { plans, notes } = approvedPlansForBranch(root, branch);
  const why = notes.length ? ` (${notes.join('; ')})` : '';
  if (!plans.length) return `no valid approval for branch ${branch}${why}`;
  if (plans.some((p) => inScope(rel, p.entries, { dir }))) return null;
  return `${rel} is outside the approved scope of ${plans.map((p) => p.slug).join(', ')}. If the solution needs it and it is under src/, tests/, doc/ or public/, add it to "## Scope extensions" in the execution log with a reason; otherwise the plan must be amended${why}`;
}

// ---------------------------------------------------------------- dependencies

/** Parses "name" or "name@version" (scoped names allowed). Returns {name, version} or null. */
export function parseDepSpec(spec) {
  if (typeof spec !== 'string') return null;
  const at = spec.lastIndexOf('@');
  const name = at > 0 ? spec.slice(0, at) : spec;
  const version = at > 0 ? spec.slice(at + 1) : null;
  if (!NPM_NAME_RE.test(name)) return null;
  if (version !== null && !NPM_VERSION_RE.test(version)) return null;
  return { name, version };
}
