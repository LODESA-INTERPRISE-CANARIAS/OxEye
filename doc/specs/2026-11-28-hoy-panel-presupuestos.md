# Gestor logístico · «Presupuestos» panel on Hoy

- Slug: `hoy-panel-presupuestos`
- Branch: `feat/hoy-panel-presupuestos`
- Created from: `feat/gestor-logistico` at `f55e169`
- Size: one domain (budget), UI-led. One read-only server endpoint, no migration, no new dependency, no root file. No hotspot of CLAUDE.md §7 touched.

## Why

The Hoy screen leaves an empty area in the main column, under «Información verificada» and beside «Actividad reciente». Administrators open Hoy every day but today have to open event by event to know where the money stands. This panel fills that space with information they actually need, only for those allowed to see it.

## Goal and intended experience

An administrator opens Hoy and, below «Información verificada», sees a card «Presupuestos» that answers in five seconds:

1. **How much is committed.** A curved gauge (same family as the «validado» one) with two tones: confirmed, then planned, over the sum of the budgets of the events in the period. Centre: «≈ 35.200 €», caption «de 50.000 € presupuestados». Legend with figures: Confirmado · Previsto · Libre. Over budget: the arc is full, the excess shows in the danger tone and the caption says «Por encima ≈ 1.200 €».
2. **Where it goes.** A donut «En qué se va» by company (top 4 + «Otras (n)» + «Sin empresa» when relevant), with a legend carrying name and amount so colour is never the only channel. Hover/focus on a slice or legend row highlights the pair.
3. **Which event needs attention.** A list «Por evento» (events of the period that have a budget or an expense, at most 5 + «Ver los n restantes»): name, date, the existing ribbon (`ribbonOf`), percentage, and a status chip: Dentro · Ajustado (≥ 90 %) · Por encima ≈ X € · Sin presupuesto. Clicking a row opens that event's budget sheet (existing route).
4. **What the figures leave out.** A footer of deterministic warnings, built from the same rules as `caveatsOf`: «6 gastos sin importe · 4 impuestos por verificar · 2 eventos sin presupuesto». Every figure carries «≈» and the card says «estimación, no contabilidad» with the `?` explanation in plain language.

A period switch in the card header: **Próximos** (default: events dated today or later) · **Este año** · **Todo** (includes undated events). The choice is remembered on the device.

Who sees it: only viewers with `budget.read` (administration and development), as the rest of the budget. Without it (team, guest, «Ver como invitado», provisional password) the card is not rendered at all, and the server refuses the data anyway (403).

## Approach

**Contract (first, shared).** `shared/logistics/contracts.ts`:
- `BudgetBreakdownRow { eventId; companyId: Uuid | null; companyName: string | null; status: ExpenseStatus; count; beforeTax; withTax; unknownAmount; unknownTax; taxToVerify }`, aggregated by (event, company, status).
- `GET /organizations/:orgId/budget-breakdown → ListResponse<BudgetBreakdownRow>`, documented in the contracts header next to `/budgets`.

**Server** (`server/src/budget/`): `listBudgetBreakdown` in `service.ts`, same access as `listBudgetSummaries` (`requireAccess(..., 'budget.read')`, 403 / PROVISIONAL_HOLD / 404 as today), reads expenses of the organization and aggregates with the shared `withTax` so the estimate is identical to the budget sheet's. Route in `routes.ts`. Nothing is logged; amounts never reach the activity log.

**Client data** (`src/logistics/budget/`):
- `api.ts`: `budgetApi.summaries(orgId)` (existing endpoint) and `budgetApi.breakdown(orgId)`; same `call` helper, so no device copy and the usual offline refusal.
- `overview.ts` (pure, unit-tested): given summaries, breakdown rows, the store's events, the period and today (event time zone), returns gauge figures, donut slices (top 4 + others, sorted, stable ties by name), per-event rows with status, and warnings. All money rounding through the shared helpers.
- `useBudgetOverview.ts`: loads both lists in parallel, refreshes when the store pulls changes of type `budget`/`expense`, exposes loading / error / offline.

