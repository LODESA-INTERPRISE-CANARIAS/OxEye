/**
 * Revisión 1 · E6–E7: offer versions with validity, quote requests with one
 * personal link per company, the public supplier routes (scope, expiry,
 * one answer per link, rate limits, validation, privacy, nothing in the log),
 * the proposals inbox (approve creates or versions offers, reject needs a
 * reason), renegotiation tasks (idempotent, assigned to the approver,
 * reassigned by administrators, resolved by a new version), the open form
 * (off by default) and expired offers kept out of the comparison.
 */
import {randomBytes} from 'node:crypto';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';
import {migrate, readMigrations} from '../src/db/migrate.ts';
import {createPgliteDb} from '../src/db/pglite.ts';
import {logPath} from '../src/http/log-path.ts';
import {
  generateRenewals,
  startRenewalTimer,
} from '../src/offer-terms/renewals.ts';
import {
  PUBLIC_READS_PER_IP,
  PUBLIC_WRITES_PER_TOKEN,
} from '../src/quotes/routes.ts';
import {LINK_GONE} from '../src/quotes/public.ts';
import {createHarness, json, passwordFor, TEST_ORIGIN} from './helpers.ts';
import type {Harness} from './helpers.ts';
import {compareNeed} from '../../shared/logistics/offer-terms.ts';
import {parseSupplierLink} from '../../shared/logistics/proposals.ts';
import {PROVISIONAL_HOLD} from '../../shared/logistics/permissions.ts';
import type {
  ApiErrorBody,
  Company,
  ListResponse,
  LogisticsEvent,
  Offer,
  OfferRenewal,
  OfferSettingsResponse,
  OfferVersion,
  Proposal,
  ProposalApproveResponse,
  PublicQuoteRequest,
  QuoteRequest,
  QuoteRequestCreated,
  SupportSessionResponse,
} from '../../shared/logistics/contracts.ts';

const tempDirs: string[] = [];
afterAll(() => {
  for (const d of tempDirs) rmSync(d, {recursive: true, force: true});
});

describe('migration 0011', () => {
  it('applies on top of a 0010 database with offers: they keep their data and get no version', async () => {
    const all = readMigrations();
    const at = all.findIndex(m => m.file === '0011_offer_terms.sql');
    expect(at).toBe(10);
    const dir = mkdtempSync(join(tmpdir(), 'oxeye-offer-terms-'));
    tempDirs.push(dir);
    for (const m of all.slice(0, at)) writeFileSync(join(dir, m.file), m.sql);
    const db = await createPgliteDb();
    await migrate(db, {dir});
    const [user] = await db.query<{id: string}>(
      `INSERT INTO users (username, display_name, role, password_hash)
       VALUES ('Elvis', 'Elvis', 'member', 'scrypt$1$1$1$a$b') RETURNING id`,
    );
    const [org] = await db.query<{id: string}>(
      "INSERT INTO organizations (name) VALUES ('Org') RETURNING id",
    );
    const [company] = await db.query<{id: string}>(
      `INSERT INTO companies (organization_id, name, created_by, updated_by)
       VALUES ($1, 'Carpas', $2, $2) RETURNING id`,
      [org!.id, user!.id],
    );
    await db.query(
      `INSERT INTO offers (organization_id, company_id, name, price, unit, created_by, updated_by)
       VALUES ($1, $2, 'Carpa', 120, 'day', $3, $3)`,
      [org!.id, company!.id, user!.id],
    );
    const before = await db.query('SELECT * FROM offers');

    writeFileSync(join(dir, all[at]!.file), all[at]!.sql);
    expect((await migrate(db, {dir})).applied).toEqual([
      '0011_offer_terms.sql',
    ]);
    expect(await db.query('SELECT * FROM offers')).toEqual(before);
    const [counts] = await db.query<{v: number; s: number}>(
      `SELECT (SELECT count(*)::int FROM offer_versions) AS v,
              (SELECT count(*)::int FROM offer_settings) AS s`,
    );
    expect(counts).toEqual({v: 0, s: 0});
    // Only hashes: a token-sized value is refused.
    await expect(
      db.query(
        `INSERT INTO offer_settings (organization_id, open_link_hash, open_link_created_at)
         VALUES ($1, $2, now())`,
        [org!.id, randomBytes(32).toString('base64url')],
      ),
    ).rejects.toThrow();
    await db.close();
  });
});

// ---------------------------------------------------------------- API

let h: Harness;
let admin: string;
let team: string;
let guest: string;
/** Administrator whose password is still provisional. */
let provisional: string;
let elvisId: string;
let equipoId: string;
let invitadoId: string;
let carpas: Company;
let lonas: Company;
let sonido: Company;
/** The Carpas Norte offer approved from the link proposal (renewal due). */
let carpasOfferId: string;

const userId = async (username: string) =>
  (
    await h.db.query<{id: string}>(
      'SELECT id FROM users WHERE lower(username) = lower($1)',
      [username],
    )
  )[0]!.id;

async function errorOf(res: Response, status: number): Promise<ApiErrorBody> {
  expect(res.status).toBe(status);
  return json<ApiErrorBody>(res);
}

async function ok<T>(res: Response, status = 200): Promise<T> {
  if (res.status !== status) {
    throw new Error(
      `Expected ${status}, got ${res.status}: ${await res.text()}`,
    );
  }
  return json<T>(res);
}

const post = (token: string, path: string, body: unknown) =>
  h.request('POST', path, {token, body, headers: {Origin: TEST_ORIGIN}});

