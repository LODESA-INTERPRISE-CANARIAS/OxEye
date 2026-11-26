/**
 * The HTTP application. `createApp` wires routes over plain service
 * functions; tests call `app.request()` against an in-process database.
 * The API serves logistics data only: no simulation data, and nothing from
 * Punto Violeta.
 */
import {Hono} from 'hono';
import type {Context} from 'hono';
import {bodyLimit} from 'hono/body-limit';
import {cors} from 'hono/cors';
import {appVersion} from './config.ts';
import type {Config} from './config.ts';
import type {Db} from './db/db.ts';
import {AppError} from './errors.ts';
import {registerActivityRoutes} from './activity/routes.ts';
import {requireAuth} from './auth/middleware.ts';
import {createRateLimiter} from './auth/rate-limit.ts';
import {registerAuthRoutes} from './auth/routes.ts';
import {registerDemoRoutes} from './demo/routes.ts';
import {registerEventRoutes} from './events/routes.ts';
import type {AppEnv, Deps} from './http/env.ts';
import {errorResponse, handleError, notFoundResponse} from './http/errors.ts';
import {registerVenueRoutes} from './venues/routes.ts';
import type {HealthResponse} from '../../shared/logistics/contracts.ts';

export interface AppOptions {
  db: Db;
  config: Config;
  /** Clock; injectable for tests. */
  now?: () => Date;
  /** Client IP for login throttling; defaults to a single shared key. */
  clientIp?: (c: Context) => string;
  /** Request and error log sink; defaults to silence. */
  log?: (line: string) => void;
}

const LOGIN_WINDOW_MS = 10 * 60_000;
/** Failed logins allowed per display name in the window. */
export const LOGIN_MAX_PER_NAME = 5;
/** Per IP it is higher: the whole team may share one phone hotspot or office NAT. */
export const LOGIN_MAX_PER_IP = 20;
const MAX_BODY_BYTES = 100 * 1024;

export function createApp(options: AppOptions): Hono<AppEnv> {
  const now = options.now ?? (() => new Date());
  const log = options.log ?? (() => {});
  const nowMs = () => now().getTime();
  const deps: Deps = {
    db: options.db,
    config: options.config,
    now,
    clientIp: options.clientIp ?? (() => 'unknown'),
    limits: {
      byName: createRateLimiter({
        max: LOGIN_MAX_PER_NAME,
        windowMs: LOGIN_WINDOW_MS,
        now: nowMs,
      }),
      byIp: createRateLimiter({
        max: LOGIN_MAX_PER_IP,
        windowMs: LOGIN_WINDOW_MS,
        now: nowMs,
      }),
    },
  };

  const app = new Hono<AppEnv>();
  const allowed = new Set(options.config.corsOrigins);

  app.use('*', async (c, next) => {
    const started = Date.now();
    await next();
    c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    // Path only: no query string, headers or bodies in the log.
    log(
      `${c.req.method} ${c.req.path} ${c.res.status} ${Date.now() - started}ms`,
    );
  });
  app.use(
    '/api/*',
    cors({
      origin: origin => (allowed.has(origin) ? origin : null),
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Authorization', 'Content-Type'],
      exposeHeaders: ['Retry-After'],
      maxAge: 600,
    }),
  );
  app.use(
    '/api/*',
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: c =>
        errorResponse(
          c,
          new AppError('VALIDATION', 'La petición es demasiado grande.'),
        ),
    }),
  );

  const api = new Hono<AppEnv>();
  const auth = requireAuth(deps);

  api.get('/health', async c => {
    let database: HealthResponse['database'] = 'ok';
    try {
      await deps.db.query('SELECT 1');
    } catch {
      database = 'error';
    }
    const body: HealthResponse = {
      status: database === 'ok' ? 'ok' : 'degraded',
      database,
      version: appVersion(),
    };
    return c.json(body, database === 'ok' ? 200 : 503);
  });

  registerAuthRoutes(api, deps, auth);
  registerEventRoutes(api, deps, auth);
  registerVenueRoutes(api, deps, auth);
  registerActivityRoutes(api, deps, auth);
  registerDemoRoutes(api, deps, auth);

  app.route('/api', api);
  app.notFound(notFoundResponse);
  app.onError((err, c) => handleError(err, c, log));
  return app;
}
