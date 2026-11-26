# Team access through a tunnel: one-command launch and documentation

- Slug: `acceso-equipo-tunel`
- Branch: `chore/acceso-equipo-tunel` (created from `feat/gestor-logistico`, where `server/` lives)
- Size: small, tooling and docs only. No application code, no dependency.

## Goal and intended experience

The user runs the Gestor logístico on their own PC and lets teammates (Yeray) test it from anywhere through a Cloudflare quick tunnel (already verified working by hand on 2026-11-26). Today that takes three terminals and three long commands. After this change:

- `npm run equipo` starts everything in one terminal: the API, a production build of the web served on `127.0.0.1:4173` (so the offline mode and service worker work), and the tunnel. When the tunnel is ready it prints the public `https://….trycloudflare.com/#logistica` address in a clear box, ready to send. Ctrl+C stops all three.
- Short scripts for each piece, for troubleshooting: `npm run equipo:api`, `npm run equipo:web`, `npm run equipo:tunel`.
- A section «Probar con el equipo desde fuera» in `server/README.md`: when to use it, one-time setup (`winget install --id Cloudflare.cloudflared`, `HOST=127.0.0.1` in `server/.env`), the commands, what you should see, caveats (PC on and awake, URL changes per run, shared login rate limit, Cloudflare quick tunnels have no uptime guarantee and are not for the Elvis demo), and frequent problems.

## Approach

- `.env.equipo` at the root with only `VITE_LOGISTICS_API_URL=/api` (no secret; tracked). `vite build --mode equipo` loads it, so the build talks to `/api` and the existing Vite proxy (shared by `vite preview`) forwards it to `localhost:8787`. No change to `vite.config.ts`.
- `package.json` scripts:
  - `equipo`: `node scripts/equipo.mjs`;
  - `equipo:api`: `npm --prefix server run start`;
  - `equipo:web`: `vite build --mode equipo && vite preview --host 127.0.0.1 --port 4173 --strictPort`;
  - `equipo:tunel`: `cloudflared tunnel --url http://localhost:4173 --http-host-header localhost:4173`.
- `scripts/equipo.mjs` (plain Node, no dependency): checks `cloudflared` is installed (otherwise prints the `winget` line and stops), starts the API and waits for its health check, builds, starts the preview, starts the tunnel, reads its output for the `trycloudflare.com` address and prints it in a box with the `#logistica` path; prefixes each process's output (`[api]`, `[web]`, `[túnel]`) and hides the tunnel's noisy info lines; on Ctrl+C or if one process dies, stops the others (on Windows with `taskkill /T`).
- `doc/handoff/gestor-logistico-progreso.md`: one line pointing to the new section.

## Invariants and safety

No domain invariant touched. Exposure stays as verified by hand: only the web port goes through the tunnel; the API listens on loopback (README recommends `HOST=127.0.0.1`); nothing is published to a remote repository. The quick tunnel is labelled «solo para pruebas».

## Allowed paths

- `package.json`
- `.env.equipo`
- `scripts/**`
- `server/README.md`
- `doc/handoff/gestor-logistico-progreso.md`
- `doc/specs/2026-11-26-acceso-equipo-tunel.log.md`

## Acceptance and verification

- `npm run equipo:web` builds with `/api` baked in (checked in `dist/`) and serves on 4173; the service worker registers (production build).
- `scripts/equipo.mjs` passes `eslint` and `prettier`; dry checks I can run here: lint, format, and the missing-`cloudflared` path. Starting the servers and the tunnel is the user's run (I cannot start servers): the expected result is the box with the URL and a working login from a phone on mobile data.
- Commit locally on `chore/acceso-equipo-tunel` with `DOC:` or `FEAT:` title in Spanish; no push.
