import {describe, expect, it} from 'vitest';
import {
  generatePassword,
  hashPassword,
  verifyPassword,
} from '../src/auth/password.ts';
import {bearerToken} from '../src/auth/middleware.ts';
import {createRateLimiter} from '../src/auth/rate-limit.ts';
import {ConfigError, loadConfig, parseOrigins} from '../src/config.ts';
import {resolveClientIp} from '../src/http/client-ip.ts';
import {
  changedEventFields,
  END_DATE_NOT_AFTER,
  END_DATE_WITHOUT_DATE,
  resolveSlot,
  storedToLocal,
  TIME_WITHOUT_DATE,
} from '../src/events/domain.ts';
import type {EventState} from '../src/events/domain.ts';
import {
  changedTaskFields,
  DEPENDS_ON_SELF,
  DEPENDS_ON_UNKNOWN,
  dependencyProblem,
  normalizeIds,
} from '../src/tasks/domain.ts';
import type {TaskState} from '../src/tasks/domain.ts';
import {normalizeName} from '../src/venues/service.ts';

const TZ = 'Atlantic/Canary';

describe('events domain · resolveSlot', () => {
  it('keeps everything null when nothing is known', () => {
    expect(resolveSlot({}, null, TZ)).toEqual({
      ok: true,
      slot: {localDate: null, endDate: null, startsAt: null, endsAt: null},
    });
  });

  it('keeps a date without times', () => {
    expect(resolveSlot({date: '2026-12-02'}, null, TZ)).toEqual({
      ok: true,
      slot: {
        localDate: '2026-12-02',
        endDate: null,
        startsAt: null,
        endsAt: null,
      },
    });
  });

  it('refuses a time without a date', () => {
    expect(resolveSlot({endTime: '10:00'}, null, TZ)).toEqual({
      ok: false,
      fields: {date: TIME_WITHOUT_DATE},
    });
  });

  it('merges a partial edit with the current slot', () => {
    const current = {
      date: '2026-12-02',
      endDate: null,
      startTime: '09:00',
      endTime: '14:00',
    };
    const r = resolveSlot({startTime: '10:30'}, current, TZ);
    expect(r).toEqual({
      ok: true,
      slot: {
        localDate: '2026-12-02',
        endDate: null,
        startsAt: '2026-12-02T10:30:00.000Z',
        endsAt: '2026-12-02T14:00:00.000Z',
      },
    });
  });

  it('moving the date moves both times, across a DST change', () => {
    const current = {
      date: '2026-03-28',
      endDate: null,
      startTime: '09:00',
      endTime: '14:00',
    };
    // 29 March 2026: Canary summer time starts (UTC+1).
    const r = resolveSlot({date: '2026-03-30'}, current, TZ);
    expect(r).toEqual({
      ok: true,
      slot: {
        localDate: '2026-03-30',
        endDate: null,
        startsAt: '2026-03-30T08:00:00.000Z',
        endsAt: '2026-03-30T13:00:00.000Z',
      },
    });
  });

  it('clearing the date clears the times unless new ones are given', () => {
    const current = {
      date: '2026-12-02',
      endDate: null,
      startTime: '09:00',
      endTime: null,
    };
    expect(resolveSlot({date: null}, current, TZ)).toEqual({
      ok: true,
      slot: {localDate: null, endDate: null, startsAt: null, endsAt: null},
    });
    expect(resolveSlot({date: null, startTime: '09:00'}, current, TZ)).toEqual({
      ok: false,
      fields: {date: TIME_WITHOUT_DATE},
    });
  });

  it('reads the stored slot back as local values, overnight included', () => {
    expect(
      storedToLocal(
        {
          localDate: '2026-12-05',
          endDate: null,
          startsAt: '2026-12-05T22:00:00.000Z',
          endsAt: '2026-12-06T02:00:00.000Z',
        },
        TZ,
      ),
    ).toEqual({
      date: '2026-12-05',
      endDate: null,
      startTime: '22:00',
      endTime: '02:00',
    });
  });
});

