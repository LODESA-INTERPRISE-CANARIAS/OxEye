# Pivot cleanup: remove the OX-01…OX-25 traces from `main`

- Slug: `pivot-cleanup`
- Branch: `chore/pivot-cleanup`
- Base: `main` at `89e2f2a`
- Type: documentation and test-comment cleanup. No application code changes.

## Goal

The OX task plan is dropped. `main` must stop carrying its process artefacts (task plans, director summaries, the 65 000-line master plan, OX-numbered ADRs) while keeping every piece of real knowledge: the codebase audit, the security-hook specs, the product and simulation references, and the `test.fixme` reasons. The result is a clean starting point for the Logistics Manager branch.

## Inventory method

Verified on `main` at `89e2f2a` with `git grep -i -E "OX-[0-9][0-9]|ox-0..|ox-1..|ox-2..|ADR-024|INV-0|HITO-|DEMO-CRISTO|VAL-E2E|CHANGES-PLAN|director-summary|resumen-para-direccion|data-authority-map"` over the whole tree (excluding `package-lock.json`), plus a search for links into `doc/adr/`, `doc/architecture/`, `doc/audit/`, `drizzle` and `db/schema`. Branches checked with `git branch -a -vv` and `git log main..<branch>`.

Files on `main` with OX matches (count): `doc/CHANGES-PLAN.md` 68, `doc/audit/2026-11-25-ox-01-audit.md` 47, `doc/architecture/data-authority-map.md` 35, `doc/specs/2026-11-25-ox-02.md` 30, `doc/adr/ADR-024-001…` 25, `ADR-024-002…` 21, `doc/specs/2026-11-25-ox-01.md` 19, `ADR-024-005…` 18, `doc/adr/README.md` 12, `doc/specs/2026-11-25-ox-02-director-summary.md` 8, `doc/architecture/ox-02-resumen-para-direccion.md` 2, and one line each in `README.md`, `CLAUDE.md`, `.claude/agents/architect.md`, `tests/e2e/app.spec.ts`, `tests/e2e/diagnostics.spec.ts`. No matches in `src/`, `public/`, `.claude/hooks/`, `.claude/skills/`, `doc/claude/`, `doc/SPECIFICATIONS.md`, `doc/references/`, `doc/changes/` or the `claude-code-*` specs.

## DELETE

| Item | Reason |
|---|---|
| `doc/specs/2026-11-25-ox-01.md` | OX-01 task plan; its output (the audit) is kept separately |
| `doc/specs/2026-11-25-ox-02.md` | OX-02 task plan |
| `doc/specs/2026-11-25-ox-02-director-summary.md` | Plan for an OX director summary |
| `doc/architecture/ox-02-resumen-para-direccion.md` | OX-02 director summary |
| Local branches `feat/ox-01`, `feat/ox-02`, `feat/ox-03` | 0 commits ahead of `main` (fully merged). Deleted by the user |
| Remote branch `origin/feat/ox-02` | Fully merged. Deleted by the user |

## KEEP

| Item | Action | Reason |
|---|---|---|
| `doc/audit/2026-11-25-ox-01-audit.md` | Rename to `doc/audit/2026-11-25-codebase-audit.md`; reword title, metadata and OX-specific lines (see DECIDE 4) | Real technical-debt audit (architecture, cycles, persistence, invariant tests, known-issues register KI-xx) |
| `README.md` line 184 | Update the link to the renamed audit | Would be broken by the rename |
| `tests/e2e/app.spec.ts` line 73, `tests/e2e/diagnostics.spec.ts` line 5 | `FIXME(OX-01):` → `FIXME:`; reason text and `test.fixme` unchanged | The skip reasons are still valid |
| `doc/specs/2026-11-25-claude-code-*.md` (5 files) | Unchanged | Document the security hooks; referenced from hook sources. No OX mentions |
| `doc/SPECIFICATIONS.md`, `doc/references/**`, `doc/changes/**`, `doc/claude/01…04` | Unchanged | Product and simulation reference. No OX mentions found. Note: `doc/claude/02_ARQUITECTURA_Y_STACK.md:10` lists "Drizzle ORM" as persistence, which is inaccurate (Drizzle is unused); left for task B |
| `src/engine/logistics/{companies,phases,shift}.ts`, `tests/unit/logistics-sequencing.test.ts` | Untouched | Simulation logistics; candidates for reuse by the Logistics Manager |
| `src/db/schema.ts`, `drizzle-orm`, `drizzle-kit` | Untouched here | Root files; decided in task B |
| `feat/ox-03-proyectos-permisos`, `feat/ox-04-recinto-distribuciones` (local and remote) | Parked, untouched | Out of scope by instruction |
| `CLAUDE.md` lines 103 and 119, `.claude/agents/architect.md` line 19 | Not edited (protected) | Updated by the user's v5 patch. Line 103 also points to `doc/adr/` and `doc/architecture/`, which this cleanup may empty (DECIDE 2, 3) |

## DECIDE

