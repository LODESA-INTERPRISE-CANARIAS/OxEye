# Logistics Manager pilot (Gestor logístico)

- Slug: `gestor-logistico`
- Branch: `feat/gestor-logistico`
- Base: `main` + `1e8b246` (CLAUDE.md v5.1, product vision)
- Vision: `doc/product/logistics-manager.md`. Design references: `doc/logistic/*.pdf` and the dashboard image supplied by the user on 2026-11-25 (clean card layout; adapted to OxEye, not copied).
- Mode: one approval covers the whole pilot. The AI Lead works through the milestones autonomously and only returns for commands Claude Code cannot run (Docker, servers) or for product-changing decisions.

## Goal and intended experience

On Wednesday 2 December 2026 the team follows Elvis through a real day of event production in La Laguna, with OxEye open on a phone. They capture what they learn (events, venues, warehouses, materials, companies, contacts, offers, tasks, incidents) in under 30 seconds per item, find anything in seconds, test «¿y si el camión llega 15 minutos tarde?» without touching the real schedule, send a company its work sheet, and close the day with a report. Dailos follows the same data from his office. Everything survives closing the browser and a spell without coverage, and every record says who entered it, when, from which source and how verified it is.

The window is the first piece of a new visual language for OxEye: the clarity of the reference dashboard (airy white cards, pill buttons, coloured status chips, actionable lists, a mini calendar, an activity feed) with OxEye's editorial and cartographic identity.

## Design direction

| Reference element | In OxEye |
|---|---|
| Left sidebar with grouped navigation | Desktop/tablet sidebar with the five spaces (Hoy, Calendario, Inventarios, Contactos, Catálogo) plus Cierre de jornada, organization selector on top, «Volver a OxEye» at the bottom. Phone: bottom tab bar with large targets, horizontal swipe between spaces |
| «Hi, Morgan!» header + primary pill action | «Hola, Elvis» in Georgia, today's date in `Atlantic/Canary`, sync chip, primary pill **«+ Añadir»** (fixed floating button on phone) |
| Upcoming event cards | Today's and next events: venue, time window, status chip, «Ver detalle» / «Editar» |
| Budget gauge | **«Información verificada»** half gauge: % validated vs pending, with what is missing (dimensions, prices, times) |
| AI suggestions | **«Avisos»**: computed, explained warnings (overlap in the same venue, task without company, event without times) and the **«¿Y si…?»** delay card. Labelled as calculations, never as AI |
| Mini calendar with dots | Month with dots per day (events, tasks), tap to open the day |
| Pending tasks with actions | «Pendientes» with «Marcar como hecho» / «Añadir nota» and the assigned company |
| Recent activity table | «Actividad reciente» from the activity log: who, what, which event, when, verification chip |
| Mint accent | The active palette's accent; all six palettes including the dark Noctis. Territorio is the closest to the reference |

OxEye touches:
- Georgia for editorial titles, Inter with tabular figures for times, quantities and prices.
- Uppercase eyebrows with place and coordinates, as in the hub («SAN CRISTÓBAL DE LA LAGUNA · 28°29′ N 16°19′ O»).
- **One visual grammar for the certainty of data**, used everywhere: confirmed = solid chip, planned = outlined, hypothesis = diagonal hatching (cartographic hatch), pending verification = dotted marker with «Pendiente de verificar». This makes methodological honesty visible.
- A faint contour-line texture in the sidebar and header, the OxEye eye mark, and the plain-language `?` explanations.
- New primitives (card, pill button, chip, gauge, list row, sheet, tab bar) are built under `src/logistics/ui/` with tokens derived from the palette variables, so the rest of OxEye can adopt them later. Restyling the simulator is not part of this plan.

## Milestones (each one usable end to end and committed)

