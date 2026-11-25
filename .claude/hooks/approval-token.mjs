#!/usr/bin/env node
// UserPromptSubmit hook: records or revokes implementation approvals.
// Spec: doc/specs/2026-11-25-claude-code-security-setup.md, section 5.7.
// Only a prompt that is exactly "APPROVE IMPLEMENTATION <slug>" or
// "REVOKE IMPLEMENTATION <slug>" (after trimming) changes state. The hook
// never blocks the prompt: on any failure no approval is recorded.
// v4: "APPROVE DEPENDENCY <name>[@<version>]" and "REVOKE DEPENDENCY <name>"
// record which new npm packages the AI Lead may install (see guard-bash).

import { readStdin, parseInput, repoRoot, loadState, saveState, validatePlanForApproval, parseDepSpec, Deny } from './lib/common.mjs';

const TOKEN_RE = /^(APPROVE|REVOKE) IMPLEMENTATION ([a-z0-9]+(?:-[a-z0-9]+)*)$/;
const DEP_TOKEN_RE = /^(APPROVE|REVOKE) DEPENDENCY (\S+)$/;

async function main() {
  const input = parseInput(await readStdin());
  if (typeof input.prompt !== 'string') return;
  const dm = DEP_TOKEN_RE.exec(input.prompt.trim());
  if (dm) return dependency(input, dm[1], dm[2]);
  const m = TOKEN_RE.exec(input.prompt.trim());
  if (!m) return;
  const [, action, slug] = m;
  const root = repoRoot(input);
  const { state, error } = loadState(root);
  if (error) process.stderr.write(`[oxeye-approval] ${error}\n`);
  const at = new Date().toISOString();

  if (action === 'REVOKE') {
    if (!Object.prototype.hasOwnProperty.call(state.approvals, slug)) {
      process.stdout.write(`[oxeye-approval] No active approval for "${slug}"; nothing revoked.\n`);
      return;
    }
    delete state.approvals[slug];
    state.log.push({ action: 'revoke', slug, at });
    saveState(root, state);
    process.stdout.write(`[oxeye-approval] Approval REVOKED for "${slug}".\n`);
    return;
  }

  const { plan, error: planError } = validatePlanForApproval(root, slug);
  if (!plan) {
    process.stdout.write(`[oxeye-approval] Approval NOT recorded for "${slug}": ${planError}\n`);
    return;
  }
  state.approvals[slug] = { planPath: plan.planPath, planSha256: plan.planSha256, branch: plan.branch, approvedAt: at };
  state.log.push({ action: 'approve', slug, at, planSha256: plan.planSha256 });
  saveState(root, state);
  process.stdout.write(
    `[oxeye-approval] Approval recorded for "${slug}" (plan ${plan.planPath}, sha256 ${plan.planSha256.slice(0, 12)}, branch ${plan.branch}, ${plan.entries.length} allowed path entries).\n`,
  );
}

function dependency(input, action, spec) {
  const dep = parseDepSpec(spec);
  if (!dep || (action === 'REVOKE' && dep.version !== null)) {
    process.stdout.write(`[oxeye-approval] Dependency approval NOT recorded: "${spec}" is not a valid npm package name${action === 'APPROVE' ? ' (optionally @<version>)' : ''}.\n`);
    return;
  }
  const root = repoRoot(input);
  const { state, error } = loadState(root);
  if (error) process.stderr.write(`[oxeye-approval] ${error}\n`);
  const at = new Date().toISOString();
  if (action === 'REVOKE') {
    if (!Object.prototype.hasOwnProperty.call(state.dependencies, dep.name)) {
      process.stdout.write(`[oxeye-approval] No approved dependency "${dep.name}"; nothing revoked.\n`);
      return;
    }
    delete state.dependencies[dep.name];
    state.log.push({ action: 'revoke-dependency', name: dep.name, at });
    saveState(root, state);
    process.stdout.write(`[oxeye-approval] Dependency approval REVOKED for "${dep.name}".\n`);
    return;
  }
  state.dependencies[dep.name] = { version: dep.version, approvedAt: at };
  state.log.push({ action: 'approve-dependency', name: dep.name, version: dep.version, at });
  saveState(root, state);
  process.stdout.write(
    `[oxeye-approval] Dependency approved: "${dep.name}"${dep.version ? ` (version ${dep.version})` : ' (any version)'}. It can be installed with npm install on an approved task branch.\n`,
  );
}

main()
  .catch((e) => {
    const msg = e instanceof Deny ? e.message : `internal error: ${(e && e.message) || e}`;
    process.stdout.write(`[oxeye-approval] Approval state NOT changed: ${msg}\n`);
    process.stderr.write(`[oxeye-approval] ${msg}\n`);
  })
  .finally(() => process.exit(0));
