# Handoff: gestor-logistico (2026-11-26, after milestone 5)

For a new session. Read it with:
- the plan `doc/specs/2026-11-25-gestor-logistico.md` (frozen; approved for autonomous work through milestones 1–6);
- the execution log `doc/specs/2026-11-25-gestor-logistico.log.md` (every decision, one line each).

This file is the map; the log is the detail.

## State

| Milestone | State | Commit |
|---|---|---|
| 1 Base, acceso y Hoy | Done | `82c1d04`, plus `7222c7d` (local DB without Docker) |
| 2 Tareas + Calendario | Done, reviewed, audited, QA green | `FEAT: Gestor logístico · tareas y Calendario` |
| 3 Contactos + Catálogo | Done, reviewed, audited, QA green | `FEAT: Gestor logístico · contactos y catálogo` |
| 4 Inventarios + Captura rápida | Done, reviewed, audited, QA green | `FEAT: Gestor logístico · inventarios, notas y captura rápida` |
| 5 Seguimiento + Órdenes de trabajo | Done, reviewed, audited, QA green | `FEAT: Gestor logístico · seguimiento, hipótesis y órdenes de trabajo` |
| 6 Sin cobertura + Cierre de jornada | To do | |

Branch: `feat/gestor-logistico`, published by the user.
- Never push, merge or touch `main`.
- Don't merge until the external server exists. Otherwise the public site would show a module with no server.

To update their local database after milestone 5, the user stops the API and runs:
- `npm --prefix server run db:migrate`, which applies 0006 (and any earlier one still missing). Existing tasks get no subsoil mark; there are no hypotheses yet.
- `npm --prefix server run db:seed` is not needed for M5: it adds nothing new (no demo hypotheses, no subsoil marks).

## Architecture

### `shared/logistics/`
The contract and pure logic, used by both the server and the UI. Imports use `.ts`.
- `contracts.ts`: types, plus the route table in the header comment.
- `time.ts`: `Atlantic/Canary`, `slotToInstants(..., endDate)`, `occupiedDates`.
- `schedule.ts`: overlaps, `findCycle`, slack, and `simulateDelay` (for M5; it never mutates).
- `conflicts.ts`: `planWarnings`.
  - Conflicts: same venue, same company in two places, dependency order.
  - Reminders: heavy load, unknown load, routes A/B/C plus Carpa Amarilla (including untimed tasks on the event day).
  - `SUBSOIL_THRESHOLD_NOTE` is the only place 500 kg/m² is written, and a test pins it to the engine constant.
