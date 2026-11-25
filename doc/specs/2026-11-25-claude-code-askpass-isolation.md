# Plan: Disable Git askpass prompts in Claude Code's environment

- Slug: `claude-code-askpass-isolation`
- Date: 2026-11-25
- Branch: `chore/claude-code-setup`
- Status: awaiting `APPROVE IMPLEMENTATION claude-code-askpass-isolation`
- Origin: finding F8 in `doc/specs/2026-11-25-claude-code-security-validation-report.md`

## Objective

Close the remaining interactive credential path. With `credential.helper` reset and `GIT_TERMINAL_PROMPT=0`, Git for Windows still shows its built-in askpass dialog, which asks for a GitHub username and password. A human could complete that dialog when Claude triggers a Git network operation. The fix makes any askpass request fail immediately inside Claude Code's environment.

## Evidence

- Claude's shell defines no `GIT_ASKPASS` or `SSH_ASKPASS` (user check `! printenv | grep -i askpass`).
- `core.askPass` is not configured in any scope.
- In the user's terminal, `GIT_ASKPASS=false SSH_ASKPASS=false` on the T-U3 dry-run produced `could not read Username … terminal prompts disabled`, with no dialog.

## Change

Replace `.claude/settings.local.json` (uncommitted, machine-local) with:

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "env": {
    "GH_CONFIG_DIR": "C:\\Users\\FGL14\\.oxeye-claude\\gh-empty",
    "GH_TOKEN": "",
    "GITHUB_TOKEN": "",
    "GIT_TERMINAL_PROMPT": "0",
    "GCM_INTERACTIVE": "never",
    "GIT_ASKPASS": "false",
    "SSH_ASKPASS": "false",
    "GIT_CONFIG_COUNT": "4",
    "GIT_CONFIG_KEY_0": "credential.helper",
    "GIT_CONFIG_VALUE_0": "",
    "GIT_CONFIG_KEY_1": "remote.origin.pushurl",
    "GIT_CONFIG_VALUE_1": "https://push-disabled.invalid/blocked.git",
    "GIT_CONFIG_KEY_2": "core.sshCommand",
    "GIT_CONFIG_VALUE_2": "false",
    "GIT_CONFIG_KEY_3": "core.askPass",
    "GIT_CONFIG_VALUE_3": "false"
  }
}
```

Only `GIT_ASKPASS`, `SSH_ASKPASS` and the `GIT_CONFIG_*` index 3 are new. `GIT_CONFIG_COUNT` changes from 3 to 4.

## Installation (CLAUDE.md §6.6: the user installs)

1. Claude writes the file above to `<scratchpad>/askpass/settings.local.json`, validates the JSON, and reports its SHA-256 and a diff against the installed file.
2. The user reviews it and copies it to `.claude/settings.local.json`; the existing write guards forbid Claude from doing so.
3. The user starts a fresh Claude Code session.

## Verification (in the fresh session)

| ID | Check | Expected | Level |
|---|---|---|---|
| V1 | `git config --show-origin --get core.askPass` | `command line: false` | F |
| V2 | `git ls-remote https://github.com/LODESA-INTERPRISE-CANARIAS/OxEye.git` (read-only; allowed by guard-bash) | If the repository is private: an authentication failure with **no dialog**. If public: the refs list (inconclusive for this check, recorded as such) | F |
| V3 | `git remote -v` | Push URL still `https://push-disabled.invalid/blocked.git` | F |

Claude adds the results to the validation report.

## Exclusions

- No change to hooks, `settings.json`, agents, skills or CLAUDE.md.
- No Git write or remote operations by Claude.

## Risks and rollback

- Risk: a legitimate read operation that needs credentials, such as `git fetch` of a private repository, fails inside Claude. This is acceptable: the user fetches personally.
- Rollback: the user restores the previous `settings.local.json`. The Batch 2 version's SHA-256 is `f0a5566709fddc5a274bd944769f0d9ab6dacade08732178c3ad6eb3206d14d0`.

## Acceptance criteria

- The staged file parses, its diff contains only the listed additions, and its hash is reported.
- After the user installs it, V1 and V3 pass. V2 passes, or is recorded as inconclusive if the repository is public.

## Allowed paths

- `doc/specs/2026-11-25-claude-code-security-validation-report.md`