let ipSeq = 0;
/**
 * A public call (no session), each from its own address unless given. Written
 * as `pub('GET', '/requests/<token>')`, `pub('POST', '/requests/<token>/proposal',
 * body)` or `…/decline` (same for `/offers/`) for readability; it is sent as
 * the real route, POST `/public/<kind>/lookup|proposal|decline` with the
 * token in the JSON body.
 */
function pub(method: string, path: string, body?: object, ip?: string) {
  ipSeq++;
  const m = /^\/(requests|offers)\/([^/]*)(?:\/(proposal|decline))?$/.exec(
    path,
  );
  if (!m) throw new Error(`Unknown public path ${path}`);
  const [, kind, token, action] = m;
  expect(method).toBe(action ? 'POST' : 'GET');
  return h.request('POST', `/public/${kind}/${action ?? 'lookup'}`, {
    body: {...body, token},
    headers: {
      'x-test-ip': ip ?? `10.77.${ipSeq % 250}.${Math.floor(ipSeq / 250) + 1}`,
    },
  });
}

const tokenOf = (url: string) => {
  expect(url.startsWith(`${TEST_ORIGIN}/#logistica/proveedor/`)).toBe(true);
  return parseSupplierLink(url.slice(url.indexOf('#')))!.token;
};

const randomToken = () => randomBytes(32).toString('base64url');

function proposal(over: Record<string, unknown> = {}) {
  return {
    company: {
      name: 'Carpas Norte',
      contactName: 'Lucía Pérez',
      phone: '922000111',
      email: 'lucia@carpasnorte.example.org',
    },
    products: [
      {
        key: 'carpa',
        categoryKey: 'carpas',
        name: 'Carpa 6 × 6',
        basis: 'unit_day',
        price: 195,
        seasonal: [{label: 'Verano', months: [6, 7, 8, 9], price: 210}],
        supplements: [
          {label: 'Transporte', kind: 'transport', amount: 120, per: 'order'},
        ],
      },
    ],
    tax: {regime: 'igic', ratePercent: 7},
    pricesIncludeTax: false,
    acceptUntil: '2026-12-20',
    serviceMonths: [5, 6, 7, 8, 9, 10],
    privacyAccepted: true,
    ...over,
  };
}

const NEED = {
  title: '3 carpas de 6 × 6 m',
  quantity: 3,
  unitLabel: 'carpas',
  days: 2,
  dateFrom: '2027-06-12',
  dateTo: '2027-06-13',
  note: 'Montaje el viernes por la tarde.',
};

async function createRequest(
  companyIds: string[],
  extra: Record<string, unknown> = {},
) {
  return ok<QuoteRequestCreated>(
    await post(team, '/quote-requests', {
      organizationId: h.org.id,
      need: NEED,
      companyIds,
      ...extra,
    }),
    201,
  );
}

async function proposals(state?: string): Promise<Proposal[]> {
  const q = state ? `?state=${state}` : '';
  return (
    await ok<ListResponse<Proposal>>(
      await h.request('GET', `/organizations/${h.org.id}/proposals${q}`, {
        token: team,
      }),
    )
  ).items;
}

async function manual(body: Record<string, unknown>, origin = 'Por teléfono') {
  return ok<Proposal>(
    await post(team, '/proposals', {organizationId: h.org.id, origin, ...body}),
    201,
  );
}

async function approve(p: Proposal, products?: unknown) {
  return ok<ProposalApproveResponse>(
    await post(admin, `/proposals/${p.id}/approve`, {
      version: p.version,
      products,
    }),
  );
}

beforeAll(async () => {
  h = await createHarness();
  await h.db.query(
    `UPDATE users SET password_provisional = false
      WHERE username IN ('Elvis', 'Equipo')`,
  );
  admin = (await h.login('Elvis')).token;
  team = (await h.login('Equipo')).token;
  guest = (await h.login('Invitado')).token;
  provisional = (await h.login('Dailos')).token;
  elvisId = await userId('Elvis');
  equipoId = await userId('Equipo');
  invitadoId = await userId('Invitado');
  const company = async (name: string, extra: Record<string, unknown> = {}) =>
    ok<Company>(
      await post(admin, '/companies', {
        organizationId: h.org.id,
        name,
        ...extra,
      }),
      201,
    );
  carpas = await company('Carpas Norte');
  lonas = await company('Lonas Rápidas');
  sonido = await company('Sonido Sur', {
    tax: {regime: 'igic', ratePercent: 7, verification: 'validated'},
  });
});

