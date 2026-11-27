import type {Context, Hono, MiddlewareHandler} from 'hono';
import {bodyLimit} from 'hono/body-limit';
import {z} from 'zod';
import {AppError, validationError} from '../errors.ts';
import {rateLimited} from '../auth/service.ts';
import {createRateLimiter} from '../auth/rate-limit.ts';
import type {RateLimiter} from '../auth/rate-limit.ts';
import {errorResponse} from '../http/errors.ts';
import type {AppEnv, Deps} from '../http/env.ts';
import {jsonBody} from '../http/validate.ts';
import {requestBase} from '../mail/links.ts';
import {
  addLinksSchema,
  approveSchema,
  closeRequestSchema,
  createRequestSchema,
  declineSchema,
  manualProposalSchema,
  publicProposalSchema,
  rejectSchema,
  renewLinkSchema,
} from '../offer-terms/schemas.ts';
import {
  approveProposal,
  createManualProposal,
  getProposal,
  listProposals,
  rejectProposal,
} from './proposals.ts';
import {
  declineByLink,
  readOpenForm,
  readPublicRequest,
  submitByLink,
  submitOpen,
} from './public.ts';
import {
  addLinks,
  closeRequest,
  createRequest,
  listRequests,
  renewLink,
} from './requests.ts';
import {PROPOSAL_BODY_MAX_BYTES} from '../../../shared/logistics/proposals.ts';
import type {
  ListResponse,
  Proposal,
  ProposalState,
  QuoteRequest,
} from '../../../shared/logistics/contracts.ts';

const WINDOW_MS = 10 * 60_000;
/** Per IP in 10 minutes: reads of a form, and submissions (links and open form). */
export const PUBLIC_READS_PER_IP = 60;
export const PUBLIC_WRITES_PER_IP = 10;
/** Per link in 10 minutes. */
export const PUBLIC_READS_PER_TOKEN = 30;
export const PUBLIC_WRITES_PER_TOKEN = 5;

const PROPOSAL_STATES: readonly ProposalState[] = [
  'pending',
  'approved',
  'rejected',
];

/**
 * Quote requests and the proposals inbox (members with `directory.read`;
 * deciding needs `offers.approve`), and the public supplier routes (E7,
 * no token): rate limited per IP and per link, small bodies, strict
 * validation; everything enters as a pending proposal.
 */
