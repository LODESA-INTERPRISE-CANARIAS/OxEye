# Plan: Claude Code security and configuration setup (Batch 2)

- Slug: `claude-code-security-setup`
- Date: 2026-11-25
- Branch: `chore/claude-code-setup` (existing local branch, based on `63073a1`)
- Status: awaiting `APPROVE IMPLEMENTATION claude-code-security-setup`
- Claude Code: 2.1.332, native Windows 11, Git Bash, Node 26.13.1

## 1. Objective

Install a small, testable set of controls that:

1. Remove usable GitHub and Git credentials from Claude Code's execution environment (primary control).
2. Block remote publication, credential access and destructive Git operations through permission rules and PreToolUse hooks (secondary controls).
3. Restrict repository writes to approved plans, approved branches and the plan's allowed paths.
4. Disable unnecessary external publishing integrations.
5. Provide the two skills already referenced by the Batch 1 agents (`oxeye-invariants`, `oxeye-verification`) and the hook referenced by six of them (`agent-bash-allowlist.mjs`).

No product behaviour changes. Batch 3 (functional validation inside real Claude Code sessions) is a separate plan.

## 2. Decisions applied

| ID | Decision | Applied as |
|---|---|---|
| D1 | C | `GH_CONFIG_DIR` points to an empty directory in Claude's environment. `gh` stays usable for the user outside Claude. |
| D2 | C | External: the user runs Claude in a credential-free environment (WSL2, separate Windows account or devcontainer). In-repo mitigation: Git credential neutralisation through `env` in local settings, plus an optional `pre-push` hook. |
| D3 | Both | The user configures a GitHub ruleset on `main` and required reviewers on the `github-pages` environment. |
| D4 | B + deny | The user moves Claude in Chrome to a separate Chrome profile with no GitHub login. The project denies `mcp__claude-in-chrome__*`. |
| D5 | Review | The user reviews and removes the Claude GitHub App installation if it is unnecessary. |
| D6 | Deny | `disableClaudeAiConnectors: true`, plus deny rules for Artifact, remote-execution and publishing tools and skills. |
| D7 | Deny | `mcp__ide__executeCode` is denied. |
| D8 | C | `defaultMode: "default"` (Manual). Bypass is disabled. Auto is disabled until Batch 3 passes and the user re-enables it. |
| D9 | A | The `PowerShell` tool is denied, and the Bash guard also rejects it as a second layer. |
| D10 | C | Shared, non-secret controls go in `.claude/settings.json`. Machine-specific credential isolation goes in `.claude/settings.local.json` (uncommitted). |
| D11 | Allow `chore/` | The write guard accepts `feat/`, `fix/` and `chore/` branches. CLAUDE.md §8.2 is not modified here; aligning it needs a separate plan. |
| D12 | **B (forced by CLAUDE.md)** | See §3. |

## 3. Conflict with CLAUDE.md: installation method

CLAUDE.md §6.6 (bootstrap) states that until the authorization and security mechanisms are installed and validated, Claude must not create or modify agent, skill, hook or settings files, and that "the user will manually install the approved configuration files". CLAUDE.md takes precedence over the handoff, so option D12-A cannot be used.

Therefore, execution of this plan means:

1. Claude writes every file into a staging directory outside the repository: `<scratchpad>/batch2/`, which mirrors the repository layout.
2. Claude runs the hook unit tests and the JSON validation in the staging directory and records SHA-256 hashes.
3. Claude writes `install-batch2.sh` into the staging directory. The script copies the files, verifies the hashes and prints a summary.
4. The user reviews the files and runs the installer personally from a terminal that Claude did not open.

Consequences:

- No bootstrap exception exists in any hook. Once the settings are active, `.claude/**`, `.git/**`, `CLAUDE.md`, `.github/**` and `.mcp.json` cannot be written by Claude's Edit or Write tools under any approval. Future changes to them follow this same staging and manual-installation path.
- Note for the record: the Batch 1 agent files were written by Claude. That appears inconsistent with §6.6 as currently worded. No action is proposed here. The user may decide whether to amend §6.6 in a separate plan.

## 4. Threat model

The adversary is not a malicious user. It is Claude Code or one of its subagents taking an unintended action, whether through error, misread instructions or prompt injection from repository or web content. The asset is the remote repository, because a push to `main` deploys to GitHub Pages, together with the credentials that can write to it.

Publication channels in scope:

| Channel | Example |
|---|---|
| Git over HTTPS or SSH | `git push`, `git -C . push`, aliases, `send-pack` |
| GitHub CLI or API | `gh pr create`, `gh api -X PUT`, `curl` with a token |
| Browser | Claude in Chrome with an authenticated GitHub session |
| Connectors | Claude Docs, Artifact publishing |
| Remote execution | `RemoteTrigger`, `schedule` skill, `Agent` with `isolation: "remote"`, cloud sessions |
| Indirect execution | `node`, `python` or `npm run` scripts, vitest and playwright running repository code, `mcp__ide__executeCode` |
| Tampering | Editing hooks, settings, approval state, the Git config or the pre-push hook |