describe('quote requests and personal links', () => {
  it('the team requests quotes; one link per company; only hashes are stored', async () => {
    const created = await createRequest([carpas.id, lonas.id]);
    expect(created.request).toMatchObject({
      need: {...NEED, categoryId: null, hoursPerDay: null},
      status: 'open',
      createdBy: {id: equipoId},
      version: 1,
    });
    expect(created.request.links.map(l => [l.company.name, l.status])).toEqual([
      ['Carpas Norte', 'waiting'],
      ['Lonas Rápidas', 'waiting'],
    ]);
    expect(created.links).toHaveLength(2);
    const tokens = created.links.map(l => tokenOf(l.url));
    expect(new Set(tokens).size).toBe(2);
    const stored = JSON.stringify(
      await h.db.query('SELECT * FROM quote_request_links'),
    );
    for (const t of tokens) expect(stored).not.toContain(t);
    const listed = await ok<ListResponse<QuoteRequest>>(
      await h.request('GET', `/organizations/${h.org.id}/quote-requests`, {
        token: team,
      }),
    );
    expect(listed.items[0]?.id).toBe(created.request.id);
    expect(JSON.stringify(listed)).not.toContain(tokens[0]!);
  });

  it('validates the need and the companies; guests and requests without an address are refused', async () => {
    const bad = await errorOf(
      await post(team, '/quote-requests', {
        organizationId: h.org.id,
        need: {...NEED, days: 5},
        companyIds: [carpas.id],
      }),
      400,
    );
    expect(bad.fields?.['need.days']).toContain('más jornadas');
    const foreign = await errorOf(
      await post(team, '/quote-requests', {
        organizationId: h.org.id,
        need: NEED,
        companyIds: ['00000000-0000-4000-8000-000000000001'],
      }),
      400,
    );
    expect(Object.keys(foreign.fields ?? {})).toEqual(['companyIds']);
    await errorOf(
      await post(guest, '/quote-requests', {
        organizationId: h.org.id,
        need: NEED,
        companyIds: [carpas.id],
      }),
      403,
    );
    await errorOf(
      await h.request('POST', '/quote-requests', {
        token: team,
        body: {organizationId: h.org.id, need: NEED, companyIds: [carpas.id]},
      }),
      400,
    );
    for (const path of [
      `/organizations/${h.org.id}/quote-requests`,
      `/organizations/${h.org.id}/proposals`,
      `/organizations/${h.org.id}/offer-versions`,
      `/organizations/${h.org.id}/offer-settings`,
      `/organizations/${h.org.id}/offer-renewals`,
    ]) {
      await errorOf(await h.request('GET', path, {token: guest}), 403);
    }
  });
});

