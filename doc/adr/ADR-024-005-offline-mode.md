# ADR-024-005 · Offline mode

| Field | Value |
|---|---|
| Status | Aprobado (2026-11-25) |
| Date | 2026-11-25 |
| Task | OX-02 |
| Spec reference | [ESP] §24.148; TEC-004, TEC-007, INV-004, INV-009, INV-019 |
| Related | [ADR-024-001](ADR-024-001-physical-architecture.md), [ADR-024-002](ADR-024-002-database.md), [Data authority map](../architecture/data-authority-map.md) |

## Context

Today OxEye is always "offline": everything happens in one browser and is shared by file. Once a server exists (ADR-024-001), event teams will still work in places with poor coverage (on site at Plaza del Cristo, mounting days). The specification recommends allowing consultation and compatible drafts offline, but no shared confirmations that need central validation.

## Decision

### Principles

1. **Offline = read, draft, simulate, export.** No shared commitment is created offline.
2. Every offline change is a **draft** with a `draft` state, the author, a local timestamp and the **base version** of the entity it started from.
3. On reconnect, drafts are **submitted**, not merged silently: the server applies them only if the base version still matches; otherwise the user sees a conflict and decides (INV-004).
4. Each submission carries an idempotency key, so retries after a dropped connection do not duplicate (INV-019).
5. The UI always shows whether data is server-confirmed, local draft or stale cache (OX-20 honest save state).
6. The **simulation engine runs fully offline** on local data with the scenario seed; results are never written into operational state without an explicit, separate step (INV-009).

### Operation policy

| Operation | Offline | Requires server | Notes |
|---|---|---|---|
| Consult map, layout, calendar, inventory, budget, documents already cached | ✅ | | Shows "last synchronised at …" |
| Edit layout / place installations | ✅ draft | Publish a layout version | |
| Create a need (inventory) | ✅ draft | | |
| **Confirm a reservation** of a physical unit | | ✅ | Overlap check must be central (INV-005) |
| Create/edit activities and tasks | ✅ draft | Change a confirmed activity others depend on | Propagation runs on server (OX-06) |
| Mark own task started/finished (work order) | ✅ queued | Confirmation | Stored with local timestamp + time zone |
| Edit budget estimates | ✅ draft | Turn an estimate into commitment, invoice or payment | INV-007 |
| Select a supplier offer | | ✅ | |
| Prepare a communication | ✅ draft | **Send**, record delivery/confirmation | INV-010 |
| Capture a real incident | ✅ queued (quick capture) | Assign, verify, close | Punto Violeta records are never queued for the server: they stay on the capturing device (see below) |
| Upload a document | ✅ queued file | Mark requirement as fulfilled | INV-008 |
| Change users, roles, permissions, invitations | | ✅ | INV-011 |
| Run a simulation; compare layouts | ✅ | Store a run record centrally | |
| Export JSON/CSV of data the user may see | ✅ | | Public exports never include sensitive data |
| Import a v1 project JSON | ✅ (local) | Import into a shared event | Transition strategy |

### Punto Violeta (online and offline)

- **Decided (2026-11-25):** sensitive records (`sensitive: true`) are kept **only on the device of whoever records them**, online or offline ("el lugar más privado posible"). They are never submitted to the server, never shown in public views and never included in exports.
- Whether anonymous **aggregate counts** may reach the server remains **open**; default: they are not shared. If allowed later, a minimum-count threshold must prevent small counts from identifying individuals.
- The privacy rule is applied through one shared, tested gate (see the data authority map, rule 5); known bypasses KI-01..03 must be fixed before any project data is uploaded to the server.

## Consequences

- Client storage (Dexie) gains a draft/outbox role; it is never authoritative for shared data (TEC-007).
- Domain models need explicit states (`draft`, `submitted`, `confirmed`, `rejected`) for operations that require the server.
- Local-only operation is not an acceptable pilot mode (ADR-024-001). Until the server (OX-21) exists, and whenever the connection is lost, every shared-requiring operation stays at `draft`; the UI must say so instead of pretending confirmation.

## Conditions and open points

- Exact list of operational flows for on-site work comes from OX-11 and OX-13 (spec: "pendiente de selección de flujos operativos").
- Anonymous aggregate counts of Punto Violeta on the server (default: not shared).

## Decision record

| Date | Status | Decided by | Motive |
|---|---|---|---|
| 2026-11-25 | Propuesto | AI Lead (draft) | OX-02 deliverable; awaiting product direction |
| 2026-11-25 | Aprobado | Development engineer (design decision) | Operation policy approved as is; Punto Violeta records stay only on the recording device |
