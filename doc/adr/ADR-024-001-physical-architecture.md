# ADR-024-001 · Physical architecture

| Field | Value |
|---|---|
| Status | Propuesto (recommended outcome: *Aprobado con condiciones*) |
| Date | 2026-11-25 |
| Task | OX-02 |
| Spec reference | [ESP] §24.144; INV-003, INV-011, TEC-004, TEC-007; §20.23 |
| Related | [ADR-024-002](ADR-024-002-database.md), [ADR-024-005](ADR-024-005-offline-mode.md), [Data authority map](../architecture/data-authority-map.md) |

## Context

OxEye v0.16.0 is a static single-page application published on GitHub Pages. Verified state (commit `a4f1213`):

- The whole project is one JSON document (`ProjectFile`, `src/types/index.ts:1019`) stored in `localStorage['ojo-de-buey-project-v1']` (`src/db/repository.ts:27`). A copy is written to IndexedDB through Dexie but never read back.
- Sharing between people is done by exporting and e-mailing `Ojo_de_Buey_Proyecto.json` (`src/components/header/Header.tsx:38`). A full-project import replaces the current project (a legacy single-venue file is merged into the current one); only `version: 1` is accepted, and there is no version migration, no conflict detection and no entity identity.
- There are no users, roles, permissions or server-side checks.
- The simulation engine runs in the browser on local data with a scenario seed.

The specification requires that shared commitments are not decided by browser state (TEC-004), that local storage is not the only copy of shared data (TEC-007), that critical operations are authorized on a server (INV-011), and that every authoritative datum has one owner domain (INV-003). The 24/11 meeting states that a shared server depends on available budget.

The specification also warns against over-design (§20.23): this ADR fixes the boundaries that prevent contradictions, not every infrastructure detail.

## Options considered

### A. Browser only, file exchange (no server)

Keep the current model. Improve it with stable identifiers, format versioning and explicit import/merge rules (see the transition strategy in the data authority map).

### B. Single modular backend with a relational database

One deployable service (modular monolith) with one module per owner domain (Identity & Access, Project, Venue & Layout, Inventory, Calendar, Economy, Procurement, Operations centre, Documents, Communications, Simulation registry). One relational database (ADR-024-002). The SPA keeps being served as static files; it calls the backend through an HTTP API. Heavy simulation stays in the browser (ADR-024-004 may later move specific scenarios to worker processes).

### C. Managed backend-as-a-service

A hosted platform providing Postgres, authentication, file storage and server functions (e.g. Supabase). Domain rules are implemented in database policies (row-level security), database functions and/or server functions.

### Comparison

Costs are **estimates, not a budget** (see *Cost estimate* below). Effort is relative.

| Criterion | A. Browser only | B. Modular backend | C. Backend-as-a-service |
|---|---|---|---|
| Monthly infrastructure (estimate) | ≈ 0 € | ≈ 10–60 €/month | ≈ 0 € (free tier, not for production) / ≈ 25–60 USD/month |
| Build effort | Low | High (API, auth, deployment, operations) | Medium (auth and storage provided; rules still to write) |
| Operation effort | None | Medium–high (updates, backups, monitoring, security patches) | Low–medium (provider operates; backups depend on plan) |
| Multi-user / concurrency | No | Yes | Yes |
| Server-side authorization (INV-011) | No | Yes | Yes, if enforced by policies/server functions, not in the SPA |
| Satisfies TEC-004 / TEC-007 | No | Yes | Yes |
| Vendor lock-in | None | Low (standard stack) | Medium (auth, policies, functions are provider-specific) |
| Main risk | Diverging copies; no real coordination; data loss in one browser (KI-07) | Team capacity to build and operate; cost of ownership | Business rules leaking into the browser; lock-in; plan limits |
| Personal data (GDPR, Punto Violeta) | Stays on each device; no central control | Full control; EU hosting choice | Depends on provider region and DPA; EU region must be chosen |

### OX tasks blocked or limited per option

`Blocked` = cannot meet its card's target. `Limited` = only a single-user/local version is possible. Tasks not listed are not materially affected by the option.

| OX | A. Browser only | B. Modular backend | C. Backend-as-a-service |
|---|---|---|---|
| OX-03 Users, roles, projects | **Blocked** (no identity or server checks; local profiles only) | — | — |
| OX-05 Inventory and reservations | **Limited** (reservations stay drafts; no concurrent conflict detection) | — | — |
| OX-08 Reconciliation with audit | Limited (local audit log only) | — | — |
| OX-09 Supplier quotes | Limited (single user) | — | — |
| OX-11 Mobile work orders | **Blocked** for tokens; static printable fallback only | — | Limited (token logic in server functions) |
| OX-13 Real incidents | **Limited** (one device; no shared operations centre) | — | — |
| OX-14 Documents | **Limited** (references/links; no shared storage or permissions) | — | — |
| OX-15 Communications with status | **Blocked** for sending/receipts; drafts and `mailto:` only | — | Limited (depends on provider functions; ADR-024-006) |
| OX-19 Learning from past events | Limited (only events available in that browser/file) | — | — |
| OX-20 Context and profiles | Limited (no real roles) | — | — |
| OX-21 Shared persistence | **Blocked**; plan B only (versioned file, backup by export) | — | — |
| OX-04, 06, 07, 10, 12, 16, 17, 18, 22 | Single-user versions possible | — | — |