describe('the supplier form (public, no session)', () => {
  let request: QuoteRequestCreated;
  let carpasToken: string;
  let lonasToken: string;

  beforeAll(async () => {
    request = await createRequest([carpas.id, lonas.id]);
    carpasToken = tokenOf(
      request.links.find(l => l.company.id === carpas.id)!.url,
    );
    lonasToken = tokenOf(
      request.links.find(l => l.company.id === lonas.id)!.url,
    );
  });

  it('a link shows only its need, its company and the organization', async () => {
    const res = await pub('GET', `/requests/${carpasToken}`);
    const body = await ok<PublicQuoteRequest>(res);
    expect(Object.keys(body).sort()).toEqual([
      'company',
      'expiresAt',
      'need',
      'organization',
      'status',
    ]);
    expect(body).toEqual({
      organization: {name: h.org.name},
      company: {name: 'Carpas Norte'},
      need: {
        title: NEED.title,
        categoryName: null,
        quantity: 3,
        unitLabel: 'carpas',
        days: 2,
        hoursPerDay: null,
        dateFrom: '2027-06-12',
        dateTo: '2027-06-13',
        note: NEED.note,
      },
      expiresAt: request.links[0]!.expiresAt,
      status: 'open',
    });
    expect(JSON.stringify(body)).not.toContain('Lonas');
    const [link] = await h.db.query<{opened_at: unknown}>(
      'SELECT opened_at FROM quote_request_links WHERE id = $1',
      [request.links.find(l => l.company.id === carpas.id)!.linkId],
    );
    expect(link?.opened_at).not.toBeNull();
  });

  it('unknown, malformed and expired links get the same 404', async () => {
    const short = await createRequest([lonas.id], {linkDays: 1});
    const expiredToken = tokenOf(short.links[0]!.url);
    await h.db.query(
      `UPDATE quote_request_links
          SET created_at = '2026-10-31T00:00:00Z', expires_at = '2026-11-01T00:00:00Z'
        WHERE id = $1`,
      [short.links[0]!.linkId],
    );
    const bodies = [];
    for (const t of [randomToken(), 'abc', `${carpasToken}x`, expiredToken]) {
      bodies.push(await errorOf(await pub('GET', `/requests/${t}`), 404));
      bodies.push(
        await errorOf(
          await pub('POST', `/requests/${t}/proposal`, proposal()),
          404,
        ),
      );
    }
    // No token at all, or not a text: the same answer.
    for (const body of [{}, {token: 42}]) {
      bodies.push(
        await errorOf(
          await h.request('POST', '/public/requests/lookup', {
            body,
            headers: {'x-test-ip': '10.80.0.1'},
          }),
          404,
        ),
      );
    }
    for (const b of bodies) {
      expect(b).toEqual({code: 'NOT_FOUND', message: LINK_GONE});
    }
  });

  it('validates strictly: privacy consent, deadline, seasons, size', async () => {
    const noConsent = await errorOf(
      await pub(
        'POST',
        `/requests/${lonasToken}/proposal`,
        proposal({privacyAccepted: false}),
      ),
      400,
    );
    expect(Object.keys(noConsent.fields ?? {})).toEqual(['privacyAccepted']);
    const past = await errorOf(
      await pub(
        'POST',
        `/requests/${lonasToken}/proposal`,
        proposal({acceptUntil: '2026-11-25'}),
      ),
      400,
    );
    expect(past.fields?.acceptUntil).toContain('ya ha pasado');
    const overlap = await errorOf(
      await pub(
        'POST',
        `/requests/${lonasToken}/proposal`,
        proposal({
          products: [
            {
              key: 'carpa',
              name: 'Carpa',
              basis: 'unit_day',
              price: 100,
              seasonal: [
                {label: 'Verano', months: [6, 7], price: 1},
                {label: 'Fiestas', months: [7], price: 2},
              ],
            },
          ],
        }),
      ),
      400,
    );
    expect(overlap.fields?.['products.0.seasonal']).toContain('dos temporadas');
    const big = await errorOf(
      await pub(
        'POST',
        `/requests/${lonasToken}/proposal`,
        proposal({conditions: 'x'.repeat(60_000)}),
      ),
      400,
    );
    expect(big.message).toContain('demasiado grande');
    // Nothing of that entered the inbox.
    expect((await proposals()).length).toBe(0);
  });

  it('one answer per link: pending, under the link’s company, signed by «Sistema»; then the link is used', async () => {
    const lines: string[] = [];
    const logged = h.newApp({log: line => lines.push(line)});
    const res = await logged.request('/api/public/requests/proposal', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'x-test-ip': '10.78.0.1'},
      body: JSON.stringify({
        ...proposal({
          company: {...proposal().company, name: 'Otra Empresa Cualquiera'},
        }),
        token: carpasToken,
      }),
    });
    expect(res.status).toBe(201);
    expect(Object.keys(await json(res))).toEqual(['receivedAt']);
    expect(lines.join('\n')).not.toContain(carpasToken);
    expect(lines.join('\n')).toContain(
      'POST /api/public/requests/proposal 201',
    );
    // The token never travels in the address; an old-style address is a
    // plain 404 and its token is not logged either.
    const old = await logged.request(`/api/public/requests/${carpasToken}`, {
      headers: {'x-test-ip': '10.78.0.2'},
    });
    expect(old.status).toBe(404);
    expect(lines.join('\n')).not.toContain(carpasToken);
    expect(logPath(`/api/public/offers/${carpasToken}/proposal`)).toBe(
      '/api/public/offers/…/proposal',
    );
    expect(logPath('/api/public/offers/lookup')).toBe(
      '/api/public/offers/lookup',
    );
    const stored = JSON.stringify(
      await h.db.query('SELECT content FROM proposals'),
    );
    expect(stored).not.toContain(carpasToken);
    expect(stored).not.toContain('"token"');

    const again = await errorOf(
      await pub('POST', `/requests/${carpasToken}/proposal`, proposal()),
      400,
    );
    expect(again.message).toContain('Ya has respondido');
    await errorOf(
      await pub('POST', `/requests/${carpasToken}/decline`, {}),
      400,
    );
    expect(
      (
        await ok<PublicQuoteRequest>(
          await pub('GET', `/requests/${carpasToken}`),
        )
      ).status,
    ).toBe('answered');

    const [p] = await proposals('pending');
    expect(p).toMatchObject({
      via: 'link',
      state: 'pending',
      request: {id: request.request.id, title: NEED.title},
      company: {id: carpas.id, name: 'Carpas Norte'},
      origin: null,
      createdBy: null,
      content: {
        company: {name: 'Carpas Norte', contactName: 'Lucía Pérez'},
        tax: {regime: 'igic', ratePercent: 7, verification: 'to_verify'},
        privacyVersion: '2026-11-27-borrador',
      },
    });
    expect(p!.content).not.toHaveProperty('privacyAccepted');
    expect(p!.flags).toEqual(['IGIC 7 % · por verificar']);
    const [entry] = await h.db.query<{
      name: string;
      active: boolean;
      label: string;
    }>(
      `SELECT u.display_name AS name, u.is_active AS active, a.entity_label AS label
         FROM activity_log a JOIN users u ON u.id = a.user_id
        WHERE a.entity_type = 'proposal' AND a.entity_id = $1`,
      [p!.id],
    );
    expect(entry).toEqual({
      name: 'Sistema',
      active: false,
      label: 'Carpas Norte',
    });
    const listed = await ok<ListResponse<QuoteRequest>>(
      await h.request('GET', `/organizations/${h.org.id}/quote-requests`, {
        token: team,
      }),
    );
    const link = listed.items
      .find(r => r.id === request.request.id)!
      .links.find(l => l.company.id === carpas.id)!;
    expect(link).toMatchObject({status: 'answered', proposalId: p!.id});
  });

  it('a company may decline (no proposal); a renewed link replaces the old one; closing revokes', async () => {
    expect(
      (
        await pub('POST', `/requests/${lonasToken}/decline`, {
          reason: 'Sin stock',
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await ok<PublicQuoteRequest>(
          await pub('GET', `/requests/${lonasToken}`),
        )
      ).status,
    ).toBe('declined');
    // Answered or declined companies cannot get a fresh link for the same request.
    await errorOf(
      await post(team, `/quote-requests/${request.request.id}/links`, {
        companyIds: [lonas.id],
      }),
      400,
    );

    const other = await createRequest([sonido.id]);
    const oldToken = tokenOf(other.links[0]!.url);
    const renewed = await ok<QuoteRequestCreated>(
      await post(
        team,
        `/quote-requests/${other.request.id}/links/${other.links[0]!.linkId}/renew`,
        {linkDays: 14},
      ),
    );
    const newToken = tokenOf(renewed.links[0]!.url);
    expect(renewed.links[0]!.linkId).toBe(other.links[0]!.linkId);
    await errorOf(await pub('GET', `/requests/${oldToken}`), 404);
    expect((await pub('GET', `/requests/${newToken}`)).status).toBe(200);

    const closed = await ok<QuoteRequest>(
      await post(team, `/quote-requests/${other.request.id}/close`, {
        version: renewed.request.version,
      }),
    );
    expect(closed).toMatchObject({status: 'closed', closedBy: {id: equipoId}});
    expect(closed.links[0]!.status).toBe('revoked');
    await errorOf(await pub('GET', `/requests/${newToken}`), 404);
    await errorOf(
      await post(team, `/quote-requests/${other.request.id}/close`, {
        version: 1,
      }),
      409,
    );
  });

  it('rate limits per link and per address (429 with Retry-After)', async () => {
    const r = await createRequest([sonido.id]);
    const t = tokenOf(r.links[0]!.url);
    const bad = {...proposal(), products: []};
    for (let i = 0; i < PUBLIC_WRITES_PER_TOKEN; i++) {
      expect((await pub('POST', `/requests/${t}/proposal`, bad)).status).toBe(
        400,
      );
    }
    const limited = await pub('POST', `/requests/${t}/proposal`, bad);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).not.toBeNull();
    expect((await json<ApiErrorBody>(limited)).code).toBe('RATE_LIMITED');

    const ip = '10.79.0.1';
    for (let i = 0; i < PUBLIC_READS_PER_IP; i++) {
      expect(
        (await pub('GET', `/requests/${randomToken()}`, undefined, ip)).status,
      ).toBe(404);
    }
    expect(
      (await pub('GET', `/requests/${randomToken()}`, undefined, ip)).status,
    ).toBe(429);
    // Ten minutes later the address may try again.
    h.clock.advance(10 * 60_000 + 1000);
    expect(
      (await pub('GET', `/requests/${randomToken()}`, undefined, ip)).status,
    ).toBe(404);
  });
});