| # | Item | What is lost if it goes | Recommendation |
|---|---|---|---|
| 1 | `doc/CHANGES-PLAN.md` (65 138 lines, 1.4 MB) | Master specification: INV/HITO/VAL codes, Cristo demo scenario, domain knowledge on inventory, calendar, deliveries, budget | Delete; the user keeps a copy outside the repo. It stays in git history (`git show 89e2f2a:doc/CHANGES-PLAN.md`) |
| 2 | `doc/adr/ADR-024-001-physical-architecture.md`, `ADR-024-002-database.md`, `ADR-024-005-offline-mode.md`, `doc/adr/README.md` | Option analysis (own server vs BaaS), PostgreSQL rationale, offline policy table | Delete now; task B's new ADR carries the valid rules: PostgreSQL authoritative, UUIDs, `version` for optimistic concurrency, `timestamptz` + `Atlantic/Canary`, versioned forward-only SQL migrations, secrets only on the server, Punto Violeta never stored centrally, Dexie as cache/drafts, offline drafts with honest sync state |
| 3 | `doc/architecture/data-authority-map.md` | Owner-domain table for 20 entities, transition strategy, OX-03…OX-22 cross-check | Delete; its entity list follows the old master plan, not the Logistics Manager. The one idea worth keeping (one owner module per entity) goes into the task B ADR |
| 4 | Content of the renamed audit | Section 10.2 (gap matrix per OX-02…OX-24 task) and 10.3 (task-card statements vs code) | Keep sections 1–9, 10.1, 11, 12. Remove 10.2 and 10.3 (OX task framing; the factual findings are already in the KI register). Replace "deferred to OX-24" / "OX-01 scope" with neutral wording; keep commits and `feat/ox-01` references as historical facts in the metadata |
| 5 | Other fully merged branches: `chore/claude-code-setup`, `chore/claude-v4`, `mapa-y-perimetros`, `mod-panel-objeto` (local + `origin/mod-panel-objeto`) | Nothing: 0 commits ahead of `main` | Delete (by the user) |
| 6 | Local-only branches `chore/ox-02-design-decisions` (tip `5113cf5`) and `chore/ox-04-director-guide` (tip `3511320`) | Nothing: both tips are ancestors of the parked branches (`feat/ox-03-proyectos-permisos`, `feat/ox-04-recinto-distribuciones`); never pushed | Delete (by the user, `git branch -D`, after the ancestry check given in the A3 report) |

### User answers (2026-11-25)

DECIDE 1–6: all approved as recommended. Item 5 applies only to branches with 0 commits ahead of `main`; the A3 report includes the check (`git log --oneline main..<branch>` must print nothing) before each deletion command.

Deletions: the first ten paths below. Rename: the two audit paths (old, new). Edits: `README.md` and the two E2E files. Plus this plan and its log.

## Allowed paths

- `doc/specs/2026-11-25-ox-01.md`
- `doc/specs/2026-11-25-ox-02.md`
- `doc/specs/2026-11-25-ox-02-director-summary.md`
- `doc/architecture/ox-02-resumen-para-direccion.md`
- `doc/CHANGES-PLAN.md`
- `doc/adr/ADR-024-001-physical-architecture.md`
- `doc/adr/ADR-024-002-database.md`
- `doc/adr/ADR-024-005-offline-mode.md`
- `doc/adr/README.md`
- `doc/architecture/data-authority-map.md`
- `doc/audit/2026-11-25-ox-01-audit.md`
- `doc/audit/2026-11-25-codebase-audit.md`
- `README.md`
- `tests/e2e/app.spec.ts`
- `tests/e2e/diagnostics.spec.ts`
- `doc/specs/2026-11-25-pivot-cleanup.md`
- `doc/specs/2026-11-25-pivot-cleanup.log.md`

## Invariants touched

None. No source, engine, persistence or export code changes. The two E2E files only change a comment label.

## Verification

1. Baseline on `main` before changes (`oxeye-verification`): `npm run lint`, `npx tsc --noEmit -p tsconfig.json`, `npm run test`, `npm run build`.
2. After changes: same four checks, compared with the baseline; E2E `npx playwright test tests/e2e/app.spec.ts tests/e2e/diagnostics.spec.ts` because those files are touched (expected: same pass/fixme counts as baseline).
3. `git grep -i -E "OX-[0-9][0-9]|ADR-024|INV-0|HITO-|DEMO-CRISTO|VAL-E2E|CHANGES-PLAN|ox-01-audit"` on the branch returns only `CLAUDE.md`, `.claude/agents/architect.md` (protected, v5 patch), the historical metadata lines of the audit, and this plan and its log.
4. No broken relative links in `README.md` and `doc/**` to deleted or renamed files.

## Acceptance criteria

- Every approved DELETE and DECIDE item is applied, nothing else is removed.
- Lint, type-check, unit tests and build match the baseline; E2E counts unchanged.
- One local commit `DOC: Limpieza de los restos del plan OX`.
- The report gives the user the branch-deletion commands, an optional `git bundle` backup of the parked branches, and the exact text still needed in `CLAUDE.md` / `.claude/`.
