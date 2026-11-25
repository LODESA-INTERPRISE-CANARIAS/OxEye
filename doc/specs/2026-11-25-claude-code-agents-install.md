# Plan: Install the OxEye Claude Code agent roster (Batch 1)

- Slug: `claude-code-agents-install`
- Date: 2026-11-25
- Branch: `chore/claude-code-setup` (existing local branch, based on `63073a1`)
- Status: awaiting `APPROVE IMPLEMENTATION claude-code-agents-install`

## Objective

Install the eight reviewed subagent definitions under `.claude/agents/` so that Claude Code recognizes them. This is configuration only; no product behaviour changes.

## Scope

Create exactly these files, byte-identical to the validated copies in the session scratchpad (`scratchpad/agentcheck/.claude/agents/`):

| File | SHA-256 |
|---|---|
| `.claude/agents/architect.md` | `716a953fe05a7287e81801467e1a0d146e771cd80990331020528b43cec2d4fa` |
| `.claude/agents/ui-engineer.md` | `04a0dae8c6b43a66717302de04a46063b12da2203f2badc9c89610872acc2a10` |
| `.claude/agents/simulation-engineer.md` | `c141e0f2d9a233e6794f2443a7d57a83effda4412a160245bd8be1ec16e7f147` |
| `.claude/agents/emergency-engineer.md` | `27c3eed7c77693e1e878cbceb7aa09b11b6f69a96f6cb2c9dfa75259e22daf88` |
| `.claude/agents/cartography-engineer.md` | `5d2ffee4bf40f421caf690edc8eb3aa2616f03f558c98afc91664123b5db172a` |
| `.claude/agents/qa-engineer.md` | `c2db41b2f77dc4b3af0d128dbdd64c5a7f3567e91fdf5e4c2943f7aaa9b9e9e3` |
| `.claude/agents/code-reviewer.md` | `23ba3e26650d1804d7d7a4fb839e43d08a666b0640577c6860baf25fa72a016b` |
| `.claude/agents/safety-auditor.md` | `86f5fa1e0eb919a37fce4e3fb4025223c55e55db6fc12e6c4fb74636eac08c77` |

## Exclusions

- No skills, settings, hooks or `.mcp.json` (Batch 2).
- No changes to `CLAUDE.md`, `src/**`, `tests/**`, configuration files or any other existing file.
- No Git write operations: no commit, merge, branch change, stash or push. No remote operation of any kind.

## Known dependencies and limitations

- Six agents reference `.claude/hooks/agent-bash-allowlist.mjs` (roles `implementer`, `qa`, `reviewer`) with `onFailure: block`. The script does not exist yet, so their Bash use is expected to be blocked or to fail. This behaviour is untested.
- `qa-engineer` references the skill `oxeye-verification`, and `safety-auditor` references `oxeye-invariants`. Neither exists yet; per the documentation, a missing skill is skipped with a debug-log warning. Both agents are instructed to stop if their skill content is absent.
- Path-based write protection is not installed. Implementer agents and `qa-engineer` must not be used to modify code until Batch 2 is installed and tested in Batch 3.

## Domain invariants

None affected: no source code changes.

## Agent assignments

None. The AI Lead creates the files directly.

## Verification

1. Strict YAML parse of all eight frontmatters (`yaml` package, strict mode, unique keys), plus structural checks: name matches the filename, unique names, documented keys, valid colours, no `Agent` tool, hook present if and only if Bash is present, no duplicated sections.
2. SHA-256 of each installed file matches the table above.
3. Headless `claude -p` in the repository with only the `Agent` tool visible lists all eight agents and their tools.
4. `git status --short` and `git diff --stat` show only the eight new untracked files under `.claude/agents/`, plus this plan file.

## Rollback

Delete the eight files under `.claude/agents/`. No other state changes.

## Acceptance criteria

- The eight files exist with the listed hashes.
- All verification steps pass.
- No other file in the working tree has changed.

## Allowed paths

- `.claude/agents/architect.md`
- `.claude/agents/ui-engineer.md`
- `.claude/agents/simulation-engineer.md`
- `.claude/agents/emergency-engineer.md`
- `.claude/agents/cartography-engineer.md`
- `.claude/agents/qa-engineer.md`
- `.claude/agents/code-reviewer.md`
- `.claude/agents/safety-auditor.md`
