/* global console, fetch, AbortSignal */
/**
 * `npm run equipo`: lets the team try the Gestor logístico on this PC from
 * anywhere, in one terminal.
 *
 * 1. Starts the API on loopback (or reuses one already answering).
 * 2. Builds the web in production mode (`--mode equipo` → `/api`) and serves
 *    it on 127.0.0.1:4173; the Vite proxy forwards `/api` to the API.
 * 3. Opens a Cloudflare quick tunnel to the web and prints its address.
 *
 * Ctrl+C stops everything this script started. Only the web goes through the
 * tunnel; the API never listens outside this machine. For testing only:
 * quick tunnels have no uptime guarantee.
 */
import {spawn, spawnSync} from 'node:child_process';
import process from 'node:process';
import {setTimeout as sleep} from 'node:timers/promises';

const API_HEALTH = 'http://127.0.0.1:8787/api/health';
const WEB_PORT = 4173;
const WEB_URL = `http://127.0.0.1:${WEB_PORT}/`;
const API_WAIT_MS = 60_000;
const WEB_WAIT_MS = 30_000;
const IS_WINDOWS = process.platform === 'win32';
const TUNNEL_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

/** @type {import('node:child_process').ChildProcess[]} */
const children = [];
let stopping = false;

function say(text) {
  console.log(`\n▸ ${text}`);
}

function fail(text) {
  console.error(`\n✖ ${text}`);
  stop(1);
}

/** Prints a child's output line by line with a prefix; `keep` filters. */
function pipeLines(stream, prefix, keep, onLine) {
  let rest = '';
  stream.setEncoding('utf8');
  stream.on('data', chunk => {
    const lines = (rest + chunk).split(/\r?\n/);
    rest = lines.pop() ?? '';
    for (const line of lines) {
      onLine(line);
      if (line.trim() && keep(line)) console.log(`${prefix} ${line}`);
    }
  });
}

function start(command, prefix, options = {}) {
  const {env = {}, keep = () => true, onLine = () => {}} = options;
  const child = spawn(command, {
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {...process.env, ...env},
    detached: !IS_WINDOWS,
  });
  pipeLines(child.stdout, prefix, keep, onLine);
  pipeLines(child.stderr, prefix, keep, onLine);
  child.on('exit', code => {
    if (stopping) return;
    fail(
      `${prefix} se ha parado (código ${code ?? '?'}). Revisa las líneas de arriba.`,
    );
  });
  children.push(child);
  return child;
}

function kill(child) {
  if (child.exitCode !== null || child.pid === undefined) return;
  try {
    if (IS_WINDOWS) {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
      });
    } else {
      process.kill(-child.pid, 'SIGTERM');
    }
  } catch {
    // Already gone.
  }
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) kill(child);
  if (children.length) console.log('\nTodo parado.');
  process.exit(code);
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

async function answers(url) {
  try {
    const res = await fetch(url, {signal: AbortSignal.timeout(2000)});
    return res.ok;
  } catch {
    return false;
  }
}

async function waitFor(url, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (stopping) return false;
    if (await answers(url)) return true;
    await sleep(500);
  }
  return false;
}

function hasCloudflared() {
  const r = spawnSync('cloudflared --version', {shell: true, stdio: 'ignore'});
  return r.status === 0;
}

function box(lines) {
  const width = Math.max(...lines.map(l => l.length));
  const edge = '─'.repeat(width + 2);
  console.log(`\n┌${edge}┐`);
  for (const l of lines) console.log(`│ ${l.padEnd(width)} │`);
  console.log(`└${edge}┘\n`);
}

async function main() {
  console.log(
    'Gestor logístico · acceso del equipo desde fuera (solo pruebas)',
  );

  if (!hasCloudflared()) {
    fail(
      'No encuentro «cloudflared». Instálalo una vez con:\n' +
        '  winget install --id Cloudflare.cloudflared\n' +
        'y abre una terminal nueva.',
    );
    return;
  }

  // 1. API
  if (await answers(API_HEALTH)) {
    say('La API ya está en marcha: la uso.');
  } else {
    say('Arrancando la API…');
    start('npm --prefix server run start', '[api]', {
      // Loopback only: the team reaches it through the web's proxy.
      env: {HOST: '127.0.0.1'},
    });
    if (!(await waitFor(API_HEALTH, API_WAIT_MS))) {
      fail(
        'La API no responde en http://127.0.0.1:8787. Comprueba server/.env y la base de datos.',
      );
      return;
    }
    say('API lista.');
  }

  // 2. Web
  if (await answers(WEB_URL)) {
    fail(
      `El puerto ${WEB_PORT} ya está ocupado (¿otra ventana con «npm run equipo:web» o «npm run preview»?). Ciérrala y vuelve a probar.`,
    );
    return;
  }
  say('Compilando la web (modo producción, tarda un poco)…');
  const build = spawnSync('npx vite build --mode equipo', {
    shell: true,
    encoding: 'utf8',
  });
  if (build.status !== 0) {
    console.error(build.stdout, build.stderr);
    fail('La compilación ha fallado.');
    return;
  }
  start(
    `npx vite preview --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
    '[web]',
  );
  if (!(await waitFor(WEB_URL, WEB_WAIT_MS))) {
    fail(`La web no responde en ${WEB_URL}.`);
    return;
  }
  say(`Web lista en ${WEB_URL}#logistica (en este PC).`);

  // 3. Tunnel
  say('Abriendo el túnel…');
  let announced = false;
  start(
    `cloudflared tunnel --url http://localhost:${WEB_PORT} --http-host-header localhost:${WEB_PORT}`,
    '[túnel]',
    {
      // cloudflared is chatty: show only warnings and errors.
      keep: line => /\b(ERR|WRN)\b/.test(line),
      onLine: line => {
        const found = announced ? null : TUNNEL_URL.exec(line);
        if (!found) return;
        announced = true;
        box([
          'Dirección para el equipo:',
          '',
          `${found[0]}/#logistica`,
          '',
          'Puede tardar unos segundos en responder la primera vez.',
          'Cambia cada vez que arrancas. Ctrl+C lo para todo.',
        ]);
      },
    },
  );
}

main().catch(error => {
  console.error(error);
  stop(1);
});
