---
name: oxeye-verification
description: "OxEye verification procedure: recorded baseline, safe check order, generated artefacts, failure classification (introduced, pre-existing, flaky), seeded reproducibility and Windows notes. Use when running or reporting lint, type-check, unit, build or e2e checks, or when QA compares results with the baseline."
---

# OxEye verification

CLAUDE.md section 9 is authoritative. This skill gives the concrete baseline and procedure. Never report a check as passed unless it was run in this session, and quote the actual counts.

## 1. Recorded baseline (commit `63073a1`, 2026-11-25)

| Check | Command | Baseline |
|---|---|---|
| Type-check | `npx tsc --noEmit -p tsconfig.json` | exit 0 (`strict: false`) |
| Lint | `npm run lint` | 0 errors, 126 warnings |
| Unit | `npm run test` (`vitest run`) | 23 files, 117 tests, all passing |
| E2E | `npm run test:e2e` | **not run.** An earlier audit reported 12 failures tied to the outdated first-run flow. This is unverified, so treat it as unknown. |
| Build | `npm run build` | not recorded |

If the baseline is needed and is stale, ask the AI Lead to re-establish it. Do not infer it.

## 2. Generated artefacts

| Command | Writes | Ignored by Git? |
|---|---|---|
| `npx tsc -b`, `npm run build` | `*.tsbuildinfo` | yes |
| `npm run build` | `dist/` | yes |
| `npm run test:e2e` | `playwright-report/`, `test-results/` | **no**: report them and never stage them |
| `npx tsc --noEmit -p tsconfig.json` | nothing | — |

Prefer `npx tsc --noEmit -p tsconfig.json` over `tsc -b` for type-checking.

## 3. Safe order

Stop at the first step that shows an introduced failure, report it, and do not fix code outside your assignment.

1. `git status --short`: record the starting state.
2. `npx tsc --noEmit -p tsconfig.json`
3. `npx eslint <changed files>`: compare the warning count in those files with `main`.
4. `npx vitest run <targeted test files>`
5. `npx vitest run`: full unit suite.
6. `npm run lint`: full lint, compared with 0 errors and 126 warnings.
7. `npm run build`: only when the plan requires it or bundling or config changed.
8. `npm run test:e2e` or `npx playwright test <spec>`: only when the plan or the AI Lead asks.
9. `git status --short`: confirm that no unexpected files appeared.

## 4. Failure classification

| Class | Definition | Required evidence |
|---|---|---|
| introduced | Fails on the branch and passes on the baseline | Branch output and baseline output for the same test |
| pre-existing | Fails identically on the baseline | Baseline output, or the recorded baseline above when the counts match exactly |
| flaky | Result differs between two runs of the same commit | Both runs |

Rules:
- Rerun a failing test once before classifying it.
- Baseline comparisons that need a different checkout are done by the AI Lead (for example in a separate worktree). Subagents never switch branches, stash or reset.
- Never weaken, skip or delete an assertion to make a run pass unless the approved plan says so.

## 5. Seeded reproducibility

- Run `npx vitest run tests/unit/seed-reproducibility.test.ts` for any change under `src/engine/**`.
- New randomness that affects simulation must come from `rng(seed)` in `src/engine/crowd/grid-flow.ts`, or a generator derived from the scenario seed. Apply the `oxeye-invariants` I7 grep and compare it with the baseline of 12 matches.
- New tests use fixed seeds, no wall-clock dependence and no network.

## 6. Windows notes

- Shell is Git Bash. Paths arrive with backslashes; quote them.
- CRLF warnings from Git are not failures.
- Claude Code runs commands unsandboxed on native Windows.
- Playwright needs installed browsers. If they are missing, report it; do not run `npx playwright install` (blocked by the hooks; the user installs).
- Hook guards block `$VAR`, `$(...)`, heredocs, `--fix` and package installs. Rewrite the command plainly or report the need.

## 7. QA report format

| Command | Result (pass/fail counts, exit code) | Baseline | Delta |
|---|---|---|---|

Then list the failures with their class and evidence, the acceptance criteria mapped to tests or manual checks, the coverage gaps, and any generated directories.
