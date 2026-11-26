# Execution log: acceso-equipo-tunel

## Decisions

- Branch `chore/acceso-equipo-tunel` from `feat/gestor-logistico` (59cdc5c), where `server/` lives.
- `.env.equipo` holds only `VITE_LOGISTICS_API_URL=/api`, so `vite build --mode equipo` bakes the relative `/api`; `vite preview` reuses the existing `server.proxy` to reach `localhost:8787`. No change to `vite.config.ts`; works the same in PowerShell and cmd.
- `scripts/equipo.mjs` is plain Node, no dependency: checks `cloudflared`, reuses an API already answering `/api/health` or starts `npm --prefix server run start` with `HOST=127.0.0.1` (process env wins over `server/.env` with `--env-file-if-exists`), refuses an occupied port 4173, builds, previews, opens the tunnel, prints the `trycloudflare.com/#logistica` address in a box, shows only the tunnel's WRN/ERR lines, and on Ctrl+C or any child exiting stops the whole process tree (`taskkill /T /F` on Windows, process groups elsewhere).
- The launcher skips `tsc -b` (the normal `npm run build` keeps it): it is for running, not checking.
- README section «Probar con el equipo desde fuera» in `server/README.md`, after «Desde el móvil en la misma Wi-Fi»; handoff points to it.

## Checks

- `npx eslint scripts/equipo.mjs`: clean. Prettier on the three touched files. `npm run build`: OK.
- Not run here (the environment cannot start servers or `vite build --mode equipo`): the full `npm run equipo` and `equipo:web`. The user's run is the acceptance: the box with the address, login from a phone on mobile data.

## Scope extensions