**UI**:
- `src/logistics/ui/Gauge.tsx`: optional second segment (`secondary`) and `over` flag, backward compatible (VerifiedCard and DaySummary unchanged).
- `src/logistics/ui/Donut.tsx`: new SVG donut, accessible (`role="img"` + label, legend as a list), no library.
- `src/logistics/hoy/BudgetOverviewCard.tsx`: the card; mounted in `HoyScreen.tsx` after `VerifiedCard` inside `lx-hoy__rest`, only when `can('budget.read')`.
- Styles in `src/styles/logistics/budget.css` (+ tokens if needed): series colours derived from palette variables (`--lx-accent`, ink and soft tones via `color-mix`) so the donut works in all six palettes; checked for distinguishability in each.
- Responsive: three zones side by side on wide screens, gauge + donut on one row and the list below on medium, all stacked on mobile.

**States**: skeleton while loading; empty «Aún no hay presupuestos ni gastos» with a hint to open an event's budget; offline uses the existing `BUDGET_OFFLINE` text; error with retry (`LoadError`); a period without data says so and suggests «Todo».

## Included improvements

- Period switch remembered on the device.
- «Ajustado» status at ≥ 90 % so problems are seen before they happen.
- «Sin empresa» slice so expenses without a company are not silently dropped.
- Demo data (`seed/demo-budget.ts`) already fills the card, so it shows content in the Elvis demo.

## Out of this slice (ideas for later)

- Expense categories («sonido», «carpas», «seguridad») and a donut by category: needs an additive migration and a form field.
- Monthly stacked bars of spending.
- Money in the day-close report (administration only).
- Planned vs. final comparison when an event closes.

## Invariants

None of CLAUDE.md §8 is touched (no venue geometry, routes, subsoil or demand). Rules kept: budget data only with `budget.read`, enforced on the server; never stored on the device nor queued; amounts never in the activity log; every with-tax figure presented as «estimación».

## Work packages

1. Contract + server endpoint + server tests (backend-engineer). Contract written first.
2. `overview.ts` + unit tests (in parallel with 1, against the contract).
3. Gauge extension, Donut, card, styles, Hoy mount (ui-engineer), after 2's types.
4. E2E + mock API + visual palettes (qa-engineer); code-reviewer on the diff.

## Acceptance criteria

- An administrator and a developer see the card on Hoy; team, guest, «Ver como invitado» and a provisional password do not, and the endpoint answers 403 to them (server test).
- Figures match the sum of each event's budget sheet for the same period (unit test with mixed planned/confirmed, unknown amount, unknown tax, tax to verify, over budget, no budget).
- Donut: at most 6 slices, legend with amounts, «Sin empresa» when applicable; keyboard focus on legend rows highlights the slice.
- Clicking an event row opens its budget sheet.
- Offline: the card shows the offline notice, no figures from the device.
- Loading, empty, error and over-budget states render correctly; the card looks right in all six palettes and on a narrow viewport.
- VerifiedCard and the day summary gauges are visually unchanged.

## Verification

Baseline first (`oxeye-verification`). Then `npx tsc --noEmit -p server/tsconfig.json`, `npx vitest run --root server`, root lint, `tsc`, unit tests, `npm run build`, the logistics e2e for Hoy and budget, and screenshots of Hoy with the card in the six palettes (extend the visual spec), opened and reviewed. Real-database check left to the user with the exact command in the report.

## Allowed paths

- `shared/logistics/contracts.ts`
- `server/src/budget/**`
- `server/tests/**`
- `src/logistics/budget/**`
- `src/logistics/hoy/**`
- `src/logistics/ui/**`
- `src/styles/logistics/**`
- `tests/unit/**`
- `tests/e2e/**`
