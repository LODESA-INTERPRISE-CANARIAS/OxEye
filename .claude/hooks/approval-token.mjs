#!/usr/bin/env node
// UserPromptSubmit hook: records or revokes implementation approvals.
// Spec: doc/specs/2026-11-25-claude-code-security-setup.md, section 5.7.
// Only a prompt that is exactly "APPROVE IMPLEMENTATION <slug>" or
// "REVOKE IMPLEMENTATION <slug>" (after trimming) changes state. The hook
// never blocks the prompt: on any failure no approval is recorded.

import { readStdin, parseInput, repoRoot, loadState, saveState, validatePlanForApproval, Deny } from './lib/common.mjs';

const TOKEN_RE = /^(APPROVE|REVOKE) IMPLEMENTATION ([a-z0-9]+(?:-[a-z0-9]+)*)$/;

async function main() {
  const input = parseInput(await readStdin());
  if (typeof input.prompt !== 'string') return;
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

main()
  .catch((e) => {
    const msg = e instanceof Deny ? e.message : `internal error: ${(e && e.message) || e}`;
    process.stdout.write(`[oxeye-approval] Approval state NOT changed: ${msg}\n`);
    process.stderr.write(`[oxeye-approval] ${msg}\n`);
  })
  .finally(() => process.exit(0));
