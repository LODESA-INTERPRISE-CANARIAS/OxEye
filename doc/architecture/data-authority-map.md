# Data authority map

| Field | Value |
|---|---|
| Date | 2026-11-25 |
| Task | OX-02 |
| Status | Propuesto (follows the status of [ADR-024-001](../adr/ADR-024-001-physical-architecture.md)) |
| Spec reference | INV-002, INV-003, INV-006, INV-009, INV-018, TEC-004, TEC-006, TEC-007, INTG-009 |

Purpose: state, for every main entity, **which single domain owns it**, who may read it and who may modify it, so that map, materials, dates and costs consult the same data instead of copies. Other domains reference an entity by its identifier; they never keep an independent editable copy (INV-003).

## 1. Domains

| Domain | Responsibility |
|---|---|
| Identity & Access | Organizations, users, memberships, roles, invitations |
| Project | Projects and events (editions), event days and time zone |
| Venue & Layout | Reusable venues, versioned layouts per event, installations placed on them |
| Inventory | Resource models, physical units, needs and reservations |
| Calendar | Activities and tasks over time, dependencies |
| Economy | Budget items (estimates and their states) |
| Procurement | Suppliers and their offers |
| Operations centre | Real incidents |
| Documents | Documents, versions, evidence |
| Communications | Instructions and messages with delivery states |
| Simulation | Simulation runs and their frozen snapshots |

## 2. Roles (provisional)

Roles are defined in OX-03. This map uses provisional role groups:

- **Admin org** — organization administrator.
- **Dirección** — event direction / product owner of an event.
- **Coordinación** — technical coordination (layout, calendar, safety).
- **Responsable de área** — logistics, inventory, production, economy, as assigned.
- **Operaciones** — operations centre and safety staff on duty.
- **Personal de campo** — workers receiving work orders.
- **Proveedor** — external supplier, restricted to its own requests and offers.
- **Público** — public-facing views; never sees sensitive or personal data.

## 3. Authority table

"Today" describes v0.16.0 (commit `a4f1213`); every entity currently lives inside the single `ProjectFile` JSON in `localStorage`.

| # | Entity | Owner domain | Read | Modify | Today (v0.16.0) | Sensitivity |
|---|---|---|---|---|---|---|
| 1 | Organización | Identity & Access | Its members | Admin org | Does not exist | Low |
| 2 | Usuario | Identity & Access | Self; Admin org (members of its org) | Self (profile); Admin org (membership, roles) | Does not exist | Personal data |
| 3 | Proyecto | Project | Members of the project | Dirección; Admin org | Implicit: one `ProjectFile` per browser, no id | Low |
| 4 | Evento | Project | Members of the project | Dirección | Implicit in each `Scene` (`title`, `eventDate`, `startDate`, `endDate`, `eventDays`), keyed by venue | Low |
| 5 | Recinto | Venue & Layout | Members; Público (outline only) | Coordinación | `ProjectFile.maps[venue]` + `Scene.boundary`, `subsoil` mixed with the layout | Low |
| 6 | Distribución | Venue & Layout | Members; Público (published version only) | Coordinación | The `Scene` itself (fences, passages, reserves, routes, entrances); includes `demandConfig` (`EventDemandConfig`) | Low. The Punto Violeta **installation** (a service point) is layout data; whether its location is shown in public views is an **open product decision** (KI-03). It is distinct from sensitive **incident** data (row 17) |
| 7 | Instalación | Venue & Layout | Members | Coordinación; Responsable de área (its area) | `Scene.infrastructure`, booths, entrances, `pendingStock` | Low |
| 8 | Modelo de recurso | Inventory | Members | Responsable de área (inventory) | Drawing catalogue (`src/data/catalog.ts`, `inventory.ts`); ballast data in `ballast.ts` | Low |
| 9 | Unidad física | Inventory | Members | Responsable de área (inventory) | Does not exist | Low |
| 10 | Necesidad | Inventory | Members | Derived from Instalación by Inventory; Responsable de área may adjust | Does not exist | Low |
| 11 | Reserva | Inventory | Members | Responsable de área (inventory); **confirmation server-only** | Does not exist | Low |
| 12 | Actividad | Calendar | Members; Público (published programme) | Coordinación; Dirección | `Scene.programme`, `customActivities`, `workDays`, `shiftDays` | Low |
| 13 | Tarea | Calendar | Members; assignee (Personal de campo) | Coordinación; assignee (own status only) | Does not exist (logistics sequencing is simulated) | Low |
| 14 | Partida económica | Economy | Dirección; Responsable de área (economy) | Responsable de área (economy); Dirección (approval) | `activityPrices`, `programmeOptions.budget`, shift wage parameters | Commercial |
| 15 | Proveedor | Procurement | Members | Responsable de área; Dirección | `Scene.companies`, `Scene.contacts` (with e-mail/phone) | Personal data (contacts) |
| 16 | Oferta | Procurement | Dirección; Responsable de área; the offering Proveedor (own only) | Proveedor (own, while open); Responsable de área (selection) | Does not exist | Commercial |
| 17 | Incidencia (real) | Operations centre | Operaciones; Dirección; **sensitive ones only to authorised Operaciones**; Público never | Operaciones | Does not exist. Only **simulated** incidents exist (`incident-center.ts`, `response-model.ts`); they are runtime state, **but run summaries persisted in `Scene` carry their type and notes** (see row 20) | **Punto Violeta (`sensitive: true`, category `violet_point`)** |
| 18 | Documento | Documents | Per-document permissions | Uploader; Coordinación | Does not exist (only exports) | Varies |
| 19 | Comunicación | Communications | Sender; recipients (own) | Sender (until sent); system (delivery states) | Does not exist (`mailto:`/WhatsApp links only) | Personal data |
| 20 | Simulación | Simulation | Members | Coordinación (run); nobody edits a finished run | Run summaries persisted in `Scene`: `lastSessionReview` (`src/App.tsx:436`, includes `emergencies[]` with incident `type` and `reason` note — KI-04), `safetyHistory` (`App.tsx:494`), `lastAudit` (`ComparisonDialog.tsx:226`), `reviewMemory`, `directorLog`, `safetyReview`. `simulationHistory` has no writer in `src/` (legacy). Dexie `simulationRuns` unused | **Can contain Punto Violeta-derived data** (`violet_point` entries and their notes) |