describe('the proposals inbox', () => {
  it('only administrators decide; the team and provisional passwords get 403', async () => {
    const [p] = await proposals('pending');
    await errorOf(
      await post(team, `/proposals/${p!.id}/approve`, {version: p!.version}),
      403,
    );
    await errorOf(
      await post(team, `/proposals/${p!.id}/reject`, {
        version: p!.version,
        reason: 'Caro',
      }),
      403,
    );
    expect(
      (
        await errorOf(
          await post(provisional, `/proposals/${p!.id}/approve`, {
            version: p!.version,
          }),
          403,
        )
      ).message,
    ).toBe(PROVISIONAL_HOLD);
    await errorOf(
      await h.request('GET', `/proposals/${p!.id}`, {token: guest}),
      403,
    );
    await errorOf(
      await h.request(
        'GET',
        `/organizations/${h.org.id}/proposals?state=todas`,
        {token: team},
      ),
      400,
    );
  });

  it('approving creates the offer (version 1), sets the company tax «por verificar» and adds the contact', async () => {
    const [p] = await proposals('pending');
    await errorOf(
      await post(admin, `/proposals/${p!.id}/approve`, {
        version: p!.version + 1,
      }),
      409,
    );
    const approved = await approve(p!);
    expect(approved.proposal).toMatchObject({
      state: 'approved',
      decidedBy: {id: elvisId},
      flags: [],
      result: [{productKey: 'carpa', versionNumber: 1, created: true}],
    });
    const [offer] = approved.offers;
    carpasOfferId = offer!.id;
    expect(offer).toMatchObject({
      name: 'Carpa 6 × 6',
      company: {id: carpas.id},
      price: 195,
      unit: 'day',
      transportCost: 120,
      vatIncluded: false,
      verification: 'to_verify',
      tax: null,
      companyTax: {regime: 'igic', ratePercent: 7, verification: 'to_verify'},
    });
    expect(approved.versions).toEqual([
      expect.objectContaining({
        offerId: offer!.id,
        number: 1,
        status: 'current',
        proposalId: p!.id,
        approvedBy: {id: elvisId, displayName: 'Elvis'},
        changeNote: 'Aprobada desde una propuesta por enlace',
        terms: expect.objectContaining({
          basis: 'unit_day',
          price: 195,
          acceptUntil: '2026-12-20',
          serviceMonths: [5, 6, 7, 8, 9, 10],
          seasonal: [{label: 'Verano', months: [6, 7, 8, 9], price: 210}],
          tax: {
            regime: 'igic',
            name: null,
            ratePercent: 7,
            verification: 'to_verify',
          },
        }),
      }),
    ]);
    const contacts = await h.db.query<{name: string; verification: string}>(
      'SELECT name, verification FROM contacts WHERE company_id = $1',
      [carpas.id],
    );
    expect(contacts).toEqual([
      {name: 'Lucía Pérez', verification: 'to_verify'},
    ]);
    const [link] = await h.db.query<{status: string}>(
      `SELECT l.status FROM quote_request_links l JOIN proposals p ON p.link_id = l.id
        WHERE p.id = $1`,
      [p!.id],
    );
    expect(link?.status).toBe('approved');
    const versions = await ok<ListResponse<OfferVersion>>(
      await h.request('GET', `/offers/${offer!.id}/versions`, {token: team}),
    );
    expect(versions.items.map(v => [v.number, v.status])).toEqual([
      [1, 'current'],
    ]);
    await errorOf(
      await h.request('GET', `/offers/${offer!.id}/versions`, {token: guest}),
      403,
    );
    const after = await errorOf(
      await post(admin, `/proposals/${p!.id}/approve`, {
        version: approved.proposal.version,
      }),
      400,
    );
    expect(after.message).toContain('ya está aprobada');
  });

  it('renegotiating a catalogue offer keeps its old terms as version 1; expenses keep their snapshot', async () => {
    const offer = await ok<Offer>(
      await post(admin, '/offers', {
        organizationId: h.org.id,
        companyId: sonido.id,
        name: 'Equipo de sonido',
        price: 300,
        unit: 'day',
        transportCost: 50,
      }),
      201,
    );
    const event = await ok<LogisticsEvent>(
      await post(admin, '/events', {
        organizationId: h.org.id,
        name: 'Fiestas de Prueba',
        date: '2027-06-12',
      }),
      201,
    );
    const expense = await ok<{id: string}>(
      await post(admin, '/expenses', {eventId: event.id, offerId: offer.id}),
      201,
    );
    const expenseBefore = await h.db.query(
      'SELECT * FROM expenses WHERE id = $1',
      [expense.id],
    );

    const sound = {
      company: {name: 'sonido sur'},
      products: [
        {
          key: 'sonido',
          name: 'Equipo de sonido',
          basis: 'unit_day',
          price: 320,
        },
      ],
      tax: {regime: 'igic', ratePercent: 7},
      pricesIncludeTax: false,
      acceptUntil: '2027-06-30',
      serviceMonths: null,
    };
    const p = await manual({offerId: offer.id, proposal: sound});
    expect(p).toMatchObject({
      via: 'manual',
      origin: 'Por teléfono',
      createdBy: {id: equipoId},
      offer: {id: offer.id, name: 'Equipo de sonido'},
      company: {id: sonido.id, name: 'Sonido Sur'},
    });
    expect(p.flags).toContain('No dice cuándo puede dar el servicio');
    const approved = await approve(p);
    expect(approved.proposal.result).toEqual([
      {
        productKey: 'sonido',
        offerId: offer.id,
        versionNumber: 2,
        created: false,
      },
    ]);
    expect(approved.offers[0]).toMatchObject({
      id: offer.id,
      price: 320,
      tax: null,
      transportCost: null,
    });
    const versions = (
      await ok<ListResponse<OfferVersion>>(
        await h.request('GET', `/offers/${offer.id}/versions`, {token: team}),
      )
    ).items;
    expect(versions.map(v => [v.number, v.status, v.changeNote])).toEqual([
      [
        2,
        'current',
        '300 € → 320 € por unidad y jornada; se puede aceptar hasta el 2027-06-30',
      ],
      [1, 'superseded', 'Datos del catálogo antes de las versiones'],
    ]);
    expect(versions[1]!.terms).toMatchObject({
      price: 300,
      basis: 'unit_day',
      supplements: [expect.objectContaining({label: 'Transporte', amount: 50})],
      acceptUntil: null,
    });
    // The company's validated tax, stated again, stays validated.
    expect(versions[0]!.terms.tax?.verification).toBe('validated');
    expect(
      await h.db.query('SELECT * FROM expenses WHERE id = $1', [expense.id]),
    ).toEqual(expenseBefore);

    // A different tax becomes the offer's own, «por verificar»; the company keeps its tax.
    const iva = await manual({
      offerId: offer.id,
      proposal: {
        ...sound,
        tax: {regime: 'iva', ratePercent: 21},
        acceptUntil: '2027-07-31',
      },
    });
    const third = await approve(iva);
    expect(third.offers[0]).toMatchObject({
      tax: {regime: 'iva', ratePercent: 21, verification: 'to_verify'},
      companyTax: {regime: 'igic', ratePercent: 7, verification: 'validated'},
    });
    expect(third.versions[0]!.number).toBe(3);

    // An offer of another company cannot be versioned by this one.
    const wrong = await manual({
      offerId: offer.id,
      proposal: {...sound, company: {name: 'Carpas Norte'}},
    });
    const err = await errorOf(
      await post(admin, `/proposals/${wrong.id}/approve`, {
        version: wrong.version,
      }),
      400,
    );
    expect(err.fields?.['products.0.offerId']).toContain('otra empresa');
  });

  it('rejecting needs a reason; an expired proposal cannot be approved', async () => {
    const p = await manual({
      proposal: proposal({company: {name: 'Lonas Rápidas'}}),
    });
    for (const reason of ['', 'no']) {
      await errorOf(
        await post(admin, `/proposals/${p.id}/reject`, {
          version: p.version,
          reason,
        }),
        400,
      );
    }
    const rejected = await ok<Proposal>(
      await post(admin, `/proposals/${p.id}/reject`, {
        version: p.version,
        reason: 'Precio fuera de mercado',
      }),
    );
    expect(rejected).toMatchObject({
      state: 'rejected',
      rejectReason: 'Precio fuera de mercado',
      flags: [],
    });
    await errorOf(
      await post(admin, `/proposals/${p.id}/reject`, {
        version: rejected.version,
        reason: 'Otra vez',
      }),
      400,
    );

    const late = await manual({
      proposal: proposal({company: {name: 'Lonas Rápidas'}}),
    });
    await h.db.query(
      `UPDATE proposals SET content = jsonb_set(content, '{acceptUntil}', '"2026-11-01"')
        WHERE id = $1`,
      [late.id],
    );
    const err = await errorOf(
      await post(admin, `/proposals/${late.id}/approve`, {
        version: late.version,
      }),
      400,
    );
    expect(err.message).toContain('vencido');
  });

  it('a decision in a support session keeps the administrator behind it', async () => {
    // Elvis opens a support session on Yeray (another administrator).
    await h.db.query(
      "UPDATE users SET password_provisional = false WHERE username = 'Yeray'",
    );
    const session = await ok<SupportSessionResponse>(
      await post(admin, '/admin/support-sessions', {
        userId: await userId('Yeray'),
        reason: 'Revisar una propuesta que no se decide',
        password: passwordFor('Elvis'),
        minutes: 15,
      }),
      201,
    );
    const p = await manual({
      proposal: proposal({company: {name: 'Lonas Rápidas'}}),
    });
    const decided = await ok<Proposal>(
      await post(session.token, `/proposals/${p.id}/reject`, {
        version: p.version,
        reason: 'Duplicada con otra propuesta',
      }),
    );
    expect(decided.decidedBy).toMatchObject({displayName: 'Yeray'});
    expect(decided.decidedBySupport).toMatchObject({
      id: elvisId,
      displayName: 'Elvis',
    });
    // Read back from the inbox the same way.
    const listed = (await proposals('rejected')).find(x => x.id === p.id)!;
    expect(listed.decidedBySupport).toMatchObject({displayName: 'Elvis'});

    // A normal session signs alone.
    const own = await manual({
      proposal: proposal({company: {name: 'Lonas Rápidas'}}),
    });
    const alone = await ok<Proposal>(
      await post(admin, `/proposals/${own.id}/reject`, {
        version: own.version,
        reason: 'Precio fuera de mercado',
      }),
    );
    expect(alone.decidedBy).toMatchObject({displayName: 'Elvis'});
    expect(alone.decidedBySupport).toBeUndefined();
    await h.request('DELETE', `/admin/support-sessions/${session.sessionId}`, {
      token: admin,
    });
  });
});

