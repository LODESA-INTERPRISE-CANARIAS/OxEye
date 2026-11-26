# Handoff: gestor-logistico (2026-11-26, after milestone 3)

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
| 4 Inventarios + Captura rápida | To do | |
| 5 Seguimiento + Órdenes de trabajo | To do | |
| 6 Sin cobertura + Cierre de jornada | To do | |

Branch: `feat/gestor-logistico`, published by the user.
- Never push, merge or touch `main`.
- Don't merge until the external server exists. Otherwise the public site would show a module with no server.

To update their local database after milestone 3, the user stops the API and runs:
- `npm --prefix server run db:migrate`, which applies 0004 (and 0002–0003 if still missing);
- `npm --prefix server run db:seed`, which adds the built-in categories and, unless the demo was removed, the demo people, companies and offers.

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
- `contact-links.ts`: `phoneInfo` (+34 for Spanish numbers, short numbers, warnings), `tel:`/`wa.me`/`mailto:` (no WhatsApp when the number has a warning), share text with chosen fields only.

### `server/`
Node 26 runs TypeScript directly. Stack: Hono, zod, postgres.js. PGlite runs the tests and the local mode without Docker (`DATABASE_URL=pglite:./pgdata/pglite`).
- Migrations 0001–0004. They are append-only and checksummed.
- Guests never receive phones, e-mails, observations, prices, costs or conditions: one path, `records/redact.ts` (`forViewer`, `WITHHELD_FROM_GUESTS`); records carry `restricted`. New free-text fields must be added there.
- Advisory locks in `records/locks.ts`: graph lock (task dependencies), then catalogue lock (categories, companies, contacts, offers), then rows. Keep that order.
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
- Screens: `hoy/`, `calendar/`, `events/`, `tasks/TaskSheet.tsx` (+ `TaskContactField.tsx`), `contacts/` (Personas / Empresas y entidades, reach-out confirmation, share), `catalog/` (offers, comparison, category picker), `search/` (universal search, venue sheet), `shell/AddMenu.tsx` (with a fallback where the Popover API is missing). Inventarios and Cierre de jornada are still placeholders.
- Sheets stack by sequence key; a sheet with unsaved changes is never replaced silently. New record forms use `forms/useRecordForm.ts` (dirty guard, 409, rescue, `leaveFor`, `startNext`).
- Styles live in `src/styles/logistics/`, scoped to `.lx`, and work in six palettes. Bendy uses a deeper cyan accent for contrast.

### Tests
- `tests/unit/logistics/` for the shared logic and the calendar layout.
- `server/tests/` on PGlite.
- `tests/e2e/logistics/`: a stateful `mock-api.ts` (its guest-withheld lists mirror `WITHHELD_FROM_GUESTS` by hand), `plan-fixtures.ts` with a fixed clock, `directory-fixtures.ts` (fictitious people and `trapOutgoing()` for links), behavioural specs, and the `ui-review.spec.ts` screenshot harness (writes to `test-results/visual/logistics-*`).
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
- A `reason` code on `PhoneInfo` (the UI currently detects «missing prefix» by the warning text).
- No UI yet to delete a custom category (the route exists).
- Before the external server: migration checksums hash raw bytes and `.gitattributes` has `* text=auto`; check out with LF there, or add a careful checksum step. Do not change it against the user's existing local database.
- `refresh` fetches 8 lists every 60 s; consider `?since=` or ETags before M6.

### 4. Inventarios + Captura rápida
- **Warehouses:** name and address, no geometry.
- **Resources:** quantity, unit, dimensions, condition, availability, «aún por evaluar». Owned and contracted are kept apart.
- **«+ Añadir»** offers Evento, Contacto, Empresa, Recurso, Oferta, Tarea, Incidencia and Nota.
- **History** is visible on each record.
- **Resource overlaps** go into `planWarnings`.
- **Safety:**
  - the «Incidencia» copy says Punto Violeta cases and attended-person data are not recorded here;
  - labels never contain note text;
  - no export of notes without a safety review;
  - new free-text fields (Nota and any other) are withheld from guests through `WITHHELD_FROM_GUESTS`, not a copy;
  - search never matches or quotes note bodies;
  - a resource's «kg», quantity and dimensions never combine into a load per area and never answer `heavyLoad`: send the user to the simulator's X-ray check;
  - deleting a resource-scope category must unlink resources.

### 5. Seguimiento + Órdenes de trabajo
- **Now / next / late view** with quick status actions.
- **Delay hypothesis** with `simulateDelay`:
  - shown hatched;
  - re-runs `planWarnings`;
  - changes nothing until «Aplicar al plan» is confirmed.
- **Work orders** per company or person: printable, saved as PDF, shared after confirmation. The user chooses the fields; contact notes and descriptions and offer conditions are never included by default and never for guests. Comparisons reuse `compareOffer` and never sum costs.
- **Also in this milestone:**
  - after a 409, merge instead of replacing;
  - a declared mark «Subsuelo revisado en el simulador».

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
- Decide whether task and event notes (visible to guests since M1) should also be withheld from Invitado, like contact observations.
- Note: the shared member login «Equipo» shows its server-side recent searches to everyone who uses it.
- Try calling, WhatsApp, e-mail and «Compartir» on a real phone (only checked with mocks).