describe('slot · multi-day', () => {
  const none = {date: null, endDate: null, startTime: null, endTime: null};

  it('puts the end time on the end date', () => {
    expect(
      resolveSlot(
        {
          date: '2026-12-01',
          endDate: '2026-12-03',
          startTime: '18:00',
          endTime: '02:00',
        },
        null,
        TZ,
      ),
    ).toEqual({
      ok: true,
      slot: {
        localDate: '2026-12-01',
        endDate: '2026-12-03',
        startsAt: '2026-12-01T18:00:00.000Z',
        endsAt: '2026-12-03T02:00:00.000Z',
      },
    });
  });

  it('requires a start date and an end date after it', () => {
    expect(resolveSlot({endDate: '2026-12-03'}, null, TZ)).toEqual({
      ok: false,
      fields: {endDate: END_DATE_WITHOUT_DATE},
    });
    for (const endDate of ['2026-12-02', '2026-12-01']) {
      expect(resolveSlot({date: '2026-12-02', endDate}, none, TZ)).toEqual({
        ok: false,
        fields: {endDate: END_DATE_NOT_AFTER},
      });
    }
    const far = resolveSlot(
      {date: '2026-12-02', endDate: '2027-12-04'},
      null,
      TZ,
    );
    expect(far.ok).toBe(false);
    if (!far.ok) expect(far.fields.endDate).toMatch(/Como máximo 366 días/);
  });

  it('keeps the end date when only the start moves, and checks it again', () => {
    const current = {
      date: '2026-12-01',
      endDate: '2026-12-03',
      startTime: '09:00',
      endTime: '14:00',
    };
    const moved = resolveSlot({date: '2026-12-02'}, current, TZ);
    expect(moved).toMatchObject({
      ok: true,
      slot: {endDate: '2026-12-03', endsAt: '2026-12-03T14:00:00.000Z'},
    });
    expect(resolveSlot({date: '2026-12-03'}, current, TZ)).toEqual({
      ok: false,
      fields: {endDate: END_DATE_NOT_AFTER},
    });
  });

  it('clearing the date clears the end date; clearing the end date keeps the day', () => {
    const current = {
      date: '2026-12-01',
      endDate: '2026-12-03',
      startTime: '09:00',
      endTime: '14:00',
    };
    expect(resolveSlot({date: null}, current, TZ)).toEqual({
      ok: true,
      slot: {localDate: null, endDate: null, startsAt: null, endsAt: null},
    });
    expect(resolveSlot({endDate: null}, current, TZ)).toEqual({
      ok: true,
      slot: {
        localDate: '2026-12-01',
        endDate: null,
        startsAt: '2026-12-01T09:00:00.000Z',
        endsAt: '2026-12-01T14:00:00.000Z',
      },
    });
  });
});

describe('tasks domain · dependencies', () => {
  const graph = [
    {id: 'a', title: 'Entrega', dependsOn: []},
    {id: 'b', title: 'Montaje', dependsOn: ['a']},
    {id: 'c', title: 'Prueba', dependsOn: ['b']},
  ];

  it('accepts a valid predecessor list, and any list for a new task', () => {
    expect(dependencyProblem('c', ['a', 'b'], graph)).toBeNull();
    expect(dependencyProblem(null, ['c'], graph)).toBeNull();
    expect(dependencyProblem('a', [], graph)).toBeNull();
  });

  it('rejects self reference and unknown tasks', () => {
    expect(dependencyProblem('a', ['a'], graph)).toBe(DEPENDS_ON_SELF);
    expect(dependencyProblem('a', ['zzz'], graph)).toBe(DEPENDS_ON_UNKNOWN);
    expect(dependencyProblem(null, ['zzz'], graph)).toBe(DEPENDS_ON_UNKNOWN);
  });

  it('rejects cycles and names the tasks involved', () => {
    const msg = dependencyProblem('a', ['c'], graph);
    expect(msg).toMatch(/ciclo/);
    expect(msg).toContain('«Entrega»');
    expect(msg).toContain('«Montaje»');
    expect(msg).toContain('«Prueba»');
  });

  it('normalizes id lists', () => {
    expect(normalizeIds(['B', 'a', 'b'])).toEqual(['a', 'b']);
  });

  it('lists changed task fields in contract names, dependsOn compared as a list', () => {
    const base: TaskState = {
      title: 'Montaje',
      kind: 'assembly',
      status: 'planned',
      eventId: null,
      venueId: null,
      companyId: null,
      localDate: null,
      endDate: null,
      startsAt: null,
      endsAt: null,
      timezone: TZ,
      dependsOn: ['a'],
      heavyLoad: null,
      notes: null,
      source: null,
      verification: 'draft',
    };
    expect(changedTaskFields(base, {...base, dependsOn: ['a']})).toEqual([]);
    expect(
      changedTaskFields(base, {
        ...base,
        dependsOn: ['a', 'b'],
        heavyLoad: false,
        companyId: 'x',
      }),
    ).toEqual(['company', 'dependsOn', 'heavyLoad']);
  });
});

