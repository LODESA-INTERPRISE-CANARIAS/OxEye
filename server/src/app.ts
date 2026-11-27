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
import {registerAcceptanceRoutes} from './acceptances/routes.ts';
import {registerAccountRoutes} from './account/routes.ts';
import {registerAdminRoutes} from './admin/routes.ts';
import {createMailOutbox} from './mail/outbox.ts';
import {createMailTransport} from './mail/transport.ts';
import type {MailTransport} from './mail/transport.ts';
import {registerActivityRoutes} from './activity/routes.ts';
import {MEDIA_BODY_MAX_BYTES, registerMediaRoutes} from './media/routes.ts';
import {registerOrganizationRoutes} from './organizations/routes.ts';
import {requireAuth} from './auth/middleware.ts';
import {createRateLimiter} from './auth/rate-limit.ts';
import {registerAuthRoutes} from './auth/routes.ts';
import {registerBudgetRoutes} from './budget/routes.ts';
import {registerCategoryRoutes} from './categories/routes.ts';
import {registerCompanyRoutes} from './companies/routes.ts';
import {registerContactRoutes} from './contacts/routes.ts';
import {registerDemoRoutes} from './demo/routes.ts';
import {registerEventRoutes} from './events/routes.ts';
import type {AppEnv, Deps} from './http/env.ts';
import {errorResponse, handleError, notFoundResponse} from './http/errors.ts';
import {logPath} from './http/log-path.ts';
import {withRequestUser} from './http/acting.ts';
import {registerHypothesisRoutes} from './hypotheses/routes.ts';
import {registerNoteRoutes} from './notes/routes.ts';
import {registerOfferRoutes} from './offers/routes.ts';
import {registerOfferTermsRoutes} from './offer-terms/routes.ts';
import {registerQuoteRoutes} from './quotes/routes.ts';
import {registerResourceRoutes} from './resources/routes.ts';
import {registerSearchRoutes} from './searches/routes.ts';
import {registerTaskRoutes} from './tasks/routes.ts';
import {registerVenueRoutes} from './venues/routes.ts';
import {registerWarehouseRoutes} from './warehouses/routes.ts';
import type {
  HealthResponse,
  SessionUser,
} from '../../shared/logistics/contracts.ts';

export interface AppOptions {
  db: Db;
  config: Config;
  /** Clock; injectable for tests. */
  now?: () => Date;
  /** Client IP for login throttling; defaults to a single shared key. */
  clientIp?: (c: Context) => string;
  /** Request and error log sink; defaults to silence. */
  log?: (line: string) => void;
  /** E4: account e-mail transport; default from `config.mail`. */
  mail?: MailTransport;
}

const LOGIN_WINDOW_MS = 10 * 60_000;
/** Failed logins allowed per display name in the window. */
export const LOGIN_MAX_PER_NAME = 5;
/** Per IP it is higher: the whole team may share one phone hotspot or office NAT. */
export const LOGIN_MAX_PER_IP = 20;
const MAX_BODY_BYTES = 100 * 1024;
/** E4: recovery requests allowed per name and per IP in the login window. */
export const RECOVERY_MAX_PER_NAME = 3;
export const RECOVERY_MAX_PER_IP = 10;

export interface AppWithMail extends Hono<AppEnv> {
  /** Waits for account e-mails queued in the background (tests, shutdown). */
  flushMail: () => Promise<void>;
}

export function createApp(options: AppOptions): AppWithMail {
  const now = options.now ?? (() => new Date());
  const log = options.log ?? (() => {});
  const nowMs = () => now().getTime();
  const limiter = (max: number) =>
    createRateLimiter({max, windowMs: LOGIN_WINDOW_MS, now: nowMs});
  const transport =
    options.mail ?? createMailTransport(options.config.mail, log);
  const deps: Deps = {
    db: options.db,
    config: options.config,
    now,
    log,
    clientIp: options.clientIp ?? (() => 'unknown'),
    limits: {
      byName: limiter(LOGIN_MAX_PER_NAME),
      byIp: limiter(LOGIN_MAX_PER_IP),
    },
    recoveryLimits: {
      byName: limiter(RECOVERY_MAX_PER_NAME),
      byIp: limiter(RECOVERY_MAX_PER_IP),
    },
    mail: createMailOutbox(transport, log),
  };

  const app = new Hono<AppEnv>();
  const allowed = new Set(options.config.corsOrigins);

  app.use('*', async (c, next) => {
    const started = Date.now();
    await next();
    // Only an image read sets its own caching (private, immutable).
    if (!c.res.headers.has('Cache-Control')) {
      c.header('Cache-Control', 'no-store');
    }
    c.header('X-Content-Type-Options', 'nosniff');
    // Path only: no query string, headers or bodies in the log.
    log(
      `${c.req.method} ${logPath(c.req.path)} ${c.res.status} ${Date.now() - started}ms`,
    );
  });
  app.use(
    '/api/*',
    cors({
      origin: origin => (allowed.has(origin) ? origin : null),
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Authorization', 'Content-Type'],
      exposeHeaders: ['Retry-After'],
      maxAge: 600,
    }),
  );
  const tooLarge = (c: Context) =>
    errorResponse(
      c,
      new AppError('VALIDATION', 'La petición es demasiado grande.'),
    );
  const generalLimit = bodyLimit({maxSize: MAX_BODY_BYTES, onError: tooLarge});
  // E3: an image upload carries base64 of up to MEDIA_MAX_BYTES.
  const mediaLimit = bodyLimit({
    maxSize: MEDIA_BODY_MAX_BYTES,
    onError: tooLarge,
  });
  app.use('/api/*', (c, next) =>
    (c.req.method === 'POST' && c.req.path === '/api/media') ||
    // A shared account's photo, set from administration.
    (c.req.method === 'PATCH' &&
      /^\/api\/admin\/users\/[^/]+\/profile$/.test(c.req.path))
      ? mediaLimit(c, next)
      : generalLimit(c, next),
  );

  // Safety audit: services sign activity during a support session with the
  // administrator behind it (http/acting.ts); the user is read lazily, once
  // the auth middleware has set it.
  app.use('/api/*', (c, next) =>
    withRequestUser(() => c.get('user') as SessionUser | undefined, next),
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
  registerTaskRoutes(api, deps, auth);
  registerCompanyRoutes(api, deps, auth);
  registerCategoryRoutes(api, deps, auth);
  registerContactRoutes(api, deps, auth);
  registerOfferRoutes(api, deps, auth);
  registerWarehouseRoutes(api, deps, auth);
  registerResourceRoutes(api, deps, auth);
  registerNoteRoutes(api, deps, auth);
  registerHypothesisRoutes(api, deps, auth);
  // Revisión 1 · E2–E3.
  registerOrganizationRoutes(api, deps, auth);
  registerAcceptanceRoutes(api, deps, auth);
  registerMediaRoutes(api, deps, auth);
  // Revisión 1 · E4.
  registerAccountRoutes(api, deps, auth);
  registerAdminRoutes(api, deps, auth);
  // Revisión 1 · E5.
  registerBudgetRoutes(api, deps, auth);
  registerSearchRoutes(api, deps, auth);
  registerActivityRoutes(api, deps, auth);
  registerDemoRoutes(api, deps, auth);
  // Revisión 1 · E6–E7 (the `/public/*` supplier routes carry no session).
  registerOfferTermsRoutes(api, deps, auth);
  registerQuoteRoutes(api, deps, auth);

  app.route('/api', api);
  app.notFound(notFoundResponse);
  app.onError((err, c) => handleError(err, c, log));
  return Object.assign(app, {flushMail: () => deps.mail.flush()});
}
