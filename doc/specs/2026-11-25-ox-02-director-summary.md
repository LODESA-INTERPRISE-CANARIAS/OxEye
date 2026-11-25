# OX-02 · Non-technical summary for project direction

- Date: 2026-11-25
- Slug: `ox-02-director-summary`
- Branch: `feat/ox-02`
- Classification: TASK (documentation only)
- Requested by: development engineer, for the project director.

## Objective

Store in the repository the non-technical summary of the OX-02 decisions (ADR-024-001, ADR-024-002, ADR-024-005 and the data authority map), already reviewed by the user in chat, so the project director can read it next to the technical documents.

## Scope

- Copy the already drafted summary from the session scratchpad to `doc/architecture/ox-02-resumen-para-direccion.md`, unchanged.
- Add one link to it from `doc/adr/README.md` (companion documents line).

Exclusions: no change to the ADRs or the authority map (the self-hosted option is recorded only as a note in the summary; updating the ADRs needs its own plan after the director's decision); no code, tests or configuration.

## Decisions taken by the AI Lead

- The summary is written in **Spanish**, as an exception to the English documentation rule, because its audience is the project director.
- It lives in `doc/architecture/` next to the data authority map.

## Invariants

Documentation only. The summary keeps Punto Violeta as non-public and its central storage as a pending decision, labels costs as estimates, and states that simulation runs locally. No certification claims.

## Verification

- `git status` shows only the allowed paths.
- Link from `doc/adr/README.md` resolves to the new file.
- Local commit on `feat/ox-02`: `DOC: Resumen de OX-02 para dirección del proyecto`. No push, no merge.

## Acceptance criteria

- [ ] File exists at the path below with the reviewed content.
- [ ] Linked from the ADR register.
- [ ] Only allowed paths changed.

## Allowed paths

- `doc/architecture/ox-02-resumen-para-direccion.md`
- `doc/adr/README.md`
- `doc/specs/2026-11-25-ox-02-director-summary.md`