describe('events domain · changedEventFields', () => {
  const base: EventState = {
    name: 'A',
    venueId: null,
    localDate: '2026-12-02',
    endDate: null,
    startsAt: '2026-12-02T09:00:00.000Z',
    endsAt: null,
    status: 'planned',
    notes: null,
    source: null,
    verification: 'draft',
  };

  it('lists changed contract fields in a stable order', () => {
    expect(
      changedEventFields(base, {
        ...base,
        verification: 'validated',
        name: 'B',
        venueId: 'v1',
      }),
    ).toEqual(['name', 'venue', 'verification']);
  });

  it('treats equal instants in different text forms as unchanged', () => {
    expect(
      changedEventFields(base, {...base, startsAt: '2026-12-02T09:00:00Z'}),
    ).toEqual([]);
  });
});

describe('passwords', () => {
  it('hashes with a random salt and verifies', async () => {
    const a = await hashPassword('k7mq-x2fd-9hta');
    const b = await hashPassword('k7mq-x2fd-9hta');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(await verifyPassword('k7mq-x2fd-9hta', a)).toBe(true);
    expect(await verifyPassword('k7mq-x2fd-9htb', a)).toBe(false);
    expect(await verifyPassword('x', 'garbage')).toBe(false);
  });

  it('generates readable passwords', () => {
    const p = generatePassword();
    expect(p).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
    expect(p).not.toMatch(/[01ilo]/);
    expect(generatePassword()).not.toBe(p);
  });
});

describe('rate limiter', () => {
  it('blocks after max failures inside the window and frees the key later', () => {
    let t = 0;
    const rl = createRateLimiter({max: 3, windowMs: 1000, now: () => t});
    rl.hit('k');
    t = 100;
    rl.hit('k');
    expect(rl.retryAfter('k')).toBe(0);
    t = 200;
    rl.hit('k');
    expect(rl.retryAfter('k')).toBe(1);
    t = 1001; // first failure left the window
    expect(rl.retryAfter('k')).toBe(0);
    rl.reset('k');
    expect(rl.retryAfter('k')).toBe(0);
  });

  it('refunds exactly one recorded attempt', () => {
    const t = 0;
    const rl = createRateLimiter({max: 2, windowMs: 1000, now: () => t});
    const a = rl.hit('k');
    rl.hit('k');
    expect(rl.retryAfter('k')).toBe(1);
    rl.refund('k', a);
    expect(rl.retryAfter('k')).toBe(0);
    rl.refund('k', a);
    rl.refund('k', a); // nothing left to refund: no-op
    rl.refund('other', a);
    expect(rl.retryAfter('k')).toBe(0);
    rl.hit('k');
    rl.hit('k');
    expect(rl.retryAfter('k')).toBe(1);
  });
});

