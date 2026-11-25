#!/usr/bin/env node
// PreToolUse guard for Edit, Write, MultiEdit and NotebookEdit.
// Spec: doc/specs/2026-11-25-claude-code-security-setup.md, section 5.5.

import fs from 'node:fs';
import path from 'node:path';
import {
  runHook,
  deny,
  repoRoot,
  canonical,
  checkRawPath,
  relativeInRepo,
  checkRelComponents,
  isProtectedRel,
  outsideAllowed,
  currentBranch,
  loadState,
  approvedPlansForBranch,
  matchEntry,
  BRANCH_RE,
  PLAN_FILE_RE,
} from './lib/common.mjs';

const TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

runHook('write', (input) => {
  if (!TOOLS.has(input.tool_name)) deny(`unexpected tool "${input.tool_name}"`);
  const ti = input.tool_input;
  if (!ti || typeof ti !== 'object') deny('missing tool_input');
  const raw =
    typeof ti.file_path === 'string' && ti.file_path
      ? ti.file_path
      : typeof ti.notebook_path === 'string' && ti.notebook_path
        ? ti.notebook_path
        : null;
  if (!raw) deny('no file_path or notebook_path in tool_input');

  const root = repoRoot(input);
  checkRawPath(raw);
  const base = typeof input.cwd === 'string' && input.cwd ? input.cwd : root;
  const abs = canonical(path.resolve(base, raw));
  const rel = relativeInRepo(abs, root);

  // 1. Outside the repository.
  if (rel === null) {
    if (outsideAllowed(abs)) return;
    deny(`writing outside the repository is limited to the Claude scratchpad and project memory: ${abs}`);
  }

  // 2. Protected paths (no approval can override this).
  checkRelComponents(rel);
  if (isProtectedRel(rel)) {
    deny(`protected path: ${rel || '<repository root>'}. Protected configuration is installed manually by the user`);
  }
  try {
    if (fs.lstatSync(abs).nlink > 1) deny(`file has multiple hard links: ${rel}`);
  } catch (e) {
    if (e && e.code !== 'ENOENT') throw e;
  }

  // 3. Plan files: writable on any branch unless the plan is approved (frozen).
  const pm = PLAN_FILE_RE.exec(rel);
  if (pm) {
    const { state } = loadState(root);
    if (Object.prototype.hasOwnProperty.call(state.approvals, pm[1])) {
      deny(`plan "${pm[1]}" has an active approval and is frozen. The user must send REVOKE IMPLEMENTATION ${pm[1]} before it can be revised`);
    }
    return;
  }

  // 4. Branch.
  const branch = currentBranch(root);
  if (!branch || branch === 'main' || branch === 'master' || !BRANCH_RE.test(branch)) {
    deny(`writes outside doc/specs/ require an approved feat|fix|chore/<slug> branch (current: ${branch ?? 'detached or unknown'})`);
  }

  // 5-6. Approval and allowed paths.
  const { plans, notes } = approvedPlansForBranch(root, branch);
  const why = notes.length ? ` (${notes.join('; ')})` : '';
  if (!plans.length) deny(`no valid approval for branch ${branch}${why}`);
  if (plans.some((p) => p.entries.some((e) => matchEntry(rel, e)))) return;
  deny(`${rel} is not listed under "## Allowed paths" of the approved plan(s): ${plans.map((p) => p.slug).join(', ')}${why}`);
});
