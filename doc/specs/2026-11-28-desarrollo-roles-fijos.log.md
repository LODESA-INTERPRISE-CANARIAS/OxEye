# Execution log · desarrollo-roles-fijos

## Decisions

- Recovery from the server is logged as the existing `password_provisional_set` kind with `detail` «Recuperada desde el servidor» and no actor, instead of a new `recovered_on_server` kind: no change to `shared/logistics/contracts.ts` (outside the plan) and the history already shows the detail («…»).
- `requireOutranks` now also guards `startSupport` (with its own message): a support session acts in every organization of the account, so it is refused on a developer account and on an account that belongs to another organization where the actor is not an administrator.
- Review fix: `recoverAccount` keeps shared accounts (Equipo, Invitado) non-provisional, as «Usuarios» does; otherwise Equipo would be stuck with a provisional password it cannot replace.
- A developer-only account (`['developer']`) can no longer exist (migration 0013 CHECK). Server tests that simulated it (`account-hardening`, `money`) now use `['admin', 'developer']`; «developers only read budgets» no longer applies, since a developer is always an administrator.
- `setRoles` on a developer account is 403 even for the developer itself (roles fixed). The «last administrator» rule stays for organizations without a developer.
- The seed reasserts developer roles on every run (merging, never removing other roles); other accounts keep «once, then administration decides».
- The e2e mock (`tests/e2e/logistics/mock-api.ts`) mirrors the new server rules. `money.spec.ts` «a developer reads the budget without the edit controls» kept as is: it uses the mock's `['developer']` only as a device to show the read-only budget UI (`budget.read` without `budget.edit`), which the app still supports.

## Scope extensions