Check: 20 entities, 20 rows, exactly one owner domain each.

### Rules derived from the table

1. **References, not copies.** E.g. Economy references Instalación and Reserva ids; it does not copy quantities. Calendar references Distribución and Reserva; it does not copy positions.
2. **Derived values are recomputed, not stored as a second truth.** Need quantities derive from installations; costs derive from needs/offers. If a derived value is cached, it records the source version it came from.
3. **`EventDemandConfig` is the precedent.** It remains the single source of demand configuration, owned by Venue & Layout as part of the Distribución of an event; the Simulation domain and the services calculator read it, never fork it. Today `syncDemandConfigToScene` (`src/engine/planning/event-demand.ts`) writes derived mirrors into `scene.demandInputs`, `scene.attendance` and `scene.base.{hours,start,stay,arrivals}`; these are derived views, never inputs. Three writers bypass the config (KI-06) and the `demandInputs` mirror is invalid after reload (KI-28). `demandVariants` hold full `EventDemandConfig` copies and are **read-only snapshots** for comparison, not alternative sources. `EventDemandConfig.date` overlaps `Scene.eventDate`; the Evento (Project domain) owns the calendar dates, and the demand config references them (transition step 4).
4. **Simulated vs real.** Simulated incidents belong to Simulation and never become Incidencia (real) without an explicit, separate action (INV-009).
5. **Punto Violeta.** `sensitive: true` data **must be** excluded from public views and exports. This target is **not met today**: the OX-01 audit lists open bypasses (KI-01 `Informe_de_visitantes.json` exports names and notes unfiltered; KI-02 director log; KI-03 public map and print report) and the privacy gate is duplicated in 10+ places (KI-05). Requirements:
   - one shared, tested privacy gate reused by every domain module, instead of re-implementing the rule per domain;
   - KI-01..03 fixed **before** any central storage or upload of project data;
   - central storage of sensitive records requires an explicit privacy decision (INV-018) — pending; until then they are not persisted centrally (ADR-024-005).
6. **Secrets** are never part of any entity exported to the browser or to files (INTG-009).
7. **Organization isolation.** Every entity except Usuario belongs to exactly one Organización, directly or through Proyecto (INV-002).

## 4. Transition strategy (local mode → server)

1. **Stable identifiers first.** Every entity gets a UUID. Legacy items without id receive a deterministic id derived from `(project import id, venue key, collection, index)` at import, so importing the same file twice yields the same ids and no duplicates (INV-019).
2. **Format versioning.** Introduce `ProjectFile.version: 2` with an explicit migration chain `v1 → v2` in one module. v1 import keeps working; unknown future versions are rejected with a clear message, never silently replaced (fixes the KI-07 pattern).
3. **Mapping of a v1 file.** One `ProjectFile` → one Proyecto; each venue scene with content → one Recinto + one Evento + one Distribución (version 1). Contacts/companies → Proveedor. Programme → Actividad. `lastSessionReview`, `safetyHistory`, `lastAudit` → Simulación records (read-only); legacy `simulationHistory` is migrated only if non-empty.
4. **Time.** Existing free-text dates are interpreted in `Atlantic/Canary` and stored as instants plus the event time zone (TEC-006). `Scene.eventDate`/`startDate`/`endDate` become the Evento dates (authoritative); `EventDemandConfig.date` is reconciled to reference them, and a mismatch is flagged. Ambiguous values are flagged, not guessed.
5. **Privacy filter on migration and upload.** Before any v1 → v2 migration result is uploaded (step 7), Simulación records are filtered with the shared privacy gate (rule 5): `lastSessionReview.emergencies` entries of category `violet_point` and `directorLog` lines naming them are reduced to counts (subject to the minimum-count threshold of the privacy decision) or removed. No new ad-hoc predicate is written for this.
6. **Per-domain repositories in the client.** Replace the single `saveProjectToStorage` writer with repositories per domain. In plan B they write to IndexedDB; with a server they call the API. UI code does not change when the backend arrives.
7. **Authority switch.** When the server exists, a local project is *uploaded* once (import into a shared event), after the privacy filter of step 5; from then on the server copy is authoritative and the browser keeps cache and drafts (ADR-024-005). The upload is idempotent.
8. **Simulation stays local.** The engine keeps reading a local snapshot and the scenario seed; nothing in the transition makes simulation depend on the network.

