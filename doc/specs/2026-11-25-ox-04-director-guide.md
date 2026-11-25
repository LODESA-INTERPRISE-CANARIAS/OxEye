# OX-04 · Director guide (non-technical)

- Date: 2026-11-25
- Slug: `ox-04-director-guide`
- Branch: `chore/ox-04-director-guide` (from `feat/ox-04-recinto-distribuciones`, commit `558296c`)
- Classification: TASK (DOCS REQUEST to create a repository document)

## Goal

One Markdown guide for the project director, who has no programming background, explaining:

1. What OX-04 changed, in plain language (Recinto, Distribución, fases, estados, «Editar recinto» / «Editar distribución», «Confirmar como vigente»).
2. How each requirement and acceptance criterion of the OX-04 feature card maps to what was built, including deviations and open product decisions.
3. How to test it step by step in the browser, with what should be seen at each step, and what to report back.

## Approach

- Written in Spanish (audience: project director; UI terminology in Spanish), no code or file paths beyond what is needed to locate the branch.
- Sources: the approved plan `doc/specs/2026-11-25-ox-04-recinto-distribuciones.md` (§1, §4, §10, §12), the implementation on `feat/ox-04-recinto-distribuciones` and the verified results already reported (unit 224/224, e2e 21 passed / 3 skipped, lint 0 errors, build OK).
- Includes the non-certification statement (indicative review; 500 kg/m² indicative), known limitations (header at 1280 px from OX-03, copy/paste gating, event-phase-only review, local mode) and the four pending product decisions.
- Test walkthrough uses only UI actions (no terminal), on a desktop browser wider than 1200 px.
- No application code changes.

## Acceptance criteria

- [ ] A non-technical reader can follow the test steps without help.
- [ ] Every card requirement / acceptance criterion appears with its status.
- [ ] Limitations and pending decisions are stated plainly; nothing presented as certification.

## Allowed paths

- `doc/guides/2026-11-25-ox-04-guia-direccion.md`
- `doc/specs/2026-11-25-ox-04-director-guide.md`
