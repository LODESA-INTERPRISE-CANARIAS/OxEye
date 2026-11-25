# OX-03 · Organizations, users, permissions and projects (local mode)

- Date: 2026-11-25
- Slug: `ox-03-proyectos-permisos`
- Branch: `feat/ox-03-proyectos-permisos` (from `main` @ `dbc6714`)
- Classification: TASK
- Source: OX-03 card pasted by the user (2026-11-25). Background: ADR-024-001/002/005 and `doc/architecture/data-authority-map.md` (all `Propuesto`).

## 1. Objective

Let one project group several events at different venues, introduce the hierarchy **Organización → Proyecto → Evento → Jornada → Actividad**, a basic users/roles model with per-project and per-event permissions, a context header, and import of a current v1 project JSON as an event of a new project — **in local mode**, because there is no server (ADR-024-001 option B is not approved; OX-03 is listed as *Blocked* under option A).

## 2. Constraint that shapes the plan

The card requires server-side permission checks (INV-011, SEC-001) and organization isolation (INV-002). No server exists and introducing one is outside CLAUDE.md §2.2 without explicit approval. Therefore:

- Everything is built **local, single-browser**, with the domain split the ADRs prescribe (pure permission module + per-domain repository behind an interface), so a future server replaces the repository implementation, not the UI.
- The UI states permanently: **"Modo local de un solo usuario: los permisos son orientativos y no protegen los datos."** Permissions are never presented as security (card NFR, UX-009).
- Acceptance criteria 2 and 3 (server rejection, org isolation) **cannot be met** in this scope. They are delivered as their local equivalents (unit-tested permission matrix and org-scoped repository queries) and remain open until the server decision.

## 3. Current behaviour (verified)