export function registerQuoteRoutes(
  api: Hono<AppEnv>,
  deps: Deps,
  auth: MiddlewareHandler<AppEnv>,
): void {
  const base = (c: Context) => requestBase(deps.config, c.req.header('Origin'));

  api.get('/organizations/:orgId/quote-requests', auth, async c => {
    const body: ListResponse<QuoteRequest> = {
      items: await listRequests(
        deps.db,
        c.get('user'),
        c.req.param('orgId'),
        deps.now(),
      ),
    };
    return c.json(body);
  });

  api.post('/quote-requests', auth, async c => {
    const input = await jsonBody(c, createRequestSchema);
    return c.json(
      await createRequest(deps.db, c.get('user'), input, deps.now(), base(c)),
      201,
    );
  });

  api.post('/quote-requests/:id/links', auth, async c => {
    const input = await jsonBody(c, addLinksSchema);
    return c.json(
      await addLinks(
        deps.db,
        c.get('user'),
        c.req.param('id'),
        input,
        deps.now(),
        base(c),
      ),
    );
  });

  api.post('/quote-requests/:id/links/:linkId/renew', auth, async c => {
    const input = await jsonBody(c, renewLinkSchema);
    return c.json(
      await renewLink(
        deps.db,
        c.get('user'),
        c.req.param('id'),
        c.req.param('linkId'),
        input,
        deps.now(),
        base(c),
      ),
    );
  });

  api.post('/quote-requests/:id/close', auth, async c => {
    const input = await jsonBody(c, closeRequestSchema);
    return c.json(
      await closeRequest(
        deps.db,
        c.get('user'),
        c.req.param('id'),
        input.version,
        deps.now(),
      ),
    );
  });

  api.get('/organizations/:orgId/proposals', auth, async c => {
    const raw = c.req.query('state');
    if (
      raw !== undefined &&
      !(PROPOSAL_STATES as readonly string[]).includes(raw)
    ) {
      throw validationError({
        state: 'Estado no válido: pending, approved o rejected.',
      });
    }
    const body: ListResponse<Proposal> = {
      items: await listProposals(
        deps.db,
        c.get('user'),
        c.req.param('orgId'),
        (raw as ProposalState | undefined) ?? null,
        deps.now(),
      ),
    };
    return c.json(body);
  });

  api.get('/proposals/:id', auth, async c =>
    c.json(
      await getProposal(deps.db, c.get('user'), c.req.param('id'), deps.now()),
    ),
  );

  api.post('/proposals', auth, async c => {
    const input = await jsonBody(c, manualProposalSchema);
    return c.json(
      await createManualProposal(deps.db, c.get('user'), input, deps.now()),
      201,
    );
  });

  api.post('/proposals/:id/approve', auth, async c => {
    const input = await jsonBody(c, approveSchema);
    return c.json(
      await approveProposal(
        deps.db,
        c.get('user'),
        c.req.param('id'),
        input,
        deps.now(),
      ),
    );
  });

  api.post('/proposals/:id/reject', auth, async c => {
    const input = await jsonBody(c, rejectSchema);
    return c.json(
      await rejectProposal(
        deps.db,
        c.get('user'),
        c.req.param('id'),
        input,
        deps.now(),
      ),
    );
  });

  // ---------------------------------------------------------------- public (E7)

  const nowMs = () => deps.now().getTime();
  const limiter = (max: number) =>
    createRateLimiter({max, windowMs: WINDOW_MS, now: nowMs});
  const reads = {
    ip: limiter(PUBLIC_READS_PER_IP),
    token: limiter(PUBLIC_READS_PER_TOKEN),
  };
  const writes = {
    ip: limiter(PUBLIC_WRITES_PER_IP),
    token: limiter(PUBLIC_WRITES_PER_TOKEN),
  };
  /**
   * The token travels in the JSON body (`token`), never in the address, so
   * no proxy, access log or browser history keeps it. A missing or
   * malformed one is just a token that does not work (the same 404).
   */
  const tokenOf = (c: Context): Promise<string> =>
    c.req
      .json()
      .then((raw: unknown) => {
        const t = (raw as {token?: unknown} | null)?.token;
        return typeof t === 'string' ? t : '';
      })
      .catch(() => '');
  /** Every public request counts (not only failures): there is no login to reward. */
  const throttle =
    (kind: {ip: RateLimiter; token: RateLimiter}): MiddlewareHandler<AppEnv> =>
    async (c, next) => {
      const ipKey = `ip:${deps.clientIp(c)}`;
      // Keyed by a prefix of the token, so the limiter never holds whole tokens.
      const tokenKey = `t:${(await tokenOf(c)).slice(0, 16)}`;
      const wait = Math.max(
        kind.ip.retryAfter(ipKey),
        kind.token.retryAfter(tokenKey),
      );
      if (wait > 0) return errorResponse(c, rateLimited(wait, 'intentos'));
      kind.ip.hit(ipKey);
      kind.token.hit(tokenKey);
      await next();
    };
  const small = bodyLimit({
    maxSize: PROPOSAL_BODY_MAX_BYTES,
    onError: c =>
      errorResponse(
        c,
        new AppError(
          'VALIDATION',
          'La propuesta es demasiado grande: acorta los textos.',
        ),
      ),
  });

  api.post('/public/requests/lookup', small, throttle(reads), async c => {
    await jsonBody(c, z.object({}));
    return c.json(
      await readPublicRequest(deps.db, await tokenOf(c), deps.now()),
    );
  });

  api.post('/public/requests/proposal', small, throttle(writes), async c => {
    const input = await jsonBody(c, publicProposalSchema);
    return c.json(
      await submitByLink(deps.db, await tokenOf(c), input, deps.now()),
      201,
    );
  });

  api.post('/public/requests/decline', small, throttle(writes), async c => {
    const input = await jsonBody(c, declineSchema);
    await declineByLink(deps.db, await tokenOf(c), input.reason, deps.now());
    return c.body(null, 204);
  });

  api.post('/public/offers/lookup', small, throttle(reads), async c => {
    await jsonBody(c, z.object({}));
    return c.json(await readOpenForm(deps.db, await tokenOf(c)));
  });

  api.post('/public/offers/proposal', small, throttle(writes), async c => {
    const input = await jsonBody(c, publicProposalSchema);
    return c.json(
      await submitOpen(deps.db, await tokenOf(c), input, deps.now()),
      201,
    );
  });
}
