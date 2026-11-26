/**
 * Test harness: a fresh in-process PostgreSQL (PGlite) with migrations and
 * the pilot seed applied, an app with a controllable clock, and small HTTP
 * helpers. No Docker, no network.
 */
import {createApp} from '../src/app.ts';
import type {AppOptions} from '../src/app.ts';
import type {Config} from '../src/config.ts';
import type {Db} from '../src/db/db.ts';
import {migrate} from '../src/db/migrate.ts';
import {createPgliteDb} from '../src/db/pglite.ts';
import {seed} from '../src/seed/seed.ts';
import type {SeedResult} from '../src/seed/seed.ts';
import type {
  LoginResponse,
  Organization,
} from '../../shared/logistics/contracts.ts';

export const TEST_ORIGIN = 'http://localhost:5173';

export const testConfig: Config = {
  databaseUrl: 'postgres://unused',
  host: '127.0.0.1',
  port: 0,
  corsOrigins: [TEST_ORIGIN],
  sessionDays: 30,
  nodeEnv: 'test',
  migrateOnStart: false,
  trustProxyHops: 0,
};

export const passwordFor = (name: string) => `pw-${name.toLowerCase()}-1234`;

export interface Clock {
  now: () => Date;
  set: (iso: string) => void;
  advance: (ms: number) => void;
}

export function createClock(iso = '2026-11-26T10:00:00.000Z'): Clock {
  let t = Date.parse(iso);
  return {
    now: () => new Date(t),
    set: v => {
      t = Date.parse(v);
    },
    advance: ms => {
      t += ms;
    },
  };
}

export async function createSeededDb(
  clock: Clock = createClock(),
): Promise<{db: Db; seeded: SeedResult}> {
  const db = await createPgliteDb();
  await migrate(db);
  const seeded = await seed(db, {passwordFor, now: clock.now()});
  return {db, seeded};
}

type App = ReturnType<typeof createApp>;

export interface Harness {
  db: Db;
  app: App;
  clock: Clock;
  org: Organization;
  seeded: SeedResult;
  request: (
    method: string,
    path: string,
    options?: {
      token?: string;
      body?: unknown;
      headers?: Record<string, string>;
    },
  ) => Promise<Response>;
  login: (displayName: string, ip?: string) => Promise<LoginResponse>;
  newApp: (overrides?: Partial<AppOptions>) => App;
}

export async function createHarness(): Promise<Harness> {
  const clock = createClock();
  const {db, seeded} = await createSeededDb(clock);
  const newApp = (overrides: Partial<AppOptions> = {}) =>
    createApp({
      db,
      config: testConfig,
      now: clock.now,
      clientIp: c => c.req.header('x-test-ip') ?? '10.0.0.1',
      ...overrides,
    });
  const app = newApp();

  const request: Harness['request'] = (method, path, options = {}) => {
    const headers: Record<string, string> = {...options.headers};
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    let body: string | undefined;
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body =
        typeof options.body === 'string'
          ? options.body
          : JSON.stringify(options.body);
    }
    return Promise.resolve(app.request(`/api${path}`, {method, headers, body}));
  };

  const login: Harness['login'] = async (displayName, ip) => {
    const res = await request('POST', '/auth/login', {
      body: {displayName, password: passwordFor(displayName)},
      headers: ip ? {'x-test-ip': ip} : {},
    });
    if (res.status !== 200) {
      throw new Error(`Login failed for ${displayName}: ${res.status}`);
    }
    return (await res.json()) as LoginResponse;
  };

  return {
    db,
    app,
    clock,
    org: seeded.organization,
    seeded,
    request,
    login,
    newApp,
  };
}

export async function json<T = any>(res: Response): Promise<T> {
  return (await res.json()) as T;
}
