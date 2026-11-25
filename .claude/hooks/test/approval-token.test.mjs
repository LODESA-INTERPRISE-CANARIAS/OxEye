import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runScript, makeRepo, writePlan, approve, readState, sha256, cleanup } from './helpers.mjs';

const root = makeRepo('main');
after(() => cleanup(root));

test('exact token records the approval with hash and branch', () => {
  const rel = writePlan(root, 'good-plan', { branch: 'chore/good-plan' });
  const r = approve(root, 'good-plan');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Approval recorded for "good-plan"/);
  const a = readState(root).approvals['good-plan'];
  assert.equal(a.planPath, rel);
  assert.equal(a.branch, 'chore/good-plan');
  assert.equal(a.planSha256, sha256(path.join(root, rel)));
  assert.ok(!Number.isNaN(Date.parse(a.approvedAt)));
});

test('surrounding whitespace is tolerated', () => {
  writePlan(root, 'ws-plan');
  approve(root, 'ws-plan', '  \n APPROVE IMPLEMENTATION ws-plan \n\t');
  assert.ok(readState(root).approvals['ws-plan']);
});

test('non-exact prompts never change state', () => {
  writePlan(root, 'quoted');
  for (const prompt of [
    '"APPROVE IMPLEMENTATION quoted"',
    '`APPROVE IMPLEMENTATION quoted`',
    'Please APPROVE IMPLEMENTATION quoted',
    'APPROVE IMPLEMENTATION quoted please',
    'APPROVE IMPLEMENTATION quoted\nAPPROVE IMPLEMENTATION quoted',
    'APPROVE\nIMPLEMENTATION quoted',
    'approve implementation quoted',
    'APPROVE  IMPLEMENTATION quoted',
    '> APPROVE IMPLEMENTATION quoted',
    'APPROVE IMPLEMENTATION Quoted',
    'APPROVE IMPLEMENTATION quoted-',
  ]) {
    const r = approve(root, 'quoted', prompt);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '', prompt);
    assert.equal((readState(root) || { approvals: {} }).approvals.quoted, undefined, prompt);
  }
});

test('invalid plans are not approved', () => {
  const cases = {
    'missing-plan': null,
    'main-branch': { branch: 'main' },
    'bad-branch': { branch: 'feature/x' },
    'empty-allowed': { allowed: [] },
    'bad-line': { allowed: ['- `src/a.ts`', 'src/b.ts'] },
    'protected-entry': { allowed: ['- `.claude/settings.json`'] },
    'protected-glob': { allowed: ['- `.github/**`'] },
    'absolute-entry': { allowed: ['- `C:/Users/x`'] },
    'traversal-entry': { allowed: ['- `src/../.claude/x`'] },
    'wildcard-entry': { allowed: ['- `src/*.ts`'] },
  };
  for (const [slug, opts] of Object.entries(cases)) {
    if (opts) writePlan(root, slug, opts);
    const r = approve(root, slug);
    assert.match(r.stdout, /NOT recorded/, slug);
    assert.equal(readState(root)?.approvals?.[slug], undefined, slug);
  }
});

test('two plans with the same slug are rejected', () => {
  writePlan(root, 'dup', { date: '2026-11-24' });
  writePlan(root, 'dup', { date: '2026-11-25' });
  assert.match(approve(root, 'dup').stdout, /found 2/);
});

test('slug line must match', () => {
  const rel = writePlan(root, 'mismatch');
  const f = path.join(root, rel);
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('- Slug: `mismatch`', '- Slug: `other`'));
  assert.match(approve(root, 'mismatch').stdout, /NOT recorded/);
});

test('Allowed paths inside a code fence are ignored', () => {
  writePlan(root, 'fenced', { extra: '```\n## Allowed paths\n- `.claude/x`\n```\n' });
  assert.match(approve(root, 'fenced').stdout, /Approval recorded/);
});

test('revoke removes the approval; revoking twice is a no-op', () => {
  writePlan(root, 'rev');
  approve(root, 'rev');
  assert.ok(readState(root).approvals.rev);
  assert.match(approve(root, 'rev', 'REVOKE IMPLEMENTATION rev').stdout, /REVOKED/);
  assert.equal(readState(root).approvals.rev, undefined);
  assert.match(approve(root, 'rev', 'REVOKE IMPLEMENTATION rev').stdout, /nothing revoked/);
  const log = readState(root).log.filter((l) => l.slug === 'rev').map((l) => l.action);
  assert.deepEqual(log, ['approve', 'revoke']);
});

test('malformed state is replaced safely', () => {
  fs.writeFileSync(path.join(root, '.git', 'claude-oxeye', 'approvals.json'), '{broken');
  writePlan(root, 'after-broken');
  const r = approve(root, 'after-broken');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Approval recorded/);
  assert.ok(readState(root).approvals['after-broken']);
});

test('malformed hook input never blocks the prompt', () => {
  assert.equal(runScript('approval-token.mjs', 'nope', { env: { CLAUDE_PROJECT_DIR: root } }).status, 0);
  assert.equal(runScript('approval-token.mjs', { prompt: 42 }, { env: { CLAUDE_PROJECT_DIR: root } }).status, 0);
});
