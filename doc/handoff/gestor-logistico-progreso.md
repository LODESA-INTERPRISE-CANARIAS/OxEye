# Handoff: gestor-logistico (2026-11-26)

For a new session. Read it with:
- the plan `doc/specs/2026-11-25-gestor-logistico.md` (frozen; approved for autonomous work through milestones 1–6);
- the execution log `doc/specs/2026-11-25-gestor-logistico.log.md` (every decision, one line each).

This file is the map; the log is the detail.

## State

| Milestone | State | Commit |
|---|---|---|
| 1 Base, acceso y Hoy | Done | `82c1d04`, plus `7222c7d` (local DB without Docker) |
| 2 Tareas + Calendario | Done, reviewed, audited, QA green | `FEAT: Gestor logístico · tareas y Calendario` |
| 3 Contactos + Catálogo | To do | |
| 4 Inventarios + Captura rápida | To do | |
| 5 Seguimiento + Órdenes de trabajo | To do | |
| 6 Sin cobertura + Cierre de jornada | To do | |

Branch: `feat/gestor-logistico`, published by the user.
- Never push, merge or touch `main`.
- Don't merge until the external server exists. Otherwise the public site would show a module with no server.

To update their local database after milestone 2, the user stops the API and runs:
- `npm --prefix server run db:migrate`, which applies 0002 and 0003;
- `npm --prefix server run db:seed`.

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
- `quality.ts`, `search.ts` (for M3), and `rules.ts` (kinds, statuses, 366-day span).

### `server/`
Node 26 runs TypeScript directly. Stack: Hono, zod, postgres.js. PGlite runs the tests and the local mode without Docker (`DATABASE_URL=pglite:./pgdata/pglite`).
- Migrations 0001–0003. They are append-only and checksummed.
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
- Screens: `hoy/`, `calendar/`, `events/`, `tasks/TaskSheet.tsx`, `shell/AddMenu.tsx` (with a fallback where the Popover API is missing). Inventarios, Contactos, Catálogo and Cierre de jornada are still placeholders.
- Styles live in `src/styles/logistics/`, scoped to `.lx`, and work in six palettes. Bendy uses a deeper cyan accent for contrast.

### Tests
- `tests/unit/logistics/` for the shared logic and the calendar layout.
- `server/tests/` on PGlite.
- `tests/e2e/logistics/`: a stateful `mock-api.ts`, `plan-fixtures.ts` with a fixed clock, behavioural specs, and the `ui-review.spec.ts` screenshot harness (writes to `test-results/visual/logistics-*`).

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

### 3. Contactos + Catálogo
- **Contacts:** name, company, role, phone, e-mail, notes, linked events.
- **Full companies:** add the foreign key for `main_contact_id`.
- **Reaching out:** call, WhatsApp and e-mail only after a confirmation sheet. Share a contact with the chosen fields only.
- **Offers:**
  - price `null` means unknown;
  - units: unidad, metro, hora, día, km, pack, custom;
  - separate transport, assembly and maintenance costs;
  - VAT may be unknown;
  - conditions.
- **Categories:** extensible.
- **Universal search:** suggestions, filters, the 5 most recent searches.
- **Tasks:** start using `contactId`.
- **Safety:**
  - no real people in the demo data;
  - «kg» never derives kg/m² and never sets `heavyLoad=false`.

### 4. Inventarios + Captura rápida
- **Warehouses:** name and address, no geometry.
- **Resources:** quantity, unit, dimensions, condition, availability, «aún por evaluar». Owned and contracted are kept apart.
- **«+ Añadir»** offers Evento, Contacto, Empresa, Recurso, Oferta, Tarea, Incidencia and Nota.
- **History** is visible on each record.
- **Resource overlaps** go into `planWarnings`.
- **Safety:**
  - the «Incidencia» copy says Punto Violeta cases and attended-person data are not recorded here;
  - labels never contain note text;
  - no export of notes without a safety review.

### 5. Seguimiento + Órdenes de trabajo
- **Now / next / late view** with quick status actions.
- **Delay hypothesis** with `simulateDelay`:
  - shown hatched;
  - re-runs `planWarnings`;
  - changes nothing until «Aplicar al plan» is confirmed.
- **Work orders** per company or person: printable, saved as PDF, shared after confirmation.
- **Also in this milestone:**
  - after a 409, merge instead of replacing;
  - a declared mark «Subsuelo revisado en el simulador».

### 6. Sin cobertura + Cierre de jornada
- **Offline:**
  - Dexie outbox under its own database name; never touch `src/db/repository.ts`;
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
