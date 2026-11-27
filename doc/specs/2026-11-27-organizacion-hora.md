# Organización · cleaner card, «use the proposal», and reference time

- Slug: `organizacion-hora`
- Branch: `feat/organizacion-hora` (created from `feat/cabecera-oxeye` at `47767c1`)
- Size: feature in one domain (Gestor logístico), small server change, no migration.

## Goal and intended experience

1. The sidebar «Organización» card shows only the label and the name (and the chevron). The acronym lives only inside the sheet.
2. In the sheet, next to the acronym, a button **«Usar la propuesta (SCLL)»** puts the acronym back to the one proposed from the name. It is enabled only when the acronym in use (or the one being typed) differs from the proposal. In view mode it saves straight away (with the same version check and toast); while editing it fills the field.
3. «Hora de referencia» becomes editable for members: a two-option segmented control **Hora de Canarias** (`Atlantic/Canary`, default) / **Hora peninsular** (`Europe/Madrid`). Guests read it. Saved with optimistic concurrency like the acronym.

## What the reference time means (product rule)

Events and tasks already store their own time zone, copied from the organization when they are created. So the organization's reference time is **the zone for new events and tasks**; existing ones keep theirs (their instants never move). Where a record's zone differs from the organization's, the app already shows its zone note («hora de Canarias»). The sheet says this in one line under the control, so nobody expects old tasks to shift.

## Approach

- `src/logistics/shell/OrgSelector.tsx`: drop the acronym line (both single and multi-org variants; in the multi-org variant the open button reads «Detalles»).
- `src/logistics/shell/OrganizationSheet.tsx`: «Usar la propuesta» button; «Hora de referencia» segmented control with its own save path; plain-language `?` help.
- `src/logistics/lib/format.ts`: `zoneNote`/`zoneHoursNote` say «hora peninsular» for `Europe/Madrid`.
- `shared/logistics/**`: `OrganizationInput` gains optional `timezone` limited to the two zones (one shared constant list).
- `server/src/organizations/**`: route schema accepts `timezone` from that list; service updates it with the version check and records it in the change history like the acronym; new events/tasks keep using `org.timezone` (already the case).
- Tests: server unit tests for the update (valid zone, invalid zone rejected, stale version 409); e2e for the card without acronym, the proposal button (disabled/enabled, saves), and the time control; mock API updated.

## Invariants

None touched (no routes, loads, demand or privacy).

## Allowed paths

- `src/logistics/shell/**`
- `src/logistics/lib/format.ts`
- `src/logistics/store/**`
- `src/logistics/api/**`
- `src/styles/logistics/**`
- `shared/logistics/**`
- `server/src/organizations/**`
- `server/src/records/schemas.ts`
- `server/tests/**`
- `tests/e2e/logistics/**`
- `tests/unit/logistics/**`
- `doc/specs/2026-11-27-organizacion-hora.log.md`

## Acceptance criteria

- The sidebar card shows no acronym.
- «Usar la propuesta» is disabled when the acronym equals the proposal, enabled otherwise, and restores it.
- Default «Hora de Canarias»; switching to «Hora peninsular» saves, survives reload, and new events/tasks use it; existing ones keep their zone.
- A stale save is rejected (409) and the sheet shows the other person's value.

## Verification

Server tsc and tests, front tsc, lint, unit, build, e2e for the organization sheet and related flows, screenshots of the sheet in the six palettes.