1. **Foundation.** `server/` (Hono, PostgreSQL, SQL migrations, seed, auth), shared contract, hub entry «Gestor logístico», deep link `#logistica`, login with the five users, shell (sidebar / tab bar, swipe, header, sync chip), server states, organization selector. Events: list, create incomplete, edit, optimistic concurrency.
2. **Hoy + Calendario.** Dashboard as above. Calendar: month view; day view with columns per venue and time rows; tasks (assembly, activity, dismantling, transport, other) with planned/confirmed/delayed status, company, dependencies. Overlap detection per venue and per resource. Phone portrait: list by hour; landscape: timeline, section swipe locked, vertical scroll through hours, pinch to change row height, plus +/− buttons for accessibility and desktop.
3. **Contactos + Catálogo.** People and companies (organization, role, phone, e-mail, notes, linked events). Call / WhatsApp / e-mail open only after a confirmation sheet. Share a contact card with only the chosen fields. Company catalogue: offers with description, price, unit (unit, metre, hour, day, km, pack, custom), separate transport, assembly and maintenance costs, conditions. Extensible category taxonomy. Universal search with suggestions while typing, category filters and the user's five recent searches.
4. **Inventarios + Captura rápida.** Warehouses with location; items with category, quantity, unit, dimensions, condition, location, availability, «aún por evaluar». Own resources vs contracted services kept distinct. «+ Añadir» flow: Evento / Contacto / Empresa / Recurso / Oferta / Tarea / Incidencia / Nota → minimum fields → «Guardar y seguir»; missing fields marked «Pendiente de verificar». Every record carries source (observado / comunicado / documento), author, date, verification (borrador / por verificar / validado) and change history.
5. **Seguimiento + Órdenes de trabajo.** Day follow-up: what should be happening now, what arrives next, what is late. Delay hypothesis: pick a task, enter minutes (exact or estimated), see propagated effects through dependencies, affected tasks, new overlaps and remaining slack, all hatched as hypothesis; nothing changes until «Aplicar al plan» with confirmation. Work-order sheet per company or person (times, place, materials, responsible, dependencies, notes) as a printable page → PDF, and sent via WhatsApp / e-mail / system share after confirmation.
6. **Sin cobertura + Cierre de jornada.** Offline drafts and an outbox in IndexedDB (Dexie, already a dependency); automatic sync on reconnect; conflicts shown and resolved, never overwritten silently; honest chip («Sincronizado», «Sin conexión · 3 cambios pendientes», «Solo en este dispositivo» when no server). Day close: events created/modified, new contacts and companies, inventoried resources, % information pending, offers incorporated, incidents, decisions, open questions and discovered feature ideas; viewable on PC, exportable as PDF.

If time runs short before 2 December, milestones 1–4 plus the delay hypothesis are the demo minimum; the order above already protects it.

## Product decisions confirmed by the user (2026-11-25)

1. PDF via dedicated print layouts and the browser's «Guardar como PDF»; no PDF library.
2. Login screen lists the five display names; the user types only the password.
3. Seed one fictitious demo event flagged «demo», removable in one action before the field day.

## Technical decisions

| Topic | Decision | Why |
|---|---|---|
| Runtime | Node 26 runs TypeScript directly (type stripping); no build step | Installed already; same command locally and on the server |
| HTTP | `hono` + `@hono/node-server` | Small, TypeScript-first, in-process testing with `app.request()` |
| Validation | `zod` | Boundary validation with Spanish error messages |
| Database | PostgreSQL 17 in Docker Compose; `postgres` driver behind a small `Db` adapter | Plain parameterised SQL, no ORM; adapter allows an in-process test database |
| Migrations | Versioned plain SQL `server/migrations/NNNN_name.sql`, forward-only, applied in transactions with a `schema_migrations` table | Reviewable; matches CLAUDE.md backend rules |
| Tests | Vitest from the root install (`npx vitest run --root server`) against `@electric-sql/pglite` | Real SQL and migrations without Docker |
| Auth | `crypto.scrypt` password hashes; opaque session token (only SHA-256 stored), Bearer header, 30-day sliding expiry, login rate limit; `Invitado` read-only | No dependency; works cross-origin; no secret in the repo |
| Initial passwords | Generated by the seed, printed once, never committed; `--reset-passwords` | No embedded passwords |
| Shared contract | `shared/logistics/**`: types and pure functions only, no imports from `src/` or `server/` packages | One source of truth; frontend build and Pages deploy never depend on `server/` |
| Pure domain logic | Delay propagation, overlap detection, slack, local time ↔ UTC, search ranking, verification %, report aggregation in `shared/logistics/` | Unit-testable once, used by server and client |
| Frontend | `src/logistics/**`, lazy-loaded from `GameMenu.tsx`; own Zustand store; no change to `App.tsx` | Simulation untouched and its bundle does not grow |
| Dev networking | Vite dev proxy `/api` → `http://localhost:8787`; production uses `VITE_LOGISTICS_API_URL` | One URL in dev, also from a phone on the same Wi-Fi |
| Gestures, icons, charts | Pointer events, inline SVG icons, SVG gauge; no libraries | No dependencies for what is a few dozen lines |
| PDF | Dedicated print layouts + the browser's «Guardar como PDF» / system share | No dependency; readable without access to the system |
| Deployability | `server/Dockerfile` (runtime deps only) and compose profile `full` (db + API); configuration from environment | Moving to the external server = same image + `.env` |
| Drizzle | Remove `drizzle-orm`, `drizzle-kit` and unused `src/db/schema.ts` (audit KI-18) | Not reused; the user runs the uninstall to update the lockfile |

