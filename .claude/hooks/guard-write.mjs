#!/usr/bin/env node
// PreToolUse guard for Edit, Write, MultiEdit and NotebookEdit.
// Spec: doc/specs/2026-11-25-claude-code-security-setup.md, section 5.5.
// v4: the write policy lives in lib/common.mjs (repoWriteProblem) and is shared with guard-bash.

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
  repoWriteProblem,
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

  // 2. Component checks and hard links.
  checkRelComponents(rel);
  if (isProtectedRel(rel)) {
    deny(`protected path: ${rel || '<repository root>'}. Protected configuration is installed manually by the user`);
  }
  try {
    if (fs.lstatSync(abs).nlink > 1) deny(`file has multiple hard links: ${rel}`);
  } catch (e) {
    if (e && e.code !== 'ENOENT') throw e;
  }

  // 3. Shared write policy: plan files (frozen once approved), execution logs,
  //    generated output, and code within the approved scope plus logged extensions.
  const problem = repoWriteProblem(root, rel);
  if (problem) deny(problem);
});