- The whole model is one `ProjectFile` (`src/types/index.ts:1019`) in `localStorage['ojo-de-buey-project-v1']` (`src/db/repository.ts:27`), loaded synchronously at store init (`src/store/useProjectStore.ts:210`). Dexie v1 `projects` gets a write-only copy; `simulationRuns` unused.
- A `ProjectFile` has up to 3 venue scenes (`cristo`, `constitucion`, `vega`); event identity (title, dates, `workDays`, programme) lives per `Scene`. No project/event ids, no users.
- Startup: `GameMenu.tsx` (Continuar / Cargar `.json` via Header's hidden `#file` / Crear nuevo → wizard of 5 steps). `createFromWizard` clones the *current* project and overwrites only `cristo`.
- Import (`Header.tsx:42-59` → `parseImportedProject` → `replaceProject`) replaces the open model. Export downloads the raw `ProjectFile`.
- Undo stores full `JSON.stringify(project)` copies (max 35).
- `Header.tsx:92-96` `.project-heading` is static text — natural slot for the context header.
- "Empresas y recursos" (`OrganizationsDialog.tsx`) is supplier companies, not tenant organizations; no UI label clash.
- No `fake-indexeddb` dependency; no persistence-layer unit tests; no e2e covers import/export.

## 4. Decisions taken by the AI Lead

| # | Decision | Reason |
|---|---|---|
| D1 | **Evento payload = one complete v1 `ProjectFile`**, stored unchanged. An event's venues are the scenes with content. | Zero change to the 136 readers of the active project; import is lossless by construction (criterion 4); supports "one or more venues". |
| D2 | **Jornada and Actividad are derived views**, not new stored entities: Jornada = the event's `workDays` (`pre`/`event`/`post`, shown as *Fase operativa*); Actividad = programme sessions + `customActivities`. | Avoids a second source of truth (INV-003). Stored entities can come with OX-06 (Calendar). |
| D3 | Stored entities with UUID: `Organization`, `LocalUser`, `Membership`, `Project`, `EventRecord`, `AccessLogEntry`. New types in `src/types/workspace.ts` (not the hotspot `types/index.ts`). | Stable identity (INV-001), minimal hotspot impact. |
| D4 | The 7 proposed roles of the card, `Action` enum and a role × action matrix in a pure module `src/engine/workspace/permissions.ts`. Membership scope is `project` or `event`; event membership overrides project membership for that event. | Card req. 2–3; pure and testable; reusable by a future server. |
| D5 | Local users are **profiles** (name, professional contact optional, role). An **"Usuario activo"** selector lets the local operator act as a profile to demonstrate the matrix, always under the local-mode warning. No passwords, no authentication. | Card req. 4 demonstrable without pretending security; CUM-008 data minimization. Authentication method stays an open decision. |
| D6 | Invite / change role / revoke write an `AccessLogEntry {who, action, target, at}` (INV-012), shown in the members panel. | Card req. 4. |
| D7 | Persistence: Dexie `version(2)` adds `organizations, users, memberships, projects, events, eventPayloads, accessLog`. localStorage key stays as the **active-event cache** so synchronous boot and "Continuar" keep working. Repository behind an interface with a Dexie implementation and an in-memory implementation for unit tests. | No async boot rewrite; no new dependency. |
| D8 | **Bootstrap migration**: if the workspace DB is empty and a saved v1 project exists, wrap it as default org "Mi organización" / local user (Administración de organización) / project / one event. Ids for wrapped/imported legacy payloads are deterministic from a content hash, so repeating the migration or import does not duplicate (INV-001/INV-019). | No data loss for current users. |
| D9 | **Import**: both "Cargar .json" in the main menu and Header "Importar" create a new project with the file as its first event (card req. 6), using a fresh default project as merge base (no leak from the open event). The previous "replace the open model" import behaviour is removed. | Card req. 6; confirmed by the user (§12 Q4). |
| D10 | **Export** stays per event as a v1 `ProjectFile` (backward compatible). No workspace bundle export, no `version: 2` file format in this task. | Smallest change; format versioning belongs to OX-21. |
| D11 | Opening another event resets undo history and runs the existing reset path (`resetSim` + `fit`); undo must never restore another event's payload. | Correctness. |
| D12 | "Crear nuevo" (wizard) creates a new event in the active project starting from `createDefaultProject()`, not a clone of the open event. | Fixes venue inheritance across events. |
| D13 | Permission checks are applied in the store actions for workspace operations (create/rename/delete project and event, members, roles) and to disable editing UI for read-only roles at the top level (editor read-only banner). Per-field gating inside the map editor, budget, and Punto Violeta views is **excluded** (see §6). | Proportionate; avoids touching all hotspots. |

## 5. Technical approach

1. **Types** `src/types/workspace.ts`: entities of D3, `Role`, `Action`, `MembershipScope`.
2. **Engine** `src/engine/workspace/permissions.ts`: `ROLE_MATRIX`, `effectiveRole(userId, memberships, projectId, eventId?)`, `can(userId, memberships, action, target)`. Imports only `types/workspace.ts`. `src/engine/workspace/ids.ts`: deterministic id from content hash (non-simulation, no seed needed).
3. **DB** `src/db/workspace-repository.ts`: `WorkspaceRepository` interface + Dexie implementation (v2 tables in the existing `OxEyeDatabase`, defined in `repository.ts` — only the schema upgrade is added there) + in-memory implementation. All listing queries take `orgId` (local equivalent of INV-002). `src/db/workspace-migration.ts`: bootstrap wrap (D8) and v1 import-as-event (D9).
4. **Store** `src/store/useWorkspaceStore.ts` (new): workspace lists, `activeUserId`, `activeProjectId`, `activeEventId`, `activeDayId`; actions guarded by `can()`. `useProjectStore.ts` (additive only): `openEventPayload(project)` = replace without checkpoint + clear history; write-through of the active payload to `eventPayloads` after each save.
5. **UI** (Spanish):
   - `src/components/header/ContextHeader.tsx` in `.project-heading`: *Proyecto › Evento › Jornada* with switchers, active user, and the local-mode badge.
   - `src/components/menu/WorkspaceScreen.tsx` reached from GameMenu ("Espacio de trabajo"): list/create projects and events, open an event, import `.json` as a new project.
   - `src/components/modals/MembersDialog.tsx`: members per project/event, invite profile, change role, revoke, access log.
   - Read-only banner when the active role lacks `edit_layout`.
6. **App.tsx**: at most a few lines to pass the reset callback to GameMenu/ContextHeader if the Header callback cannot be reused. Single owner (AI Lead).

## 6. Scope and exclusions

In scope: requirements 1–6 of the card in local mode, as decided above.

Excluded:
- Any backend, authentication, server enforcement (criteria 2–3 stay open).
- Stored Jornada/Actividad entities (OX-06).
- Role gating of Punto Violeta visibility, budget fields, and per-tool map editing: the existing privacy protections stay as they are and are **not** relaxed; wiring roles into them needs the shared privacy gate (KI-05) and is a separate task.
- Fixing KI-01..03, ProjectFile v2 format, removing Drizzle schema, workspace bundle export.
- Any change to the simulation engines.

## 7. Domain invariants

- 5.5 `EventDemandConfig`: payloads are stored unchanged and pass through the existing load/import migrations (`syncDemandConfigToScene`). Verified by round-trip test.
- 5.3 Punto Violeta: no new view or export of incident data; per-event export is the same v1 file as today. The local-mode banner does not claim protection. Checked by `safety-auditor` on the diff.
- 5.1, 5.2, 5.4, simulation reproducibility: not touched; existing unit tests must stay green.

## 8. Agents and ownership (serialized)

| Step | Owner | Files |
|---|---|---|
| 1 Core | AI Lead | `src/types/workspace.ts`, `src/engine/workspace/*`, `src/db/workspace-*.ts`, `src/db/repository.ts` (Dexie v2 schema only), `src/store/useWorkspaceStore.ts`, `src/store/useProjectStore.ts` (additive), `src/App.tsx` (≤ few lines) |
| 2 UI | `ui-engineer` | `src/components/header/Header.tsx`, `src/components/header/ContextHeader.tsx`, `src/components/menu/GameMenu.tsx`, `src/components/menu/WorkspaceScreen.tsx`, `src/components/modals/MembersDialog.tsx`, related CSS |
| 3 Tests | `qa-engineer` | `tests/unit/workspace-*.test.ts`, `tests/e2e/workspace.spec.ts`, `tests/e2e/helpers.ts` (only if the first-run flow changes) |
| 4 Review | `code-reviewer`, `safety-auditor` | read-only |

(Exact paths of GameMenu/CSS are confirmed at execution; they stay within the directories listed in §11.)

## 9. Verification

- Unit: role × action matrix (every role, every action, event override of project role); `effectiveRole`; repository org scoping (org A user cannot list org B projects); bootstrap migration (wrap once, re-run → no duplicates); import as event (same file twice → same ids; payload deep-equal to `parseImportedProject` result, i.e. no element lost); undo reset on event switch.
- E2E: create project → two events in different venues → reload → reopen both, no duplicates; import a v1 fixture via the menu → appears as an event; existing first-run specs stay green.
- `npx tsc -b`, `npm run lint`, `npm run test`, `npm run test:e2e`, `npm run build`, compared with the recorded baseline (`oxeye-verification`).
- `safety-auditor` + `oxeye-invariants` on the diff.

## 10. Risks and rollback

- Dexie write-through is async; a closed tab right after an edit could leave `eventPayloads` behind the localStorage cache. Mitigation: on boot, if the cache belongs to the active event and is newer, it wins and is written back.
- localStorage quota is unchanged (only the active event lives there).
- Users of the previous version: bootstrap migration is additive; the v1 key is never deleted. Rollback = revert the branch; old versions keep reading the same v1 key.
- `configure(maps)` global side effect: always go through `replaceProject`.

## 11. Acceptance criteria

- [ ] A user creates a project with two events at different venues, reloads the app and recovers both without duplicates (local session).
- [ ] Role × action matrix implemented and unit-tested; a *Proveedor externo* profile can read but `edit_budget` is denied — **in local mode only**; the server-side rejection of the card remains **open** pending ADR-024-001.
- [ ] Repository queries are org-scoped and unit-tested — local equivalent only; real isolation (INV-002) remains **open** pending the server.
- [ ] A v1 project exported with the current version imports as an event without losing elements.
- [ ] Invite, role change and revoke are recorded with who and when.
- [ ] The context header always shows project, event and day, and the local-mode warning is visible.
- [ ] No regression against the baseline; no invariant changed.

## 12. Product questions (answered by the user, 2026-11-25)

1. Criteria 2–3 stay open until the server decision, with the local equivalents above — **yes**.
2. "Usuario activo" profile switch (D5) for the pilot demo — **yes** (kept as in D5).
3. The 7 proposed roles as starting set — **yes**.
4. Header "Importar" creates a new project instead of replacing the active event — **yes** (D9 updated).

## Allowed paths

- `doc/specs/2026-11-25-ox-03-proyectos-permisos.md`
- `src/types/workspace.ts`
- `src/engine/workspace/**`
- `src/db/workspace-repository.ts`
- `src/db/workspace-migration.ts`
- `src/db/repository.ts`
- `src/store/useWorkspaceStore.ts`
- `src/store/useProjectStore.ts`
- `src/App.tsx`
- `src/components/header/**`
- `src/components/menu/**`
- `src/components/modals/MembersDialog.tsx`
- `src/styles/layout.css`
- `src/styles/game-menu.css`
- `src/styles/index.css`
- `tests/unit/**`
- `tests/e2e/**`