### Data model (grows by migration per milestone)

`organizations`, `users`, `sessions`, `venues`, `events`, `tasks`, `task_dependencies`, `warehouses`, `resources`, `companies`, `contacts`, `categories` (extensible), `offers`, `notes` (note / incident / decision / open question / feature idea), `hypotheses` (stored, never applied implicitly), `recent_searches`, `activity_log`. Mutable records: UUID, `version`, `created_by/at`, `updated_by/at`, `source`, `verification`. Instants as `timestamptz` with the event time zone (`Atlantic/Canary` default).

## Included improvements

- Deep link `#logistica` for the morning link to the team; installable on the phone's home screen (web manifest).
- Conflict handling from day one; «Ver versión actual» instead of silent overwrite.
- `Invitado` read-only, so a shared guest login cannot alter data.
- Activity log from the first write; it feeds «Actividad reciente» and the day close.
- «Información verificada» indicator, so the team sees how much of what they captured is still unconfirmed.
- Computed warnings explained in plain language (why it is an overlap, which tasks depend on it).
- Seeded demo data clearly flagged «demo» and removable in one action, so the real data of the day stays clean.

## Ideas for later (separate proposals, not in this plan)

Inventory reservations by time slot and shortage/cost calculation; critical path and chained hypotheses; real-time multi-user presence; automatic sending to coordinators; two-way link with the simulation map (place a warehouse item on the venue, check routes A/B/C and subsoil); economic dashboard; adopting the new UI primitives in the simulator.

## Work packages and agents

| WP | Owner | Files |
|---|---|---|
| Contracts and pure domain | AI Lead (+ `architect` review once) | `shared/logistics/**` |
| Backend per milestone | `backend-engineer` | `server/**` |
| UI primitives, shell and screens | `ui-engineer` (one writer per screen; AI Lead integrates `GameMenu.tsx`) | `src/logistics/**`, `src/styles/logistics/**`, `src/components/menu/GameMenu.tsx`, `public/logistics/**`, `index.html` (manifest link only) |
| Tests | `qa-engineer` | `tests/unit/logistics/**`, `tests/e2e/logistics/**`, `tests/e2e/visual-palettes.spec.ts` |
| Docs, config, cleanup | AI Lead | `doc/adr/**`, `README.md`, `package.json`, `package-lock.json`, `vite.config.ts`, `src/index.ts`, `src/db/schema.ts` |
| Review | `code-reviewer` per milestone; `safety-auditor` on milestones 1, 5 and final | read-only |

## Dependencies to approve (one `APPROVE DEPENDENCY` message each)

Installed only in `server/` with `npm --prefix server install --save-exact`; `vitest`, `typescript` and `@types/node` are reused from the root.