Principle: only credential removal (D1, D2) and the GitHub-side rules (D3) hold when every Claude-side control fails. Everything implemented in this repository is defence in depth. It is not a security boundary.

## 5. Components

### 5.1 File inventory (installation targets)

| Target path | Purpose | Committed? |
|---|---|---|
| `.claude/hooks/lib/common.mjs` | stdin JSON reading, fail-closed runner, repository root, branch reading, path normalisation, plan parsing, approval-state I/O | yes |
| `.claude/hooks/lib/shell.mjs` | Conservative shell tokenizer and segmenter (no execution, no expansion) | yes |
| `.claude/hooks/guard-bash.mjs` | PreToolUse `Bash|PowerShell` deny guard for all sessions and subagents | yes |
| `.claude/hooks/agent-bash-allowlist.mjs` | PreToolUse `Bash` allowlist for the roles `implementer`, `qa` and `reviewer` (referenced by the Batch 1 agents) | yes |
| `.claude/hooks/guard-write.mjs` | PreToolUse `Edit|Write|MultiEdit|NotebookEdit` path guard | yes |
| `.claude/hooks/guard-agent.mjs` | PreToolUse `Agent` guard that rejects `isolation: "remote"` | yes |
| `.claude/hooks/approval-token.mjs` | UserPromptSubmit approval registration and revocation | yes |
| `.claude/hooks/test/*.test.mjs` | `node --test` suites with inline fixtures | yes |
| `.claude/skills/oxeye-invariants/SKILL.md` | Invariant trigger table, anchors, checks | yes |
| `.claude/skills/oxeye-verification/SKILL.md` | Baseline, verification order, failure classification | yes |
| `.claude/settings.json` | Shared permissions, hooks, connector disable | yes |
| `.claude/settings.local.json` | Credential-isolation `env` | **no** |
| `.git/hooks/pre-push` | Optional friction layer | not tracked |
| `.gitignore` | Append `.claude/settings.local.json` | yes |
| `C:\Users\FGL14\.oxeye-claude\gh-empty\` | Empty directory for `GH_CONFIG_DIR` | outside the repository |

No new npm dependencies. The hooks use only Node built-ins (`node:fs`, `node:path`, `node:crypto`, `node:os`, `node:test`, `node:assert`).

### 5.2 Shared hook behaviour (`lib/common.mjs`)

- `runHook(handler)` reads stdin fully with a 5 s cap and parses the JSON. Any exception, malformed JSON, missing `tool_name`, wrong type or unexpected tool shape ends the hook with **exit 2** and a one-line stderr message beginning `[oxeye-guard]`. Success means exit 0 with no stdout.
- Repository root comes from `CLAUDE_PROJECT_DIR`, falling back to `cwd` from the input. The hook verifies that `<root>/.git` is a directory and denies otherwise.
- The current branch is read from `<root>/.git/HEAD` without spawning `git`. Detached HEAD, a missing file or an unparseable file all yield `null`, which is treated as "not an implementation branch".
- `normalizePath(p, cwd)`:
  - Resolve to an absolute path.
  - Reject the path if it contains NUL, starts with `\\?\` or `\\.\`, is a UNC path, has a `:` after the drive letter (alternate data streams), or has a path component ending in `.` or a space.
  - Resolve symlinks and junctions with `realpath` on the deepest existing ancestor.
  - Compare case-insensitively on `win32` after converting `\` to `/`.
- Plan parsing follows a strict, explicit format, described in §5.8.
- Approval state lives at `<root>/.git/claude-oxeye/approvals.json`. Reads are tolerant: a missing file means no approvals. A malformed file means no approvals, and the error is reported once in stderr. Writes are atomic (write to a temporary file, then rename).

### 5.3 `guard-bash.mjs` (all sessions, including subagents)

Input: `tool_input.command` (string). For `tool_name === "PowerShell"` the hook always exits 2, as a second layer behind the bare `PowerShell` deny.

Step 1 runs the tokenizer (`lib/shell.mjs`). It splits on `&&`, `||`, `;`, `|`, `|&`, `&` and newlines outside quotes, and handles single quotes, double quotes and backslash escapes. The hook **fails closed** (exit 2, "command could not be safely interpreted") on any of:

- Unbalanced quotes.
- Backticks, `$(`, `${`, `<(` or `>(`.
- A heredoc (`<<`).
- `$` followed by a name, except inside single quotes.
- A line continuation.

Step 2 inspects each simple command after stripping leading `VAR=value` assignments. Assignments to `GIT_*`, `GH_*`, `GITHUB_*`, `PATH`, `HOME`, `NODE_OPTIONS` or `CLAUDE*` are denied. The command name is compared by basename, without `.exe` and case-insensitively, so `/usr/bin/git` and `C:\...\git.exe` match `git`.

| Category | Denied |
|---|---|
| Nested interpreters and indirection | `bash`, `sh`, `zsh`, `dash`, `cmd`, `powershell`, `pwsh`, `wsl`, `eval`, `exec`, `source`, `.`, `xargs`, `env` (any use), `command`, `builtin`, `nohup`, `timeout`, `start`, `script`; `node` except `node --test <path under .claude/hooks/test>`; `python`, `python3`, `py`, `perl`, `ruby`, `deno`, `bun` |
| Package indirection | `npm` except `npm run {lint,test,build,test:e2e}`, `npm ci` and `npm ls`; `npx` except `eslint` (no `--fix`), `tsc`, `vitest run`, `playwright test`, `prettier --check`; `npm exec`, `pnpm`, `yarn` |
| Publication and network | `gh`, `hub`, `curl`, `wget`, `ssh`, `scp`, `sftp`, `rsync`, `nc`, `ncat`, `telnet`, `ftp`, `Invoke-*`; `npm publish`, `npm login`, `npm adduser`, `npm token`, `npm owner`, `npm unpublish`, `npm deprecate`, `npm dist-tag` |
| Credentials | `printenv`, `set` with no arguments, `export -p`, `declare`, `cmdkey`, `git-credential-manager*`; any argument matching `/GH_TOKEN\|GITHUB_TOKEN\|GH_ENTERPRISE_TOKEN\|GIT_ASKPASS\|\.git-credentials\|hosts\.yml\|GitHub CLI/i` |
| Git | see the table below |
| Protected paths | A redirection target (`>`, `>>`, `>|`, `&>`), or any argument of `rm`, `mv`, `cp`, `tee`, `touch`, `mkdir`, `ln`, `chmod`, `truncate`, `dd`, `install` or `sed -i`, that resolves to a protected path (§5.5). Any argument containing `claude-oxeye`, `.git/hooks`, `.git\hooks` or `.git/config`. |

Git rules. Global options are parsed first. `-C <dir>` is allowed and does not hide the subcommand. `-c`, `--config-env`, `--exec-path`, `--git-dir`, `--work-tree`, `--namespace`, `--super-prefix` and `--literal-pathspecs` are denied. The subcommand is then checked against an **allowlist**. Unknown subcommands, which include configured aliases, are denied.

| Subcommand | Allowed form |
|---|---|
| `status`, `diff`, `log`, `show`, `blame`, `grep`, `rev-parse`, `ls-files`, `ls-tree`, `cat-file`, `merge-base`, `describe`, `shortlog`, `fetch`, `diff-tree`, `name-rev`, `for-each-ref`, `check-ignore` | Any form, except `--output`, `--ext-diff` and `-o` |
| `branch` | Listing and `--show-current`; creating `feat|fix|chore/<slug>`. Not `-d`, `-D`, `-m`, `-M`, `-f`, `-c`, `-C`, `-u` or `--set-upstream-to`. |
| `switch` | `-c feat|fix|chore/<slug>` only |
| `checkout` | `-b feat|fix|chore/<slug>` only |
| `add` | Paths only; not `-A`, `--all` or `.`, so that unrelated files are not staged by accident |
| `commit` | Only when the current branch is not `main` and matches the prefix rule. Not `--amend`, `--no-verify`, `-n`, `--fixup`, `--squash` or `-a`. |
| `stash` | `list`, `show` |
| `tag` | listing only |
| `worktree` | `list` |
| `remote` | `-v`, `show`, `get-url` |
| `config` | `--get`, `--get-all`, `--get-regexp`, `--list`, `-l`, `--show-origin` combined with a read form |

Everything else is denied with an explicit message. That includes `push`, `send-pack`, `http-push`, `receive-pack`, `credential*`, `remote add/set-url/remove/rename`, `config` writes, `reset`, `clean`, `restore`, `rebase`, `merge`, `cherry-pick`, `revert`, `filter-branch`, `update-ref`, `replace`, `reflog`, `gc`, `prune`, `submodule`, `lfs`, `bundle`, `archive`, `fast-import`, `daemon`, `hook`, `notes` and `am`. Merges and history operations require separate authorisation from the user, who runs them personally.

Explicit non-goals: this guard does not detect a script file that `vitest`, `playwright`, `eslint` or `tsc` loads from the repository, a modified `package.json` script, or a binary invoked under an unusual name through a path the tokenizer cannot resolve. Those cases are covered only by credential isolation (§5.9) and the GitHub-side rules.

### 5.4 `agent-bash-allowlist.mjs <role>`

This hook is registered by the Batch 1 frontmatter as `node "$CLAUDE_PROJECT_DIR/.claude/hooks/agent-bash-allowlist.mjs" <role>` with `onFailure: block`. `guard-bash.mjs` also runs for subagents, because project settings hooks run inside subagents.

- An unknown role, or a missing role argument, results in exit 2.
- The command must be one simple command. It may not contain separators, pipes, redirections, assignments or anything that makes the tokenizer fail closed.
- Allowlist by role:
  - **all roles:** `git status`, `git diff`, `git log`, `git show`, `git branch --show-current`, `git rev-parse`, `git ls-files`, `git merge-base`, `git blame`, each without `--output`, `--ext-diff`, `-c` or `--exec*`.
  - **implementer, reviewer:** add `npx eslint <paths>`, with no `--fix`, `--fix-dry-run`, `-c`, `--config`, `--rulesdir`, `--resolve-plugins-relative-to` or `--plugin`. Add `npx tsc --noEmit -p tsconfig.json` and `npx vitest run [paths]`.
  - **qa:** the implementer set, plus `npm run test`, `npm run lint`, `npm run test:e2e` and `npx playwright test [paths | --project <name> | --grep <pattern> | --reporter <name>]`.

### 5.5 `guard-write.mjs`

Input path comes from `tool_input.file_path`, or from `tool_input.notebook_path` for NotebookEdit. If neither is a non-empty string, the hook exits 2.

The decision sequence stops at the first match:

1. **Outside the repository root.** Allow only paths under `os.tmpdir()/claude/` (the session scratchpad) or `~/.claude/projects/*/memory/`. Deny everything else. This blocks `~/.gitconfig`, `~/.claude/settings*.json`, `%APPDATA%\GitHub CLI\` and similar targets.
2. **Protected paths.** Always deny: `.claude/**`, `.git/**`, `CLAUDE.md`, `.github/**`, `.mcp.json`, `.gitignore`, `.gitattributes`, `.vscode/**` and `.husky/**`. There is no approval override.
3. **Plan files.** A path matching `doc/specs/YYYY-MM-DD-<slug>.md` is allowed on any branch, including `main`, unless `<slug>` has an active approval. An approved plan is frozen; the user must revoke the approval before the plan can be revised.
4. **Branch.** If the branch is `null`, `main` or `master`, or does not match `^(feat|fix|chore)/[a-z0-9]+(-[a-z0-9]+)*$`, deny.
5. **Approval.** Collect the approvals whose recorded `branch` equals the current branch. For each one, recompute the SHA-256 of `planPath`. On a mismatch or a missing file, ignore that approval and say why in stderr. If no valid approval remains, deny.
6. **Allowed paths.** Allow the write if the repository-relative path matches an entry under `## Allowed paths` of a valid approved plan. Otherwise deny and list the plan(s) that were checked.

Agent-specific ownership is **not** enforced. The documented `agent_type` field would make it feasible, but it would require an extra ownership table in every plan. It is deferred until there is a concrete need.

### 5.6 `guard-agent.mjs`

- Deny when `tool_input.isolation === "remote"`.
- Deny malformed input.
- Allow everything else. Subagents inherit the project hooks.

### 5.7 `approval-token.mjs` (UserPromptSubmit)

- Read `prompt` and apply `trim()`. It must match exactly `^APPROVE IMPLEMENTATION ([a-z0-9]+(?:-[a-z0-9]+)*)$` or `^REVOKE IMPLEMENTATION (<same>)$`. Any other prompt results in exit 0 with no output and no state change. Quoted, embedded, multi-line or partial tokens therefore never match.
- **APPROVE**:
  1. Exactly one file `doc/specs/????-??-??-<slug>.md` must exist.
  2. It must parse under §5.8.
  3. Its `Slug` must equal `<slug>`.
  4. Its `Branch` must satisfy the prefix rule.
  5. `## Allowed paths` must be non-empty and contain no protected path or path outside the repository.

  If all checks pass, the hook records `{planPath, planSha256, branch, approvedAt}` and appends `{action, slug, at}` to `log`. It always prints one context line to stdout: either `Approval recorded for <slug> (plan sha256 <prefix>)` or `Approval NOT recorded: <reason>`.
- **REVOKE** removes the entry, logs the action and prints a confirmation. Revoking a slug that is not approved is a no-op, and the hook says so.
- The hook never blocks the prompt (exit 0 even on internal error). A failure only means that no approval was recorded, which is the safe outcome. Its own errors go to stderr.
- A recorded approval never grants writes to protected paths and never affects `guard-bash` publication rules.

### 5.8 Plan format (enforced by the parser)

```markdown
- Slug: `<slug>`
- Branch: `<prefix>/<branch-slug>`
...
## Allowed paths

- `exact/path.ext`
- `some/dir/**`
```

- `Slug` and `Branch` are read from the first lines matching `^- Slug: \`(.+)\`$` and `^- Branch: \`(.+?)\``. Trailing text after the closing backtick is ignored.
- `## Allowed paths` runs until the next line starting with `## ` or the end of the file. Only lines matching ``^- `([^`]+)`$`` count. Any other non-blank line in that section makes the plan invalid (fail closed).
- An entry is either an exact repository-relative POSIX path or a directory prefix ending in `/**`. No other glob syntax is accepted.

Existing plans already follow this shape.

### 5.9 Credential isolation (`.claude/settings.local.json`)

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "env": {
    "GH_CONFIG_DIR": "C:\\Users\\FGL14\\.oxeye-claude\\gh-empty",
    "GH_TOKEN": "",
    "GITHUB_TOKEN": "",
    "GIT_TERMINAL_PROMPT": "0",
    "GCM_INTERACTIVE": "never",
    "GIT_CONFIG_COUNT": "3",
    "GIT_CONFIG_KEY_0": "credential.helper",
    "GIT_CONFIG_VALUE_0": "",
    "GIT_CONFIG_KEY_1": "remote.origin.pushurl",
    "GIT_CONFIG_VALUE_1": "https://push-disabled.invalid/blocked.git",
    "GIT_CONFIG_KEY_2": "core.sshCommand",
    "GIT_CONFIG_VALUE_2": "false"
  }
}
```

- An empty `credential.helper` resets the helper list, so Git Credential Manager is not consulted. The value `GIT_TERMINAL_PROMPT=0` stops Git from prompting for credentials in the terminal, and `GCM_INTERACTIVE=never` stops GCM from opening an interactive login.
- `pushurl` stops a plain `git push` to `origin`. An explicit URL bypasses it; in that case the empty helper is what prevents authentication.
- Limitation (X): a process can unset or override these variables, for example by spawning a fresh shell or using `git -c`, which the guard blocks. Credentials still exist in Windows Credential Manager and in `%APPDATA%\GitHub CLI\`. Only D2's credential-free environment (WSL2, separate account or devcontainer) removes them from reach.

### 5.10 `.claude/settings.json`

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "disableClaudeAiConnectors": true,
  "permissions": {
    "defaultMode": "default",
    "disableBypassPermissionsMode": "disable",
    "disableAutoMode": "disable",
    "allow": [
      "Bash(git status)", "Bash(git status *)",
      "Bash(git diff *)", "Bash(git log *)",
      "Bash(git branch --show-current)",
      "Bash(npx tsc --noEmit -p tsconfig.json)",
      "Bash(npx vitest run *)", "Bash(npm run test)", "Bash(npm run lint)",
      "Bash(node --test .claude/hooks/test)"
    ],
    "deny": [
      "PowerShell", "Monitor", "RemoteTrigger", "CronCreate",
      "Artifact", "ArtifactComments", "ArtifactData",
      "SendToProject", "SendToProjectContext",
      "Skill(schedule)", "Skill(ship-local)", "Skill(ship)", "Skill(steward)",
      "Skill(anthropic-skills:chrome-browser)", "Skill(anthropic-skills:computer-use)",
      "mcp__claude_ai_Claude_Docs__*", "mcp__claude-in-chrome__*",
      "mcp__ide__executeCode", "mcp__computer-use__*",
      "Bash(git push)", "Bash(git push *)", "Bash(git send-pack *)", "Bash(git http-push *)",
      "Bash(git credential *)", "Bash(gh)", "Bash(gh *)",
      "Bash(npm publish *)", "Bash(curl *)", "Bash(wget *)",
      "Edit(/.claude/**)", "Edit(/.git/**)", "Edit(/CLAUDE.md)",
      "Edit(/.github/**)", "Edit(/.mcp.json)",
      "Edit(~/.gitconfig)", "Edit(~/.claude/settings*.json)",
      "Read(~/.git-credentials)", "Read(//c/Users/*/AppData/Roaming/GitHub CLI/**)"
    ]
  },
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [ { "type": "command", "command": "node",
        "args": ["${CLAUDE_PROJECT_DIR}/.claude/hooks/approval-token.mjs"], "timeout": 10 } ] }
    ],
    "PreToolUse": [
      { "matcher": "Bash|PowerShell", "hooks": [ { "type": "command", "command": "node",
        "args": ["${CLAUDE_PROJECT_DIR}/.claude/hooks/guard-bash.mjs"], "timeout": 10, "onFailure": "block" } ] },
      { "matcher": "Edit|Write|MultiEdit|NotebookEdit", "hooks": [ { "type": "command", "command": "node",
        "args": ["${CLAUDE_PROJECT_DIR}/.claude/hooks/guard-write.mjs"], "timeout": 10, "onFailure": "block" } ] },
      { "matcher": "Agent", "hooks": [ { "type": "command", "command": "node",
        "args": ["${CLAUDE_PROJECT_DIR}/.claude/hooks/guard-agent.mjs"], "timeout": 10, "onFailure": "block" } ] }
    ]
  }
}
```

Rationale and verification status:

- Bash deny rules duplicate the hook for the obvious forms. The documentation states that `Bash(git push *)` does not catch `git -C . push`, which is why the hook exists.
- Edit rules also cover Write, as documented. Paths with a leading `/` are relative to the project root.
- Allow rules contain read-only or test commands only. Test commands run repository code, which is accepted as residual risk (see the threat matrix). Every other command prompts in Manual mode, and the user is the final gate.
- `WebFetch` and `WebSearch` are not denied. They are read-only, and in Manual mode they prompt for permission.
- These items are documented but have not yet been exercised in this environment (S only until Batch 3):
  - The `disableClaudeAiConnectors` key.
  - The `disableAutoMode` nesting, which the documentation leaves ambiguous. If Batch 3 shows the key is ignored there, it moves to the top level.
  - The exec form (`command` + `args`) with `${CLAUDE_PROJECT_DIR}`.
  - `onFailure: "block"`, which requires v2.1.295 or later; this installation is 2.1.332.
  - The bare-name denies for `SendToProject*` and `ArtifactComments`, whose tool names are not documented.

### 5.11 Optional `.git/hooks/pre-push`

```sh
#!/bin/sh
if [ "${CLAUDECODE:-}" = "1" ]; then
  echo "[oxeye] push rejected: invoked from a Claude Code session." >&2
  exit 1
fi
exit 0
```

This hook is friction only. `--no-verify`, removing the variable or editing the hook all bypass it. It is not tracked by Git.

### 5.12 Skills

**`oxeye-invariants/SKILL.md`**

Frontmatter: `name: oxeye-invariants` and a description stating when to use it (planning or reviewing changes that touch emergency, demand, persistence, X-ray or simulation code). Body, in English, about 120 lines:

1. A trigger table that maps changed paths or topics to invariants:

   | Path or topic | Invariant | Anchors |
   |---|---|---|
   | `src/engine/emergency/{stretcher-nav,vehicle-dispatch,response-model}.ts`, route network | Routes A/B/C | `routeA`, `routeB`, `routeC` |
   | `yellow_tent`, "Carpa Amarilla" | Carpa Amarilla | `catalog.ts`, `inventory-meta.ts`, `contextual-incidents.ts`, `incident-center.ts`, `fire-model.ts` |
   | `violet_point`, `sensitive`, `privacyMode`, exports | Punto Violeta privacy | `incident-center.ts`, `incident-dashboard.ts`, `contextual-incidents.ts`, `emergency-lab.ts`; `App.tsx` `privacyMode`; `IncidentAnalysisPanel.tsx` |
   | `ballast.ts`, `src/engine/subsoil/**`, X-ray UI | 500 kg/m² indicative threshold | `HEAVY_LOAD_THRESHOLD_KG_M2` (`ballast.ts:21`) |
   | `event-demand.ts`, `demand.ts`, `attendance-model.ts`, `types/index.ts` `EventDemandConfig` | Single source of truth and attendance conservation | `EventDemandConfig` (`types/index.ts:690`) |
   | `src/db/**` | Persistence format | `'ojo-de-buey'` (`repository.ts`, `schema.ts`) |
   | Any `src/engine/**` | Determinism | `rng()` (`grid-flow.ts:13`); no `Math.random` / `Date.now` in simulation paths |
   | UI copy, reports | No certification claims | wording checks |

2. For each invariant: what must hold, static inspection steps (exact `Grep` patterns), the covering tests (`stretcher-evacuation`, `emergency-dispatch`, `emergency-access-fix`, `vehicle-mobility`, `route-network`, `incident-center`, `contextual-fire-propagation`, `ballast-groups`, `subsoil`, `demand-sync`, `seed-reproducibility`, `engine`), and the commands to run (`npx vitest run tests/unit/<file>`).
3. A report template: invariant, evidence, status (holds / at risk / violated / not affected).

It defers to CLAUDE.md §5 and does not restate it.

**`oxeye-verification/SKILL.md`**

Frontmatter: `name: oxeye-verification` and a description (running checks, comparing them with the baseline, classifying failures). Body, about 100 lines:

1. Recorded baseline at `63073a1`: ESLint 0 errors and 126 warnings; Vitest 23 files and 117 tests passing; `npx tsc --noEmit -p tsconfig.json` exits 0; e2e not run (the audit reported 12 failures tied to the outdated first-run flow, unverified).
2. Generated artefacts: `tsc -b` and `npm run build` write `*.tsbuildinfo` (ignored) and `dist/` (ignored). Playwright writes `playwright-report/` and `test-results/`, which are **not** ignored and must be reported and never committed.
3. Safe order:
   1. `git status --short`
   2. `npx tsc --noEmit -p tsconfig.json`
   3. `npx eslint <changed>`
   4. `npx vitest run <targeted>`
   5. `npx vitest run`
   6. `npm run lint`
   7. `npm run build`, only when the plan requires it
   8. e2e, only when the plan requires it
4. Failure classification. A failure is **introduced** if it fails on the branch and passes on the baseline, which is checked by the AI Lead in a separate worktree or by stash only with authorisation; otherwise the baseline counts from this skill are used. It is **pre-existing** if it shows the same failure in the baseline. It is **flaky** if it differs across two reruns. Each claim needs evidence.
5. Seeded reproducibility: run `seed-reproducibility.test.ts` and confirm that new randomness uses `rng(seed)`.
6. Windows notes: Git Bash paths, CRLF warnings, Playwright browser install, and the absence of a sandbox.
7. QA rules: never weaken assertions; report command, result and comparison in a table.

## 6. Threat matrix

| # | Vector | Control(s) | Level | Residual |
|---|---|---|---|---|
| T1 | `git push` (plain, `-C`, absolute path) | deny rule; guard-bash allowlist; env pushurl and empty helper; pre-push; GitHub ruleset | S now, F in Batch 3, X ruleset | Bypassed only if every Claude-side layer fails **and** credentials are reachable |
| T2 | Git aliases and `-c` overrides | guard-bash denies `-c` and unknown subcommands | S/F | — |
| T3 | Nested interpreters, script files, `node -e` | guard-bash denies interpreters | S/F | A script run by vitest or playwright from the repository |
| T4 | `npm run` indirection | Script-name allowlist | S/F | A modified `package.json` script; `package.json` is writable only under an approved plan |
| T5 | GitHub CLI or API | deny `gh` and `curl`; `GH_CONFIG_DIR` empty; GitHub App review | S/F/X | `gh` keyring lookup, to be verified in Batch 3 |
| T6 | Browser | Chrome deny rule; separate profile | S/X | Depends on the user's profile hygiene |
| T7 | Connectors and Artifact | `disableClaudeAiConnectors`; tool denies | S/F | Undocumented tool names |
| T8 | Remote and cloud execution | `RemoteTrigger`, `CronCreate` and `schedule` denied; guard-agent | S/F | Cloud sessions started by the user outside this project |
| T9 | IDE code execution | `mcp__ide__executeCode` denied | S/F | — |
| T10 | PowerShell | Bare deny; guard-bash second layer | S/F | — |
| T11 | Tampering with hooks, settings, approvals, `.git` | Edit deny rules; guard-write protected list; guard-bash path checks | S/F | Bash write vectors the tokenizer cannot resolve, partly covered by fail-closed parsing |
| T12 | Forged approval | Exact-match UserPromptSubmit; state in `.git/` (protected); plan hash binding | S/F | A forged prompt from another local process is out of scope |
| T13 | Hook missing or crashing | `onFailure: block`; `runHook` exit 2 | S/F | Hooks are skipped if the user disables them or never accepts workspace trust |
| T14 | Deployment by another path | Required reviewers on `github-pages` | X | Depends on the GitHub plan and repository visibility |
| T15 | Credentials on disk | D2 credential-free environment | X | Until the user completes D2, the GCM and gh stores remain on this account |

## 7. Execution steps (after approval)

1. Create `<scratchpad>/batch2/` mirroring the target paths of §5.1, excluding the external directory.
2. Write the hook library, the hooks and the tests. Run `node --test <scratchpad>/batch2/.claude/hooks/test`. All suites must pass.
3. Write the two skills and validate their YAML frontmatter.
4. Write `settings.json` and `settings.local.json`. Validate them with `JSON.parse`, then validate them against the schema with `npx --yes ajv-cli`. If that would require a network install, fall back to `JSON.parse` plus a key check and report it.
5. Write `pre-push` and `install-batch2.sh`. The installer:
   1. Refuses to run if `CLAUDECODE=1`.
   2. Refuses unless the branch is `chore/claude-code-setup`.
   3. Creates the `gh-empty` directory.
   4. Copies files in this order: lib, hooks, tests, skills, `.gitignore` append, `settings.local.json`, `pre-push`, and finally `settings.json`.
   5. Verifies the SHA-256 of each copied file.
   6. Prints a summary.
6. Record the SHA-256 of every staged file in a hash table and give it to the user.
7. Stop. The user reviews the files and installs them, then starts a new Claude Code session. Hooks and settings are captured at session start, so the current session is not protected by them.

## 8. Unit test cases (Batch 2, run on the staged scripts by piping fixture JSON to the real script process)

- **guard-bash:**
  - Deny: `git push`, `git -C . push origin main`, `/usr/bin/git push`, `git.exe push`, `GIT_DIR=x git status`, `git -c alias.p=push p`, `git p`, `git remote set-url origin x`, `git config user.name x`, `git credential fill`, `git reset --hard`, `git commit -m x` with HEAD on `main`, `git commit --amend`, `bash -c "git push"`, `sh script.sh`, `node -e "..."`, `node x.mjs`, `npx -c "git push"`, `npm run deploy`, `gh pr create`, `curl -X POST ...`, `echo $GH_TOKEN`, `printenv`, `echo x > .claude/settings.json`, `cp a .git/hooks/pre-push`, `` echo `git push` ``, `echo $(git push)`, heredoc, unbalanced quotes, empty input, malformed JSON, missing `command`, `tool_name: PowerShell`.
  - Allow: `git status`, `git diff --stat`, `git log --oneline -3`, `git -C . status`, `git commit -m "FEAT: x"` on `feat/x`, `npx vitest run tests/unit/demand-sync.test.ts`, `npm run lint`, `node --test .claude/hooks/test`.
- **agent-bash-allowlist:**
  - Per role: one allowed and one denied example per rule.
  - Unknown role, compound command and `npx eslint --fix` are denied.
- **guard-write:**
  - Protected paths in each spelling: `CLAUDE.md`, `claude.md`, `.\CLAUDE.md`, `CLAUDE.md.`, `CLAUDE.md::$DATA`, `.claude\settings.json`, `.git/claude-oxeye/approvals.json`, and a junction or symlink pointing into `.claude`.
  - `../outside`; `~/.gitconfig`.
  - Scratchpad allowed; plan file on `main` allowed; approved plan file denied.
  - `src/x.ts` on `main` denied.
  - On `feat/x`: without approval denied; with approval and listed path allowed; unlisted path denied; tampered plan hash denied.
  - Detached HEAD denied; missing `file_path` denied.
- **guard-agent:** `isolation: "remote"` denied; normal input allowed; malformed input denied.
- **approval-token:**
  - Exact token recorded; token with surrounding whitespace recorded.
  - No state change for: a quoted token, a token inside a longer message, a token on two lines, lowercase, an invalid slug, a missing plan, two matching plans, a plan with an empty or invalid Allowed paths section, a plan that lists a protected path, or a plan whose Branch is `main`.
  - Revoke works; revoking a missing approval is a no-op.
  - A malformed state file is handled safely.

## 9. Batch 3 preview (separate plan)

Batch 3 runs in real Claude Code sessions (Manual mode, then a headless `claude -p` with fixed prompts) against a throwaway local bare remote in the scratchpad, never against the real origin. Each case in §8 is exercised through the actual tools, together with MCP, IDE and connector denial, the approval flow end to end, `onFailure` behaviour with a deliberately broken hook, the `disableAutoMode` effect, `gh auth status` under `GH_CONFIG_DIR`, and a push attempt to an HTTPS URL that requires authentication.

## 10. External actions for the user (X)

1. D2: set up a credential-free environment for Claude (WSL2, a separate Windows account or a devcontainer). Until then, T15 remains open.
2. D3: GitHub → Settings → Rules → a ruleset on `main` (restrict deletions, block force pushes, require pull requests) and Environments → `github-pages` → required reviewers.
3. D4: run Claude in Chrome only in a separate Chrome profile without a GitHub session, and restrict its site access.
4. D5: GitHub → organisation or user Settings → Applications / Installed GitHub Apps → review "Claude" and remove repository access if it is unnecessary.
5. Review the staged files, run `install-batch2.sh` from a terminal that Claude did not open, accept workspace trust, and restart Claude Code.

## 11. Rollback

The user deletes the installed files from §5.1, removes the `.gitignore` line, deletes `.git/hooks/pre-push`, `.git/claude-oxeye/` and `C:\Users\FGL14\.oxeye-claude\`, and restarts Claude Code. No source files, history or remote state are touched.

## 12. Known limitations

- None of these controls is a sandbox. On native Windows, Claude Code runs commands unsandboxed.
- Hooks run only after workspace trust is accepted, and `disableAllHooks` in any user-controlled settings file disables them.
- The Bash tokenizer is deliberately conservative. Legitimate commands that use `$VAR`, heredocs or command substitution are rejected and must be rewritten or run by the user.
- Test runners execute repository code with full user privileges.
- `UserPromptSubmit` behaviour in the VS Code extension is not documented and will be verified in Batch 3.

## 13. Domain invariants

None affected: no files under `src/` or `tests/` are modified. The `oxeye-invariants` skill only documents existing anchors.

## 14. Agent assignments

None. The AI Lead writes and tests everything in the staging directory. No subagent writes anything.

## 15. Acceptance criteria

- Every file in §5.1 exists in `<scratchpad>/batch2/`, along with `install-batch2.sh` and a hash table.
- `node --test` passes every case in §8 on the staged scripts, and the actual counts are reported.
- Both settings files parse, and the result of the schema validation is reported.
- Nothing inside the repository working tree changes during execution, which is checked with `git status --short` before and after.

## Allowed paths

- `C:/Users/FGL14/AppData/Local/Temp/claude/22c9db942d44e83e/1a8c0c94-8fb0-42ce-9689-fcf65a2eb4d0/scratchpad/batch2/**`