describe('renegotiation tasks', () => {
  it('generated once, before the deadline, by Ox Eye, assigned to the approver', async () => {
    const lines: string[] = [];
    const stop = startRenewalTimer(
      h.db,
      line => lines.push(line),
      h.clock.now,
      60_000,
    );
    await vi.waitFor(() => expect(lines).toHaveLength(1));
    stop();
    expect(lines[0]).toBe(
      'Renegociaciones: 1 tarea nueva generada por Ox Eye.',
    );

    const renewals = await ok<ListResponse<OfferRenewal>>(
      await h.request('GET', `/organizations/${h.org.id}/offer-renewals`, {
        token: team,
      }),
    );
    expect(renewals.items).toEqual([
      expect.objectContaining({
        offer: {id: carpasOfferId, name: 'Carpa 6 × 6'},
        company: {id: carpas.id, name: 'Carpas Norte'},
        versionNumber: 1,
        acceptUntil: '2026-12-20',
        noticeDays: 30,
        assignee: {id: elvisId, displayName: 'Elvis'},
        generatedBy: 'ox_eye',
        resolvedAt: null,
      }),
    ]);
    const [task] = await h.db.query<Record<string, unknown>>(
      `SELECT t.title, t.event_id, t.company_id, t.local_date::text AS date, t.status,
              u.display_name AS author, u.is_active AS active
         FROM tasks t JOIN users u ON u.id = t.created_by WHERE t.id = $1`,
      [renewals.items[0]!.taskId],
    );
    expect(task).toEqual({
      title: 'Renegociar oferta con Carpas Norte',
      event_id: null,
      company_id: carpas.id,
      date: '2026-12-20',
      status: 'planned',
      author: 'Sistema',
      active: false,
    });

    // Idempotent: the route, the timer's function and again.
    await errorOf(
      await post(team, `/organizations/${h.org.id}/offer-renewals/run`, {}),
      403,
    );
    expect(
      await ok(
        await post(admin, `/organizations/${h.org.id}/offer-renewals/run`, {}),
      ),
    ).toEqual({created: 0});
    expect(await generateRenewals(h.db, h.clock.now())).toBe(0);
  });

  it('administrators reassign it (never to the guest account); a new version resolves it', async () => {
    const [r] = (
      await ok<ListResponse<OfferRenewal>>(
        await h.request('GET', `/organizations/${h.org.id}/offer-renewals`, {
          token: team,
        }),
      )
    ).items;
    await errorOf(
      await h.request('PATCH', `/offer-renewals/${r!.id}`, {
        token: team,
        body: {version: r!.version, assigneeId: equipoId},
      }),
      403,
    );
    const toGuest = await errorOf(
      await h.request('PATCH', `/offer-renewals/${r!.id}`, {
        token: admin,
        body: {version: r!.version, assigneeId: invitadoId},
      }),
      400,
    );
    expect(Object.keys(toGuest.fields ?? {})).toEqual(['assigneeId']);
    const moved = await ok<OfferRenewal>(
      await h.request('PATCH', `/offer-renewals/${r!.id}`, {
        token: admin,
        body: {version: r!.version, assigneeId: equipoId},
      }),
    );
    expect(moved.assignee).toEqual({id: equipoId, displayName: 'Equipo'});
    await errorOf(
      await h.request('PATCH', `/offer-renewals/${r!.id}`, {
        token: admin,
        body: {version: r!.version, assigneeId: null},
      }),
      409,
    );

    const renewal = await manual({
      offerId: carpasOfferId,
      proposal: proposal({
        acceptUntil: '2027-12-31',
        privacyAccepted: undefined,
      }),
    });
    await approve(renewal);
    const [resolved] = (
      await ok<ListResponse<OfferRenewal>>(
        await h.request('GET', `/organizations/${h.org.id}/offer-renewals`, {
          token: team,
        }),
      )
    ).items;
    expect(resolved).toMatchObject({resolvedByVersion: 2});
    expect(resolved!.resolvedAt).not.toBeNull();
    const [task] = await h.db.query<{status: string}>(
      'SELECT status FROM tasks WHERE id = $1',
      [resolved!.taskId],
    );
    expect(task?.status).toBe('done');
  });
});