| Package | Purpose | Alternatives considered | Licence |
|---|---|---|---|
| `hono` | HTTP routing | `node:http` by hand, Express, Fastify | MIT |
| `@hono/node-server` | Run Hono on Node | none (required adapter) | MIT |
| `zod` | Input validation | hand-written validators | MIT |
| `postgres` | PostgreSQL driver | `pg` + `@types/pg` | Unlicense |
| `@electric-sql/pglite` (dev) | In-process PostgreSQL for tests | fake repository (does not test SQL) | Apache-2.0 |

No frontend dependency is planned. If one becomes necessary, it is proposed separately.

## Invariants touched

- 3 (Punto Violeta): the API serves only logistics data, never simulation incidents. Logistics incidents are operational notes, not Punto Violeta cases; the UI says so.
- Logistics clause (CLAUDE.md §8): this plan stores venues as names and addresses, not map geometry, so no delivery slot, route or storage area is placed on the map yet. Warnings mention when a task involves heavy loads (stages, generators, tanks, ballast) that the subsoil check must be run in the simulator. The map link is an idea for later.
- 1, 2, 4, 5: no change to their code. `safety-auditor` confirms.

## Commands the user runs (Claude Code cannot)

- `npm uninstall drizzle-orm drizzle-kit` (root, once).
- `docker compose -f server/docker-compose.yml up -d` → Postgres healthy on port 5433.
- `npm --prefix server run db:migrate` → lists applied migrations.
- `npm --prefix server run db:seed` → prints the five users and one-time passwords.
- `npm --prefix server run dev` → API on `http://localhost:8787`; `/api/health` → `{"status":"ok","database":"ok"}`.
- `npm run dev` (or `npm run dev -- --host` for the phone) → `http://localhost:5173/#logistica`.
- After each milestone: `db:migrate` again; exact expectations in the report.

## Allowed paths

- `shared/logistics/**`
- `server/**`
- `src/logistics/**`
- `src/styles/logistics/**`
- `src/components/menu/GameMenu.tsx`
- `public/logistics/**`
- `index.html`
- `src/index.ts`
- `src/db/schema.ts`
- `tests/unit/logistics/**`
- `tests/e2e/logistics/**`
- `tests/e2e/visual-palettes.spec.ts`
- `doc/adr/**`
- `README.md`
- `package.json`
- `package-lock.json`
- `vite.config.ts`
- `doc/specs/2026-11-25-gestor-logistico.md`
- `doc/specs/2026-11-25-gestor-logistico.log.md`

## Acceptance criteria (the five demo tests from the specification, plus quality)

1. Two events on the same day in different squares, one organization, shared inventory.
2. A tent and a supplier offer registered; recovered after closing the browser; visible from a PC when the server runs.
3. A schedule change detects its overlap; «+15 min» simulated without overwriting the real time; applied only after confirmation.
4. Contact opened by phone / WhatsApp / e-mail after user confirmation.
5. Day close with created and modified records, pending data, incidents and agreed tasks; exported as PDF.
- Root: `npm run lint`, `npx tsc --noEmit -p tsconfig.json`, `npm run test`, `npm run build` equal or better than baseline; the Pages build needs nothing from `server/`.
- Server: `npx tsc --noEmit -p server/tsconfig.json` clean; `npx vitest run --root server` green (migrations from empty DB, seed idempotence, auth, guest read-only, versions and 409, activity log, CORS, each milestone's rules).
- Shared domain: unit tests for delay propagation, overlaps, slack, time zones (winter and summer), search ranking, verification %, report aggregation.
- E2E with mocked API: hub entry, deep link, server states, login, each space's main flow, quick capture, hypothesis, offline outbox; screenshots of key screens in all six palettes, phone and desktop, reviewed.
- Accessibility: keyboard navigation, visible focus, 44 px touch targets, +/− alternative to pinch, contrast in every palette.
- No secrets, passwords or real personal data in the repository; demo data fictitious.

## Verification

Baseline before changes (`oxeye-verification`); per milestone: the checks above, full diff read, screenshots reviewed, `code-reviewer`; `safety-auditor` on milestones 1, 5 and at the end; local commit per milestone with a Spanish title. Nothing is pushed.