### Cost estimate (indicative, consulted 2026-11-25)

All figures are **estimates** from public price pages and secondary sources, excluding VAT and personnel time. Several sources disagree (e.g. Hetzner raised prices in 2026; Neon is changing its plan model). They must be re-checked against the providers' official pages before any budget request.

| Option | Assumed components | Estimate |
|---|---|---|
| A | GitHub Pages (current) | ≈ 0 €/month |
| B (self-managed) | 1 small EU VPS (2 vCPU / 4 GB, ≈ 4–7 €/month at Hetzner, plus ≈ 0.50 € IPv4) running API + PostgreSQL; off-site backups (≈ 1–5 €/month); domain (≈ 1 €/month) | ≈ 10–25 €/month |
| B (managed DB) | Managed PostgreSQL in the EU (e.g. Scaleway, billed hourly plus storage at ≈ 0.10–0.15 €/GB-month and backups at ≈ 0.03 €/GB-month) + small app host | ≈ 20–60 €/month |
| C | Supabase Pro (25 USD/month per organization, includes 10 USD compute credit = one Micro instance); larger compute adds ≈ 5–50 USD/month. Free tier exists but is not suitable for production | ≈ 25–60 USD/month |
| C (DB only alternative) | Neon pay-per-use Postgres (≈ 0.106 USD per compute-hour, ≈ 0.35 USD/GB-month); still needs an API/auth layer | few USD/month + app host |

The dominant cost of B and C is not infrastructure but development and operation time, which this estimate does not quantify.

Sources: [Supabase pricing](https://supabase.com/pricing), [Supabase compute usage](https://supabase.com/docs/guides/platform/manage-your-usage/compute), [Hetzner new CX plans](https://www.hetzner.com/pressroom/new-cx-plans), [Hetzner 2026 pricing (bitdoze)](https://www.bitdoze.com/hetzner-cloud-cost-optimized-plans/), [Scaleway managed databases pricing](https://www.scaleway.com/en/pricing/managed-databases-pricing/), [Neon pricing](https://neon.com/pricing).

## Decision (recommended)

1. **Approve the logical architecture now:** option **B**, a single modular backend whose modules match the owner domains of the [data authority map](../architecture/data-authority-map.md). Each domain owns its data and exposes it through its module; no module writes another domain's tables.
2. **Keep the physical infrastructure conditional on budget.** No provider is contracted by this ADR.
3. **Option C is acceptable as the physical implementation of B** if, and only if:
   - authorization and commitment rules run on the server side (database policies or server functions), never only in the SPA;
   - the schema is plain PostgreSQL and data can be exported without the provider;
   - an EU region is used and a data-processing agreement is in place.
4. **Option A is the plan B**, not the target: it is what the pilot uses while there is no server budget (see the data authority map, §Plan B).
5. Independently of the option, the **simulation engine keeps running in the browser on local data** with the scenario seed. A server may store simulation snapshots and run records but is never required to run a simulation.
6. The SPA remains deployable as static files (GitHub Pages or equivalent).

## Consequences

- OX-03, OX-05, OX-11, OX-13, OX-14, OX-15 and OX-21 can be designed against domain modules now and implemented in local mode first, with the same identifiers and states.
- Code organisation must start separating domains in the client too (repositories per domain instead of one `ProjectFile` writer), so that moving the authority to a server changes the repository implementation, not the UI.
- Until a server exists, every screen showing shared-looking data must make clear that it is local (honest save state, OX-20 / KI-07).
- Secrets for external services (mail, storage, maps keys with write rights) never go into SPA code or exports (INTG-009); they require the backend. In plan B, features needing secrets stay disabled.

## Conditions and open points

- Budget availability (24/11 meeting). Trigger to revisit: budget approved, or a pilot requirement that needs two people editing the same event.
- ADR-024-004 (simulation execution) may add worker processes; not decided here.
- ADR-024-006 (integrations) decides mail/storage providers.

## Decision record

| Date | Status | Decided by | Motive |
|---|---|---|---|
| 2026-11-25 | Propuesto | AI Lead (draft) | OX-02 deliverable; awaiting product direction |