describe('offer settings and the open form', () => {
  it('off by default; administrators turn it on, rotate it and turn it off', async () => {
    const path = `/organizations/${h.org.id}/offer-settings`;
    const initial = await ok<{
      renewalNoticeDays: number;
      openLink: unknown;
      version: number;
    }>(await h.request('GET', path, {token: team}));
    expect(initial).toMatchObject({
      renewalNoticeDays: 30,
      openLink: {enabled: false, createdAt: null},
      version: 0,
    });
    await errorOf(await pub('GET', `/offers/${randomToken()}`), 404);
    const patch = (token: string, body: unknown) =>
      h.request('PATCH', path, {token, body, headers: {Origin: TEST_ORIGIN}});
    await errorOf(await patch(team, {version: 0, openLinkEnabled: true}), 403);
    await errorOf(await patch(admin, {version: 0, renewalNoticeDays: 45}), 400);

    const on = await ok<OfferSettingsResponse>(
      await patch(admin, {
        version: 0,
        openLinkEnabled: true,
        renewalNoticeDays: 60,
      }),
    );
    expect(on.settings).toMatchObject({
      renewalNoticeDays: 60,
      openLink: {enabled: true},
      version: 1,
    });
    expect(
      on.openLinkUrl?.startsWith(
        `${TEST_ORIGIN}/#logistica/proveedor/abierto/`,
      ),
    ).toBe(true);
    const first = parseSupplierLink(
      on.openLinkUrl!.slice(on.openLinkUrl!.indexOf('#')),
    )!;
    expect(first.kind).toBe('open');
    expect(await ok(await pub('GET', `/offers/${first.token}`))).toEqual({
      organization: {name: h.org.name},
    });
    const stored = JSON.stringify(
      await h.db.query('SELECT * FROM offer_settings'),
    );
    expect(stored).not.toContain(first.token);
    // Changing only the notice does not show (or change) the link.
    const notice = await ok<OfferSettingsResponse>(
      await patch(admin, {version: 1, renewalNoticeDays: 90}),
    );
    expect(notice.openLinkUrl).toBeNull();
    expect((await pub('GET', `/offers/${first.token}`)).status).toBe(200);
    await errorOf(await patch(admin, {version: 1, renewalNoticeDays: 15}), 409);

    const sent = await pub(
      'POST',
      `/offers/${first.token}/proposal`,
      proposal({
        company: {
          name: 'Escenarios Nuevos',
          phone: '922111222',
          email: 'hola@escenarios.example.org',
        },
      }),
    );
    expect(sent.status).toBe(201);
    const [open] = (await proposals('pending')).filter(p => p.via === 'open');
    expect(open).toMatchObject({
      request: null,
      company: null,
      content: {company: {name: 'Escenarios Nuevos'}},
    });
    // Approving creates the company with the stated contact data.
    const approved = await approve(open!);
    const [created] = await h.db.query<{phone: string; email: string}>(
      'SELECT phone, email FROM companies WHERE id = $1',
      [approved.offers[0]!.company.id],
    );
    expect(created).toEqual({
      phone: '922111222',
      email: 'hola@escenarios.example.org',
    });

    const rotated = await ok<OfferSettingsResponse>(
      await patch(admin, {version: 2, rotateOpenLink: true}),
    );
    const second = parseSupplierLink(
      rotated.openLinkUrl!.slice(rotated.openLinkUrl!.indexOf('#')),
    )!;
    expect(second.token).not.toBe(first.token);
    await errorOf(await pub('GET', `/offers/${first.token}`), 404);
    expect((await pub('GET', `/offers/${second.token}`)).status).toBe(200);

    const off = await ok<OfferSettingsResponse>(
      await patch(admin, {version: 3, openLinkEnabled: false}),
    );
    expect(off.settings.openLink).toEqual({enabled: false, createdAt: null});
    await errorOf(await pub('GET', `/offers/${second.token}`), 404);
    await errorOf(
      await pub('POST', `/offers/${second.token}/proposal`, proposal()),
      404,
    );
    await errorOf(await patch(admin, {version: 4, rotateOpenLink: true}), 400);
  });
});

