---
name: oxeye-verification
description: "OxEye verification procedure: recorded baseline, check order, formatting, visual review by palette, generated artefacts, failure classification (introduced, pre-existing, flaky), seeded reproducibility and Windows notes. Use when running or reporting lint, type-check, unit, build, e2e or visual checks, or when QA compares results with the baseline."
---

# OxEye verification

The "Definition of done" section of CLAUDE.md is authoritative. This skill gives the concrete baseline and procedure. Never report a check as passed unless it was run in this session, and quote the actual counts.

## 1. Recorded baseline (commit `1b30dfc`, 2026-11-25, Linux, Node 22)

| Check | Command | Baseline |
|---|---|---|
| Type-check | `npx tsc --noEmit -p tsconfig.json` | exit 0 (`strict: false`) |
| Lint | `npm run lint` | 0 errors, 2 warnings (`ComparisonDialog.tsx` exhaustive-deps, `response-model.ts` unused `resolveAccessCategory`) |
| Unit | `npm run test` (`vitest run`) | 23 files, 117 tests, all passing |
| Build | `npm run build` | exit 0 (chunk-size warning only) |
| E2E | `npm run test:e2e` | 11 passed, 2 skipped (`test.fixme`), 0 failed; plus 4 passing in `visual-palettes.spec.ts` once installed |

Numbers on Windows may differ slightly (line endings, browser build). If the baseline looks stale, re-establish it on `main` and say so; do not infer it.

## 2. Generated artefacts (all git-ignored)

| Command | Writes |
|---|---|
| `npm run build` | `dist/`, `*.tsbuildinfo` |
| `npm run test:e2e`, `npx playwright test` | `playwright-report/`, `test-results/` (wiped at the start of each run) |
| `visual-palettes.spec.ts` | `test-results/visual/<screen>-<palette>.png` |
| `npx tsc --noEmit -p tsconfig.json` | nothing |

Never stage generated files.

## 3. Check order

Chain related commands in one call when useful (`a && b`, `cmd 2>&1 | tail -40`). Stop at the first introduced failure, fix it if it is in scope, and rerun only what failed while iterating.

1. `git status --short`: starting state.
2. `npx prettier --write <changed files>` and `npx eslint --fix <changed files>`: explicit files only, never untouched ones.
3. `npx tsc --noEmit -p tsconfig.json`
4. `npx eslint <changed files>`: no new warnings in changed code.
5. `npx vitest run <targeted test files>`, then `npx vitest run` for the full unit suite.
6. `npm run lint`: compare with the baseline.
7. `npm run build`: for any code change.
8. `npx playwright test <spec>` for changed user flows; `npm run test:e2e` for the final comparison when flows changed.
9. Visual review for UI changes (section 4).
10. `git status --short`: no unexpected files.

## 4. Visual review by palette

`npx playwright test tests/e2e/visual-palettes.spec.ts` captures the menu, settings, wizard and workspace in all six palettes (oxeye, atlas, noctis, territorio, vector, bendy). Use `-g workspace` (or another screen name) to capture one screen.

- Open the images with Read and check hierarchy, contrast, clipped or overflowing text, spacing, empty/loading/error states and focus visibility in every palette.
- When a feature adds a screen, panel or state that matters, add a case to the spec (navigate there, then `captureAll(page, '<screen>')`).
- Report what you looked at and what you saw; say plainly what could not be checked.

## 5. Failure classification

| Class | Definition | Required evidence |
|---|---|---|
| introduced | Fails on the branch and passes on the baseline | Branch output and baseline output for the same test |
| pre-existing | Fails identically on the baseline | Baseline output, or the recorded baseline above when the counts match exactly |
| flaky | Result differs between two runs of the same commit | Both runs |

Rules:
- Rerun a failing test once before classifying it.
- Baseline comparisons that need a different checkout are done by the AI Lead (for example in a separate worktree). Subagents never switch branches, stash or reset.
- Never weaken, skip or delete an assertion to make a run pass unless the approved plan says so.

## 6. Seeded reproducibility

- Run `npx vitest run tests/unit/seed-reproducibility.test.ts` for any change under `src/engine/**`.
- New randomness that affects simulation must come from `rng(seed)` in `src/engine/crowd/grid-flow.ts`, or a generator derived from the scenario seed. Apply the `oxeye-invariants` I7 grep and compare it with the baseline of 12 matches.
- New tests use fixed seeds, no wall-clock dependence and no network.

## 7. Windows notes

- Shell is Git Bash. Paths arrive with backslashes; quote them.
- CRLF warnings from Git are not failures.
- Playwright needs installed browsers. If they are missing, report it; `npx playwright install` is blocked by the hooks and the user installs them.
- The hooks block `$VAR`, `$(...)`, heredocs, file redirections for subagents, installs of unapproved packages and formatter writes outside the approved scope. Rewrite the command plainly or report the need.

## 8. QA report format

| Command | Result (pass/fail counts, exit code) | Baseline | Delta |
|---|---|---|---|

Then list the failures with their class and evidence, the acceptance criteria mapped to tests or manual checks, what the visual review showed per palette, and the coverage gaps.
