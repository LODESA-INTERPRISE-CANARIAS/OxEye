# Organización · hora de referencia · execution log

## Decisions

- Contract first: `ORGANIZATION_TIMEZONES` and `OrganizationTimezone` in `shared/logistics/contracts.ts`; server (backend-engineer) and UI built on it in parallel.
- Multi-organization variant of the card: the open button reads «Detalles» instead of the acronym.
- «Usar la propuesta» in view mode saves `acronym: null` at once (stored null = proposal); while editing it only fills the field. Disabled when the acronym in use equals the proposal; hidden for guests.
- The reference time saves on choice (no separate «Guardar»), with a toast saying it applies to new events and tasks; conflicts show the other person's value.
- `zoneNote`/`zoneHoursNote` read «hora peninsular» / «Horas peninsulares» for `Europe/Madrid`.
- Server keeps existing records' zones. Two places use the organization's current zone, accepted as is: a task unlinked from its event takes the org zone; the opening-hours check of a move uses the org zone (hours are local to the place).
- The `…/changes` e2e reads the refreshed acronym in the sheet, since the card no longer shows it.

## Scope extensions
