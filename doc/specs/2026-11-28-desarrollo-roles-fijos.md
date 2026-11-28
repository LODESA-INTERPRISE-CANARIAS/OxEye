# Gestor logístico · fixed roles and full password reach for Desarrollo

- Slug: `desarrollo-roles-fijos`
- Branch: `fix/desarrollo-roles-fijos`
- Created from: `feat/gestor-logistico` at `66cbfca`
- Size: small, one domain (account administration). One additive migration (no value removed). No API shape change: same routes, new refusals. One server CLI command; root file touched: `server/package.json` (one script line, no dependency).

## Goal and intended experience

A developer account (role `developer`, today only Fabián) is the technical owner of the pilot. It must never be locked out or downgraded by an administrator, and it must be able to get anyone back in.

1. **Fixed roles.** Every membership with `developer` always also has `admin`. On «Usuarios», the roles of a developer account show both boxes ticked and locked, with a lock and «Cuenta de desarrollo: sus roles son fijos». Nobody changes them from the page, the developer included.
2. **Desarrollo is not handed out from the page.** The `Desarrollo` box is locked for every other account («Lo asigna el equipo técnico»): otherwise an administrator could create accounts that can then never be downgraded. The role comes only from the pilot seed (`PILOT_USERS`).
3. **All passwords.** A developer sets a provisional password or prepares a reset link for every account of its organizations: administrators, Equipo, Invitado and other developers. Its own password stays in «Mi perfil» (as for everyone).
4. **Nobody takes over a developer account (included improvement).** An administrator who is not a developer cannot set a provisional password, prepare a reset link or open a support session on a developer account: that would let them enter as the developer and bypass point 1. «Usuarios» shows the lock instead of the buttons: «Su contraseña solo la gestiona desarrollo».
5. **A developer can always get back in, without e-mail.** Recovery e-mail does not work yet, so the guaranteed way back is on the machine that runs the server: `npm --prefix server run cuenta:recuperar -- Fabián`. It gives that one account a new provisional password (printed once, never stored in clear), ends its sessions and drops its pending reset links, reasserts its fixed roles if it is a developer, and writes «Recuperada desde el servidor» in its security history. Nobody else's password changes (unlike `db:seed -- --reset-passwords`, which resets everyone). It works for any account, so it is also the last resort for anyone. Access to the server machine is the strongest factor the pilot has, so this adds no way in from the web. When authentication is hardened later, this is the piece to revisit.

## Approach

- `shared/logistics/permissions.ts`: `fixRoles(roles)` (adds `admin` when `developer` is present) and `isDeveloper(roles)`; used by server and UI so they never disagree.
- `server/migrations/0013_developer_fixed_roles.sql`: add `admin` to any membership holding `developer` (additive backfill), then `CHECK (NOT 'developer' = ANY(roles) OR 'admin' = ANY(roles))`. The database itself refuses a developer without administration.
- `server/src/admin/service.ts`:
  - `setRoles`: 403 when the target holds `developer` in that organization; 400 when the requested roles add or remove `developer`.
  - `requireOutranks`: a developer outranks every account; a non-developer never outranks a developer (403). Applies to provisional password, reset link and support sessions (`startSupport` gains the check).
- `server/src/seed/seed.ts`: for `developer` pilot accounts the roles are reasserted on every seed run (admin + developer, merged with whatever else they hold), not only the first time; other accounts keep the «once, then administration decides» rule.
- `server/src/cli/recover-account.ts` + script `cuenta:recuperar` in `server/package.json` (root file, approved with this plan): reuses `generatePassword`, `hashPassword`, `setPassword`, `deleteUserSessions` and `logSecurity`; refuses an unknown or inactive username with a plain Spanish message; refuses while migrations are pending (as `db:seed`). New security event kind `recovered_on_server`, labelled in the account's history. Documented in `server/README.md`. Core logic in a testable function (`server/src/account/recover.ts`), covered by a server test.
- `src/logistics/admin/UsersSheet.tsx` (and `SupportSheet.tsx` if it lists developer accounts as support targets): locked checkboxes with reasons, `outrankedBy` mirrors the new server rule, the lock message for developer accounts.

## Invariants

None of section 8 is touched (accounts only). Security rules kept: nobody sees a current password, a provisional password ends every session of the account and is logged, at least one administrator remains (trivially: a developer is always one).

## Acceptance criteria

- An administrator gets 403 changing the roles of Fabián; nobody can add or remove `Desarrollo` from the page (400); the UI shows both cases locked with their reason.
- After a fresh database and after a database where Fabián had `['developer']` or `['team']`, the migration + seed leave Fabián with `admin` + `developer`.
- Fabián sets a provisional password and a reset link for Elvis, Equipo and Invitado (200).
- Elvis (admin only) gets 403 for provisional password, reset link and support session on Fabián; the UI shows the lock.
- `cuenta:recuperar` on Fabián: only his password changes, it is provisional, his sessions end, his roles are admin + developer, the history shows the event without any secret; an unknown name exits with an error and changes nothing.
- Existing access tests keep passing (adjusted where they assigned `developer` from the page).

## Verification

`npx tsc --noEmit -p server/tsconfig.json`, `npx vitest run --root server`, root `tsc`/lint/unit for the shared file and UI, `npm run build`, `visual-palettes` screenshots of «Usuarios» if it is covered; baseline recorded first. The migration also needs the user to run on the pilot: `docker compose -f server/docker-compose.yml run --rm api npm run migrate` (exact command confirmed in the report).

## Allowed paths

- `shared/logistics/permissions.ts`
- `server/migrations/0013_developer_fixed_roles.sql`
- `server/src/admin/**`
- `server/src/account/**`
- `server/src/cli/recover-account.ts`
- `server/package.json`
- `src/logistics/account/**`
- `server/src/seed/**`
- `server/tests/**`
- `server/README.md`
- `src/logistics/admin/**`
- `tests/unit/**`
- `tests/e2e/**`
