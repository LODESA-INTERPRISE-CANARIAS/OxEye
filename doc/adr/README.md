# Architecture Decision Records (ADR)

Register of OxEye architecture decisions. Codes follow the specification (`doc/CHANGES-PLAN.md`, Part XI, §24.143–§24.152).

## Status legend

| Status | Meaning |
|---|---|
| `Propuesto` | Drafted with a recommendation; awaiting product direction. Not binding. |
| `Aprobado` | Accepted by product direction. Binding for later OX tasks. |
| `Aprobado con condiciones` | Accepted; parts of it depend on a stated condition (e.g. budget). |
| `Rechazado` | Rejected, with motive. Kept for traceability. |
| `Sustituido` | Replaced by a later ADR (linked). |

Only product direction changes a status from `Propuesto`. Each change records date, who decided and the motive in the ADR's *Decision record* section.

## Register

| Code | Title | Status | Task | File |
|---|---|---|---|---|
| ADR-024-001 | Physical architecture | Propuesto | OX-02 | [ADR-024-001-physical-architecture.md](ADR-024-001-physical-architecture.md) |
| ADR-024-002 | Authoritative database | Propuesto | OX-02 | [ADR-024-002-database.md](ADR-024-002-database.md) |
| ADR-024-003 | Cartography engine and representation | Not drafted | — | — |
| ADR-024-004 | Simulation execution | Not drafted | — | — |
| ADR-024-005 | Offline mode | Propuesto | OX-02 | [ADR-024-005-offline-mode.md](ADR-024-005-offline-mode.md) |
| ADR-024-006 | Integrations | Not drafted | — | — |
| ADR-024-007 | Pilot scope | Not drafted | OX-23 | — |
| ADR-024-008 | Territorial data | Not drafted | — | — |
| ADR-024-009 | Roles and team | Not drafted | OX-24 | — |

Companion document: [Data authority map](../architecture/data-authority-map.md) (owner domain per entity, transition strategy, plan B).

## Template

```markdown
# ADR-XXX-YYY · Title

| Field | Value |
|---|---|
| Status | Propuesto |
| Date | YYYY-MM-DD |
| Task | OX-NN |
| Spec reference | §… |

## Context
## Options considered
## Decision (recommended)
## Consequences
## Conditions and open points
## Decision record
| Date | Status | Decided by | Motive |
```