describe('client IP', () => {
  it('ignores X-Forwarded-For when no proxy is trusted', () => {
    expect(resolveClientIp('1.1.1.1', '10.0.0.5', 0)).toBe('10.0.0.5');
  });

  it('takes the entry added by the trusted proxy, not the spoofed ones', () => {
    // nginx $proxy_add_x_forwarded_for appends the real peer to whatever the
    // client sent.
    expect(
      resolveClientIp('6.6.6.6, 7.7.7.7, 203.0.113.9', '172.17.0.1', 1),
    ).toBe('203.0.113.9');
    expect(resolveClientIp('203.0.113.9', '172.17.0.1', 1)).toBe('203.0.113.9');
  });

  it('counts hops from the right', () => {
    const xff = '6.6.6.6, 203.0.113.9, 10.0.0.2';
    expect(resolveClientIp(xff, '10.0.0.3', 2)).toBe('203.0.113.9');
    expect(resolveClientIp(xff, '10.0.0.3', 3)).toBe('6.6.6.6');
  });

  it('falls back to the socket address when the header is missing or short', () => {
    expect(resolveClientIp(undefined, '10.0.0.5', 1)).toBe('10.0.0.5');
    expect(resolveClientIp('', '10.0.0.5', 1)).toBe('10.0.0.5');
    expect(resolveClientIp(' , ', '10.0.0.5', 1)).toBe('10.0.0.5');
    expect(resolveClientIp('203.0.113.9', '10.0.0.5', 2)).toBe('10.0.0.5');
    expect(resolveClientIp(undefined, undefined, 1)).toBe('unknown');
  });
});

describe('config', () => {
  const env = {DATABASE_URL: 'postgres://u:p@localhost:5433/db'};

  it('applies defaults', () => {
    expect(loadConfig(env)).toEqual({
      databaseUrl: env.DATABASE_URL,
      host: '0.0.0.0',
      port: 8787,
      corsOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173'],
      sessionDays: 30,
      nodeEnv: 'development',
      migrateOnStart: false,
      trustProxyHops: 0,
    });
  });

  it('reads TRUST_PROXY as a number of proxies, with true meaning one', () => {
    const hops = (v: string) =>
      loadConfig({...env, TRUST_PROXY: v}).trustProxyHops;
    expect(hops('')).toBe(0);
    expect(hops('false')).toBe(0);
    expect(hops('0')).toBe(0);
    expect(hops('true')).toBe(1);
    expect(hops('1')).toBe(1);
    expect(hops(' 2 ')).toBe(2);
    expect(() => hops('yes')).toThrow(/TRUST_PROXY/);
    expect(() => hops('-1')).toThrow(/TRUST_PROXY/);
    expect(() => hops('1.5')).toThrow(/TRUST_PROXY/);
    expect(() => hops('6')).toThrow(/TRUST_PROXY/);
  });

  it('has no CORS origins by default in production', () => {
    expect(loadConfig({...env, NODE_ENV: 'production'}).corsOrigins).toEqual(
      [],
    );
  });

  it('parses explicit values', () => {
    const c = loadConfig({
      ...env,
      PORT: '9000',
      CORS_ORIGINS: 'https://a.example.org, https://b.example.org/',
      SESSION_DAYS: '7',
      MIGRATE_ON_START: 'true',
    });
    expect(c.port).toBe(9000);
    expect(c.corsOrigins).toEqual([
      'https://a.example.org',
      'https://b.example.org',
    ]);
    expect(c.sessionDays).toBe(7);
    expect(c.migrateOnStart).toBe(true);
  });

  it('fails clearly without DATABASE_URL and refuses wildcard origins', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => parseOrigins('*')).toThrow(ConfigError);
    expect(() => loadConfig({...env, PORT: 'abc'})).toThrow(/PORT/);
  });
});

describe('small helpers', () => {
  it('parses bearer tokens', () => {
    expect(bearerToken('Bearer abc')).toBe('abc');
    expect(bearerToken('bearer   abc ')).toBe('abc');
    expect(bearerToken('Basic abc')).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
  });

  it('normalizes venue names', () => {
    expect(normalizeName('  Plaza   del  Cristo ')).toBe('Plaza del Cristo');
    expect(normalizeName('   ')).toBeNull();
    expect(normalizeName(null)).toBeNull();
  });
});