## 5. Plan B — pilot without server budget

What can be demonstrated honestly in local mode (option A of ADR-024-001):

| Area | Demonstrable locally | Limit that must be stated |
|---|---|---|
| Map, venue, layouts | Yes | Single editor; sharing by file |
| Inventory: models, units, needs, coverage/deficit | Yes | Reservations stay **drafts**; no concurrent-reservation guarantee |
| Calendar with dependencies | Yes | No shared notifications |
| Budget estimates | Yes | Estimates only; no commitments, invoices or payments |
| Supplier offers | Yes (entered manually) | No supplier portal |
| Real incident capture | Single-device demo only | Not an operations centre; Punto Violeta stays local |
| Documents | References/links | No shared storage or permissions |
| Communications | Drafts, `mailto:` | No sending status or confirmation |
| Simulation and layout comparison | Yes (fully) | Indicative results, not predictions |
| Users and roles | No | Every user of a browser has full access |
| Persistence | Versioned file export/import; local backups by export | One browser's storage is not a backup; data loss if the browser is cleared |

Mandatory honesty rules in plan B:

- The UI states "Modo local: los datos solo están en este navegador" (or equivalent) wherever data looks shared.
- No screen, export or presentation claims multi-user coordination, confirmed reservations or delivered communications.
- The demo uses a fixture (OX-22), not real personal data.

Validation of this plan B by product direction is pending (OX-02 acceptance criterion).

## 6. Cross-check OX-03 … OX-22

Each task finds the owner of the data it uses in §3.

| OX | Data used | Owner domain(s) | Writes as owner |
|---|---|---|---|
| OX-03 Users, roles, projects | Organización, Usuario, Proyecto, Evento | Identity & Access; Project | Yes (both) |
| OX-04 Venue vs layout | Recinto, Distribución, Instalación | Venue & Layout | Yes |
| OX-05 Real inventory | Modelo de recurso, Unidad física, Necesidad, Reserva; reads Instalación, Evento | Inventory; reads Venue & Layout, Project | Yes (Inventory) |
| OX-06 Calendar | Actividad, Tarea; reads Evento (time zone), Reserva | Calendar; reads Project, Inventory | Yes (Calendar) |
| OX-07 Budget from plan | Partida económica; reads Instalación, Necesidad, Reserva, Actividad | Economy; reads Venue & Layout, Inventory, Calendar | Yes (Economy) |
| OX-08 Two-way reconciliation | Proposes changes to Distribución, Necesidad, Actividad, Partida | Each change applied by its owner domain | No own entity; orchestrates owners |
| OX-09 Supplier quotes | Proveedor, Oferta; reads Necesidad, Partida | Procurement; reads Inventory, Economy | Yes (Procurement) |
| OX-10 Real deliveries | Tarea/Actividad (delivery), Reserva, Instalación (zones) | Calendar; reads Inventory, Venue & Layout | Yes (Calendar) — delivery is a typed Actividad |
| OX-11 Mobile work orders | Tarea; reads Distribución, Usuario | Calendar; reads Venue & Layout, Identity & Access | Yes (Calendar, own status) |
| OX-12 Technical production | Instalación (stage, light, sound), Necesidad, Actividad, Documento (rider) | Venue & Layout; Inventory; Calendar; Documents | Each part by its owner |
| OX-13 Real incidents | Incidencia (real); reads Distribución, Usuario | Operations centre | Yes |
| OX-14 Documents | Documento; references any entity | Documents | Yes |
| OX-15 Communications | Comunicación; reads Usuario, Tarea, Proveedor | Communications | Yes |
| OX-16 Versioned simulation | Simulación; reads snapshot of Distribución (incl. `EventDemandConfig`) | Simulation | Yes (run records only) |
| OX-17 Virtual emergency response | Simulación; reads Distribución (routes A/B/C) | Simulation | Yes (run records only) |
| OX-18 Compare layouts | Simulación; reads several Distribución versions, Partida | Simulation; reads Venue & Layout, Economy | Yes (run records only) |
| OX-19 Learning from past events | Reads Evento (closed), Actividad, Partida, Incidencia (aggregate only for sensitive), Simulación | Project (event close snapshot) | Yes (event close) |
| OX-20 UI per profile | Reads Usuario roles; save state of every domain | Identity & Access | No (consumer) |
| OX-21 Shared persistence | All entities | Each owner domain; infrastructure only | No (provides storage) |
| OX-22 End-to-end test | Fixture across all domains | Each owner domain | No (fixture) |

No OX task requires an entity without an owner, and no entity has two owners.
