# OX-02 follow-up · Record the design decisions in the OX-02 documents

- Date: 2026-11-25
- Slug: `ox-02-design-decisions`
- Branch: `chore/ox-02-design-decisions` (from `main` @ `dbc6714`)
- Classification: TASK (documentation only)
- Source: design decisions taken by the user (development engineer) on 2026-11-25, written into `doc/architecture/ox-02-resumen-para-direccion.md` §9 (currently uncommitted in the working tree).

## 1. Objective

Update the OX-02 documents so they reflect the decisions actually taken, instead of the recommendations and open questions they contain today, and commit the user's answers in the summary.

## 2. Decisions to record (verbatim source: summary §9)

| # | Question | Decision |
|---|---|---|
| U1 | Organization model (single owner per datum) and option B | **Approved: option B** (single modular backend) |
| U2 | Own hardware as server | **Yes.** Dedicated computer; maintained by the team's systems engineer; backups on an external hard drive |
| U3 | Punto Violeta storage | **Only on the device of whoever records it** ("el lugar más privado posible") |
| U4 | Plan B (local-only pilot) acceptable | **No** |

## 3. Current state (verified)

- ADR-024-001, ADR-024-002, ADR-024-005 and the data authority map are `Propuesto` (`doc/adr/README.md` register).
- ADR-024-001 describes self-managed B only as a rented VPS, makes infrastructure conditional on budget, and states "Option A is the plan B … what the pilot uses" (Decision 4).
- ADR-024-002 §8 assumes daily backups with 7-day retention without location; §12 and ADR-024-005 leave Punto Violeta central storage as an open privacy decision.
- Data authority map §5 describes plan B as the pilot fallback; rule 5 and row 17 keep central Punto Violeta storage pending.
- The summary §4 note says the technical documents still describe B as a rented server.

## 4. Backend ownership (research result, no implementation here)

The OX-01 audit gap matrix (`doc/audit/2026-11-25-ox-01-audit.md` §10.2; the cards are not stored in the repository) assigns the server to **OX-21 · Shared persistence, recovery and protection**: "Implementation of the OX-02 choice; optimistic versioning; atomic multi-entity writes; backups with tested restore; change history; 0.16.0 JSON import without duplicates", depending on OX-02 and OX-03. Other tasks consume the server but do not build it: OX-11 (expiring tokens), OX-14 (document storage), OX-15 (real sending). Therefore no backend is designed or built in this task; the documents will name OX-21 as the owner, including OX-03's server-side criteria left open (server permission rejection, organization isolation).

## 5. Changes

1. **ADR-024-001** (`doc/adr/ADR-024-001-physical-architecture.md`)
   - Status → `Aprobado con condiciones`; decision record row: 2026-11-25, decided by the user (development engineer), motive U1–U4.
   - Add physical option **B-own**: dedicated team-owned computer (operator: systems engineer) with cost "electricity + connection; hardware already owned" (estimate), and its operational conditions from the summary §4 (always on during mounting/event days, UPS recommended, secure remote access, backups outside the machine).
   - Decision 2–4 rewritten: physical implementation = B-own (rented VPS / option C stay as documented alternatives); option A is **not** an acceptable pilot mode (U4) — it remains only the current development state and the offline/continuity mode of ADR-024-005.
   - Blocked/limited table kept as analysis; add note that, with A rejected, these tasks need OX-21 before the pilot.
   - Conditions and open points: remove "budget"; add open points **for OX-21**: secure remote-access method (VPN/tunnel/reverse proxy with TLS), authentication method (open in OX-03), UPS/power, and the fact that the server is a single machine (availability risk).
2. **ADR-024-002** (`doc/adr/ADR-024-002-database.md`)
   - Status → `Aprobado con condiciones` (§8 Q1: PostgreSQL approved by the user); PostGIS stays deferred to ADR-024-003 as written.
   - Environments: `pilot` runs on the team's dedicated computer.
   - §8 Backups: daily backup to the external hard drive (U2); add the risk that a drive kept next to the server is not off-site and a recommendation (indicative) to rotate or keep a second copy elsewhere; restore drill unchanged (OX-21).
   - §12 Sensitive data: Punto Violeta records are **never** stored in the central database (U3).
   - Decision record row noting the context update.
3. **ADR-024-005** (`doc/adr/ADR-024-005-offline-mode.md`)
   - Punto Violeta section: decided — sensitive records stay only on the capturing device, are never submitted to the server; remove "deleted locally after confirmed submission". Sharing of aggregate counts remains an **open** question (default: not shared) — see §8 Q2.
   - Consequences: replace "In plan B (no server)…" with the U4 position (local mode is offline/continuity, not the pilot).
   - Status → `Aprobado` (§8 Q3); decision record row 2026-11-25, decided by the user.
4. **Data authority map** (`doc/architecture/data-authority-map.md`)
   - Status follows ADR-024-001 (`Aprobado con condiciones`).
   - Row 17 and rule 5: Punto Violeta records not persisted centrally (decided, U3); KI-01..03 still required before any upload of project data.
   - §4 step 5/7: drop "or removed/reduced to counts subject to decision" ambiguity accordingly (sensitive entries are removed before upload; counts only if Q2 allows).
   - §5 Plan B: mark as **rejected for the pilot (U4)**; keep the table as the description of local/offline mode.
   - §6 cross-check: OX-21 row notes it owns the backend and OX-03's open server criteria.
5. **ADR register** (`doc/adr/README.md`): update statuses.
6. **Summary** (`doc/architecture/ox-02-resumen-para-direccion.md`): keep the user's answers verbatim; replace the §4 note ("los documentos técnicos todavía describen…") with a one-line note that the documents were updated on 2026-11-25. Spanish, as before.

Exclusions: no code, tests, configuration or new ADRs; the OX-01 audit and the OX-02 / OX-03 plans stay as historical records; no backend design.

## 6. Invariants

Documentation only. Punto Violeta privacy is strengthened (never central). No certification or guarantee wording; cost figures stay labelled as estimates.

## 7. Verification

- Each of U1–U4 appears in ADR-024-001 / 002 / 005 and the authority map consistently (manual cross-read + grep for "plan B", "Propuesto", "Punto Violeta", "VPS").
- Links in `doc/adr/README.md` resolve.
- `git status` shows only allowed paths; local commit `DOC: Decisiones de diseño de OX-02 (servidor propio, Punto Violeta local)` on the branch. No push, no merge.

## 8. Open questions (defaults applied if not answered)

- Q1. Database engine: is PostgreSQL (ADR-024-002) approved too? **Answered 2026-11-25: yes.**
- Q2. Punto Violeta aggregates: may anonymous counts reach the server (minimum-count threshold)? **Answered: keep the default** — not shared; stays open.
- Q3. Offline policy (ADR-024-005 table): approve as is? **Answered 2026-11-25: approved as is** → ADR-024-005 status `Aprobado`.

## 9. Acceptance criteria

- [ ] U1–U4 recorded in all affected documents, without contradictions.
- [ ] OX-21 named as owner of the backend and of OX-03's open server criteria.
- [ ] User's answers in the summary committed unchanged.
- [ ] Only allowed paths changed.

## Allowed paths

- `doc/specs/2026-11-25-ox-02-design-decisions.md`
- `doc/adr/ADR-024-001-physical-architecture.md`
- `doc/adr/ADR-024-002-database.md`
- `doc/adr/ADR-024-005-offline-mode.md`
- `doc/adr/README.md`
- `doc/architecture/data-authority-map.md`
- `doc/architecture/ox-02-resumen-para-direccion.md`
