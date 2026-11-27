# Marca «OxEye» · the brand is written in one word

- Slug: `marca-oxeye`
- Branch: `chore/marca-oxeye` (created from `feat/gestor-logistico` once `feat/nuevo-simbolo` is merged)
- Size: small, mechanical, cross-cutting text change (~180 occurrences in ~85 files). No behaviour, data or invariant changes.

## Goal

Every place a person reads the product name says «OxEye», never «Ox Eye»: the hub, the simulation, the Gestor logístico (screens, print footers, PDFs, work orders, supplier portal), the account e-mails, the browser tab and the installed-app name, plus code comments, tests and living documentation.

## Approach

- Replace `Ox Eye` → `OxEye` (and `OX EYE` → `OXEYE` if found) in the allowed paths below, file by file with Edit, then re-grep to prove nothing is left outside the excluded records.
- Tests that assert visible text are updated in the same change (print names, footers, e-mails, renewals).
- **Not changed, on purpose:**
  - «Ojo de Buey» / «OJO DE BUEY» (Spanish name in the simulation header and notes) — it is a different name, not the old spelling.
  - The `ojo-de-buey` export format, storage keys and identifiers: renaming them would break saved projects.
  - Historical records: frozen approved plans and their logs (`doc/specs/` before this one), `doc/changes/`, `doc/references/`, and the comment inside the already-applied migration `server/migrations/0011_offer_terms.sql` (migrations are immutable).
  - Existing renewal tasks already stored in a database keep their «Generada por Ox Eye» text; new ones say «OxEye».

## Allowed paths

- `index.html`
- `public/logistics/manifest.webmanifest`
- `src/**`
- `shared/logistics/**`
- `server/src/**`
- `server/tests/**`
- `server/README.md`
- `server/.env.example`
- `tests/**`
- `doc/product/logistics-manager.md`
- `doc/claude/01_VISION_Y_DOMINIO.md`
- `doc/specs/2026-11-27-marca-oxeye.log.md`

## Acceptance criteria

- `Ox Eye` appears nowhere except the excluded historical records.
- PDFs/print footers read «Generado por OxEye»; e-mails are signed «OxEye»; tab title «OxEye · La Laguna»; manifest «OxEye · Gestor logístico».

## Verification

tsc (front and server), lint on touched files, unit tests (front and server), build, and the Gestor e2e specs that assert brand text (print, work orders, offers, supplier, entry, day close, palettes). Local commit `REFACTOR: la marca se escribe «OxEye»`.