- `quality.ts` (withheld fields are never «missing»), `rules.ts` (kinds, statuses, 366-day span; M3: company kinds, price units, 15 built-in service categories, limits, phone/e-mail/amount validators).
- `search.ts`: ranking, `universalSearch` (client-side over loaded lists; never notes, conditions or quoted free text), `namesLookAlike`/`findLookAlikes` («¿Es la misma que…?»).
- `catalogue.ts`: unit labels, `costLines` (never a total), `pendingExtras`, `compareOffer` (same category + unit + known tax treatment; the rest `otherTax` / `unpriced`).
- `contact-links.ts`: `phoneInfo` (+34 for Spanish numbers, short numbers, warnings with a `reason` code), `tel:`/`wa.me`/`mailto:` (no WhatsApp when the number has a warning), share text with chosen fields only.
- `inventory.ts` (M4): `parseQuantity` («1.000» thousands, «0.500» = 0,5), `formatQuantity`, `quantityLabel` («≈ 40 unidades · por evaluar», «1 unidad»), `unitFor`.
- `history.ts` (M4): `FIELD_LABEL` (field names → Spanish), `describeChange` (names, never values), `noteLabel` (kind + what it is about; never the text, never a person's name).
- `conflicts.ts` M4 additions: `resource_overlap` (conflict when one *unit* or none in stock, otherwise a reminder stating the stock), `resource_unavailable` (damaged / under repair), `RESOURCE_LOAD_NOTE` (inventory figures never compute a load on the ground).
- M5:
  - `followup.ts`: `lateness` (5-minute grace), `suggestedDelay`, `delayModeFor` (`shift` / `extend` = «se alarga»), `delayBlocker`, `delayItems` (tasks under way or done are `fixed`: they occupy their lane but never move), `analyzeDelay` (shifted / absorbed / unknown, `planWarnings` re-run on the hypothetical plan → new, worsened and cleared warnings, `routeReminders`, `eventMargins`), `shiftExpectations`, `sameShift` (rejects duplicates).
  - `schedule.ts`: `ScheduleItem.fixed`, `simulateDelay(…, mode)`, `endDeltaMinutes`, `delayBudget`.
  - `merge.ts`: `mergeThreeWay` for forms after a 409.
  - `work-order.ts`: `WORK_ORDER_FIELDS` allowlist (members-only fields off by default, dropped for guests), `buildWorkOrder`, `workOrderText`, `tasksForRecipient`.
  - `conflicts.ts`: a declared subsoil review removes the heavy-load reminder; a finished heavy task without it keeps one.
  - `rules.ts`: M5 constants, `SUBSOIL_REVIEW_LABEL` / `SUBSOIL_REVIEW_NOTE` (no figure), `TASK_KIND_LABEL` / `TASK_STATUS_LABEL` (moved from the UI).
  - `time.ts` `daysForInstants`, `history.ts` `hypothesisLabel`, `contact-links.ts` `mailtoHref(…, body?)`.

### `server/`
Node 26 runs TypeScript directly. Stack: Hono, zod, postgres.js. PGlite runs the tests and the local mode without Docker (`DATABASE_URL=pglite:./pgdata/pglite`).
- Migrations 0001–0006. They are append-only and checksummed.
- M5 `hypotheses/`:
  - Apply takes the graph lock, then `FOR UPDATE` on the organization's task rows; it recomputes with the shared functions and writes only if `sameShift` holds, otherwise 409 with the organization's involved tasks. Only times, local days and (optionally) the root's status are written.
  - Task delete removes open hypotheses and unlinks applied ones; demo removal deletes all hypotheses of demo tasks.
- Subsoil mark (`tasks/domain.ts` `nextSubsoilReview`): strict `subsoilReviewed`; cleared when venue, heavy load or resources change, and when a used resource is deleted or its quantity, unit or dimensions change.
- Guests never receive phones, e-mails, observations, prices, costs or conditions: one path, `records/redact.ts` (`forViewer`, `WITHHELD_FROM_GUESTS`); records carry `restricted`. Since M4 also event and task notes, warehouse address and notes, resource location and notes, and note text. New free-text fields must be added there, with a marker in `server/tests/redaction.test.ts` and in the E2E mock's mirror.
- Advisory locks in `records/locks.ts`: graph lock (task dependencies, multi-task writes, resource and task deletes), then catalogue lock (categories, companies, contacts, offers, and since M4 warehouses, resources and notes), then rows. Keep that order.
- M4 links from resources and notes have no ON DELETE action: every delete path unlinks first (version, author, activity). A new delete path must call `unlinkResources` / `unlinkNotes` or it fails loudly.
- History: `GET /organizations/:orgId/activity?entityType=&entityId=`.
- Company names are unique per organization (409 `DUPLICATE` with `current`); contacts may share a name.
- Optimistic concurrency with `version`; a stale write gets 409 with `current`.
- Guests are read-only.
- A foreign organization gets 404.
- Activity is logged in the same transaction.
- An advisory lock protects dependency writes.
- Every new route is added to the route-surface test in `server/tests/http.test.ts`.
- Once removed, the demo is never re-seeded (`organizations.demo_removed_at`).

### `src/logistics/`
A lazy module opened from `GameMenu.tsx`.
- Deep links: `#logistica`, `#logistica/<space>`, `#logistica/calendario/YYYY-MM-DD`.
- Store: write epochs, a version-aware merge that keeps object identity, and the unsaved-form rescue (`lib/rescue.ts`).
- Plan: `common/usePlan.ts` is a cached selector.
- Screens: `hoy/` (+ `NotesCard.tsx`), `calendar/`, `events/`, `tasks/TaskSheet.tsx` (+ `TaskContactField.tsx`, `TaskResourcesField.tsx`), `contacts/` (Personas / Empresas y entidades, reach-out confirmation, share), `catalog/` (offers, comparison, category picker with «Gestionar»), `inventory/` (Inventarios: Propios / Contratados, resource and warehouse sheets), `notes/` (note sheet, `RefPicker`), `common/RecordNotes.tsx` and `common/RecordHistory.tsx` (in every record sheet), `search/` (universal search, venue sheet), `shell/AddMenu.tsx` (grouped «Captura rápida» / «Planificación», with a fallback where the Popover API is missing). Cierre de jornada is still a placeholder.
- Resource and note slots in `LogisticsApp.tsx` remember the card they replaced (`add*` stacks on top; `open*` replaces).
- Sheets stack by sequence key; a sheet with unsaved changes is never replaced silently. New record forms use `forms/useRecordForm.ts` (dirty guard, 409, rescue, `leaveFor`, `startNext`).
- M5:
  - `hoy/TodayTasks.tsx` is «La jornada»: Va tarde / Ahora / Lo siguiente…, with quick actions and «Deshacer»; toasts pause on hover or focus and clear on logout.
  - `followup/`: `HypothesisSheet.tsx` (explore, save, apply with confirmation, discard), `useQuickStatus.ts`, `TaskWhatIf.tsx`.
  - `orders/`: work-order sheet, A4 preview, print root portalled to `<body>` with print rules guarded by `body:has(> .lx-print-root)`, send sheet.
  - `tasks/SubsoilReview.tsx` and `tasks/subsoil.ts` (`subsoilAfterMerge`).
  - `forms/merge.ts` + `forms/MergeNotice.tsx`: merge after a save 409 in every form (date and times fold into one field).
- Styles live in `src/styles/logistics/`, scoped to `.lx`, and work in six palettes. Bendy uses a deeper cyan accent for contrast.

### Tests
- `tests/unit/logistics/` for the shared logic and the calendar layout.
- `server/tests/` on PGlite.
- `tests/e2e/logistics/`: a stateful `mock-api.ts` (its guest-withheld `WITHHELD` map mirrors `WITHHELD_FROM_GUESTS` by hand; `failHistory` / `holdHistory()` for history states), `plan-fixtures.ts` with a fixed clock, `directory-fixtures.ts` (fictitious people and `trapOutgoing()` for links), `inventory-fixtures.ts` (M4), behavioural specs (M4: `inventory`, `resources-in-tasks`, `notes`, `inventory-privacy`), and the `ui-review.spec.ts` screenshot harness (writes to `test-results/visual/logistics-*`).
- M5 tests:
  - E2E: `followup-fixtures.ts`; specs `followup`, `hypothesis`, `subsoil`, `merge`, `work-orders`. The mock recomputes an apply with the shared functions and offers `forceApplyConflict`. A long mailto opened from code is caught through CDP `Page.frameRequestedNavigation`, because `trapOutgoing()` cannot redefine `location`.
  - Unit: `followup`, `work-order`, `followup-ui`, `delay-propagation`.
  - Server: `server/tests/followup.test.ts`.
  - Known flaky under full-suite load: `phone` tab bar and `ui-review` login (both pass on rerun).
- Fictitious data only: names with «Demo» / «Prueba», phones `+34 000 000 0XX`, e-mails `@example.com`. Real La Laguna venue names are fine without contact details.

## Product decisions (user-approved)
- Five users with passwords: Elvis, Dailos, Yeray, Equipo, and Invitado (read-only).
- The backend will live on an external server; the choice is pending.
- Only the name is required. Everything else can be «Pendiente de verificar».
- Every record carries source, verification, author and time.
- Certainty grammar: confirmed is solid, planned is an outline, hypothesis is hatched, pending is dotted.
- A task's event is optional. Companies are created by name. Multi-day uses `endDate`.
- PDFs come from the browser's «Guardar como PDF».

## Next milestones

Pattern for each milestone:
1. Extend the contract in `shared/`.
2. Backend-engineer (with a new migration) and ui-engineer work in parallel.
3. QA writes behavioural E2E; code-reviewer and safety-auditor review.
4. Fix, log, commit, and report in Spanish.

### 3. Contactos + Catálogo (done)
User decisions: guests see names, companies, roles and offers but never phones, e-mails, observations, prices, costs or conditions; one list «Empresas y entidades» with a kind (proveedor, organismo público, asociación, otra). Tax wording is «Impuestos (IGIC/IVA)»; the API field stays `vatIncluded`. Detail in the log.

Carried to later milestones (from the M3 audit and review):
- ~~A `reason` code on `PhoneInfo`~~ and ~~UI to delete a custom category~~: done in M4.
- Before the external server: migration checksums hash raw bytes and `.gitattributes` has `* text=auto`; check out with LF there, or add a careful checksum step. Do not change it against the user's existing local database. (`server/.gitattributes` pins `migrations/*.sql` to LF; a server test checks every migration file is LF.)
- `refresh` now fetches 11 lists every 60 s; consider `?since=` or ETags before M6.

### 4. Inventarios + Captura rápida (done)
The user answered «adelante con tus recomendaciones» (they were away). Decisions in the log:
- Invitado no longer receives event and task notes, and does not receive warehouse address, resource location, any notes or note text («Visible para el equipo»). It sees names, category, quantity, unit, dimensions, condition, availability, ownership and supplier.
- A task lists the resources it uses; the same resource in two overlapping live tasks is a conflict when there is one unit or none, otherwise a reminder with the recorded stock. No per-assignment quantities.
- «+ Añadir» grouped: «Captura rápida» (Incidencia, Nota, Recurso, Persona) then «Planificación» (Tarea, Evento, Empresa, Oferta).
- The free-text field of tasks and events is labelled «Observaciones»; «Notas» are the linked notes.
- Notes are never searched, exported or shared; outside the note itself they are labelled by `noteLabel` only.

Carried from M4 (audit, review, QA):
- Not run against PostgreSQL in Docker: migration 0005 and the new locks were tested on PGlite only.
- E2E gaps: logout clearing the form rescue; `NOTE_PRIVACY_HINT` on event/task «Observaciones»; the Popover fallback.
- Optional server cleanup: a shared helper for `throwIfFields` and find-or-create (copied in tasks, resources, warehouses).
- Phone: a long warehouse name pushes its count badge to a second line (natural wrap); the «+ Añadir» FAB overlaps list rows while scrolling (as everywhere).
- Idea for later: a «hide text» toggle for the Hoy notes card when projecting in a meeting; reservations by time slot and stock shortage; photos on resources and notes.

Safety conditions carried to M5–M6 (from the M4 audit):
- Work orders and the day close are built from `forViewer` records, never from raw rows. They never include note text, observations, warehouse address or resource location by default, and never for guests.
- `DayReport` notes go through `forViewer('note', …)` and need a safety review before any PDF; default to `noteLabel` + status, text only when a member explicitly includes it.
- «Subsuelo revisado en el simulador» is a declared mark only: never inferred from inventory figures, never quoting or computing the threshold, never claiming compliance. A hypothesis never changes `heavyLoad`.
- The M6 Dexie cache and outbox apply the same withholding and clear on logout (notes, observations, addresses, locations, the rescue slot).
- Any storage or assembly area on the venue map needs its own plan with the A/B/C, Carpa Amarilla, accessibility and subsoil checks.

### 5. Seguimiento + Órdenes de trabajo (done)
The user was away («sigue con tus recomendaciones»); the AI Lead's answers stand and are logged:
- Hypotheses are stored on the server for the team (note withheld from Invitado). Applied ones stay as a record.
- «Aplicar al plan» moves everything the propagation moves, in one transaction, and marks the delayed task «Con retraso» (an option in the confirmation).
- «La jornada» lives in Hoy (no new space).
- Work orders:
  - built in the browser from `forViewer` records;
  - default fields: schedule, venue, materials, contact name, dependencies;
  - members-only and unticked: contact phone, warehouse address, resource location, observations;
  - never: note text, people's notes and descriptions, offer conditions, prices and costs;
  - Invitado has none;
  - the PDF is saved by the user and attached by hand.

Carried from M5 (review, audit, QA):
- Not run against PostgreSQL in Docker: migration 0006, the apply row locks and the new resource-edit lock path were tested on PGlite only.
- Not checked on a real phone: `wa.me`, `mailto`, `navigator.share`, and the browser's print to PDF of a work order.
- Ideas for later:
  - hypothesis overlay in the calendar;
  - chained or range hypotheses («entre 15 y 30»);
  - a record of work orders sent, with «ha cambiado desde que se envió»;
  - automatic PDF attachment (needs a library);
  - an amber token for «va tarde» (today it uses the danger colour).

Safety conditions carried to M6 (from the M5 audit):
- Outbox:
  - never queue `POST /hypotheses/:id/apply`, which always needs a live confirmation;
  - drop a queued `subsoilReviewed: true` if the server's venue, heavy load or resources changed before replay;
  - every queued write carries `version`, and a 409 goes through the merge;
  - queued free text (hypothesis note, observations) is tied to the user id, never queued for guests, and cleared on logout.
- `DayReport`:
  - hypotheses only by `hypothesisLabel`, open and applied kept distinct and labelled «hipótesis»;
  - finished heavy tasks without a declaration listed as pending review;
  - a declared mark shown as «declarada por X», never as verified;
  - routes reminder for live deliveries and transport in the event window;
  - no note or incident text without the safety review;
  - any threshold figure only through `SUBSOIL_THRESHOLD_NOTE`;
  - its print uses the same `body:has(> .lx-…-root)` scoping and its own named `@page`.
- Logout and org switch also clear any new Dexie or localStorage cache, the outbox, the `usePlan` cache and toasts (the last two are done).

### 6. Sin cobertura + Cierre de jornada
- **Offline:**
  - Dexie outbox under its own database name; never touch `src/db/repository.ts`;
  - cached contacts (phones, notes) are cleared on logout, for shared devices;
  - sync on reconnect;
  - visible conflicts;
  - an honest sync chip.
- **Day close:**
  - the day's changes, % pending, offers, incidents, decisions, open questions;
  - output as PDF;
  - incidents need a safety review before export.

## Pending with the user
- Choose the external server. Then update the ADR and the deployment settings: `TRUST_PROXY`, `API_BIND`, `NODE_ENV=production`, `CORS_ORIGINS` and a real password.
- Install the protected fix in `.claude/skills/oxeye-invariants/SKILL.md`, line 57: the anchor `src/db/schema.ts` becomes `src/db/repository.ts`.
- Decide whether the first names in `server/src/seed/seed.ts` stay in the public repository.
- Decide whether same-venue overlaps should be softened per venue.
- Try «+ Añadir» on a real iPhone with iOS 16 (the Popover fallback), and add an E2E test that removes `showPopover`.
- Note: the shared member login «Equipo» shows its server-side recent searches to everyone who uses it.
- Try calling, WhatsApp, e-mail and «Compartir» on a real phone (only checked with mocks).
- Try the M4 quick capture on a real phone: «+ Añadir» → Incidencia / Nota / Recurso in under 30 seconds, and the Inventarios lists while walking a warehouse.
- Try M5 on a real phone and PC:
  - la jornada with one hand;
  - «¿Y si…?» → «Aplicar al plan»;
  - a work order saved as PDF from the browser and sent by WhatsApp and e-mail.
- Review M5 decisions taken while the user was away (log):
  - hypotheses stored for the team;
  - «Aplicar» moves the whole chain and marks «Con retraso»;
  - the work-order fields: by default, members-only, and never.