describe('expired offers are never compared as current', () => {
  it('past its deadline a version is «expired», kept out of the ranking, and gets no renewal', async () => {
    const short = await manual({
      proposal: proposal({
        company: {name: 'Lonas Rápidas'},
        acceptUntil: '2026-12-05',
      }),
    });
    const approved = await approve(short);
    const offerId = approved.offers[0]!.id;
    const need = {
      quantity: 3,
      days: 2,
      hoursPerDay: null,
      dateFrom: '2027-06-12',
      dateTo: '2027-06-13',
    };
    const compare = async () => {
      const versions = (
        await ok<ListResponse<OfferVersion>>(
          await h.request('GET', `/organizations/${h.org.id}/offer-versions`, {
            token: team,
          }),
        )
      ).items;
      const today = h.clock.now().toISOString().slice(0, 10);
      return {
        versions,
        result: compareNeed(
          versions.map(v => ({
            item: v.offerId,
            terms: v.terms,
            tax: v.terms.tax,
            pending: false,
          })),
          need,
          today,
        ),
      };
    };
    const before = await compare();
    expect(before.versions.find(v => v.offerId === offerId)?.status).toBe(
      'current',
    );
    expect(before.result.expired.map(r => r.item)).not.toContain(offerId);

    // Within the 30-day session, past the deadline.
    h.clock.advance(15 * 86_400_000);
    const after = await compare();
    expect(after.versions.find(v => v.offerId === offerId)?.status).toBe(
      'expired',
    );
    expect(after.result.expired.map(r => r.item)).toContain(offerId);
    expect(after.result.ranked.map(r => r.item)).not.toContain(offerId);

    await generateRenewals(h.db, h.clock.now());
    const renewals = (
      await ok<ListResponse<OfferRenewal>>(
        await h.request('GET', `/organizations/${h.org.id}/offer-renewals`, {
          token: team,
        }),
      )
    ).items;
    expect(renewals.some(r => r.offer.id === offerId)).toBe(false);
  });
});
