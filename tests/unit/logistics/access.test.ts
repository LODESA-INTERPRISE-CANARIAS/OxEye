/**
 * Revisión 1 · E4: the pure rules behind roles and personal access, shared
 * by the server and the UI.
 */
import {describe, expect, it} from 'vitest';
import {
  accountLinkHash,
  deviceLabel,
  isEmailAddress,
  maskEmail,
  parseAccountLink,
  passwordProblem,
} from '../../../shared/logistics/account';
import {
  can,
  effectivePermissions,
  heldByProvisional,
  isSharedAccount,
  normalizeRoles,
  NO_ACCESS,
  PERMISSIONS,
  rolePermissions,
  SENSITIVE_PERMISSIONS,
} from '../../../shared/logistics/permissions';

const open = {provisional: false, support: false};

describe('roles add up to permissions', () => {
  it('team edits the plan and reads the directory, nothing sensitive', () => {
    expect(effectivePermissions(['team'], open)).toEqual([
      'plan.edit',
      'directory.read',
    ]);
  });

  it('admin and developer combine without repeats, in a fixed order', () => {
    expect(effectivePermissions(['developer', 'admin'], open)).toEqual([
      ...PERMISSIONS,
    ]);
    expect(rolePermissions(['developer'])).not.toContain('budget.edit');
    expect(rolePermissions(['developer'])).not.toContain('support.start');
    expect(rolePermissions(['admin'])).not.toContain('diagnostics.read');
  });

  it('no role means read-only', () => {
    expect(effectivePermissions([], open)).toEqual([]);
    expect(can([], 'plan.edit')).toBe(false);
  });

  it('normalizeRoles keeps known roles once, in order', () => {
    expect(normalizeRoles(['team', 'owner', 'admin', 'team', 3])).toEqual([
      'admin',
      'team',
    ]);
  });
});

describe('a provisional password holds back the sensitive permissions', () => {
  it('keeps the everyday ones', () => {
    expect(
      effectivePermissions(['admin', 'developer'], {
        provisional: true,
        support: false,
      }),
    ).toEqual(['plan.edit', 'directory.read', 'view_as_guest']);
  });

  it('heldByProvisional tells «change your password» from «no access»', () => {
    for (const p of SENSITIVE_PERMISSIONS) {
      expect(heldByProvisional(['admin', 'developer'], p), p).toBe(true);
    }
    expect(heldByProvisional(['team'], 'budget.read')).toBe(false);
    expect(heldByProvisional(['admin'], 'plan.edit')).toBe(false);
  });

  it('a support session never manages people, opens support or views as guest', () => {
    expect(
      effectivePermissions(['admin', 'developer'], {
        provisional: false,
        support: true,
      }),
    ).toEqual([
      'plan.edit',
      'directory.read',
      'budget.read',
      'budget.edit',
      'offers.approve',
    ]);
  });

  it('every permission has a plain Spanish «Sin acceso» message', () => {
    for (const p of PERMISSIONS) expect(NO_ACCESS[p]).toMatch(/\.$/);
  });
});

describe('shared accounts', () => {
  it('the guest account and team-only members are shared', () => {
    expect(isSharedAccount('guest', [])).toBe(true);
    expect(isSharedAccount('member', [['team']])).toBe(true);
    expect(isSharedAccount('member', [])).toBe(true);
    expect(isSharedAccount('member', [['team'], ['developer']])).toBe(false);
    expect(isSharedAccount('member', [['admin']])).toBe(false);
  });
});

describe('passwords', () => {
  it('at least 10 characters, at most 200, not the username', () => {
    expect(passwordProblem('corta', 'Elvis')).toMatch(/al menos 10/);
    expect(passwordProblem('x'.repeat(201), 'Elvis')).toMatch(/como máximo/);
    expect(passwordProblem('  fabiangl1 ', 'FabianGL1')).toMatch(
      /nombre de usuario/,
    );
    expect(passwordProblem('una frase larga', 'Elvis')).toBeNull();
  });

  it('counts characters, not UTF-16 units', () => {
    expect(passwordProblem('ñ'.repeat(10), 'Elvis')).toBeNull();
    expect(passwordProblem('🙂'.repeat(9), 'Elvis')).toMatch(/al menos 10/);
  });
});

describe('e-mail addresses', () => {
  it('a loose shape check', () => {
    expect(isEmailAddress('persona@example.org')).toBe(true);
    for (const bad of ['persona', 'a@b', 'a b@example.org', '@example.org']) {
      expect(isEmailAddress(bad), bad).toBe(false);
    }
  });

  it('a masked address keeps only the first letter and the domain', () => {
    expect(maskEmail('yeray.personal@example.org')).toBe('y•••@example.org');
    expect(maskEmail('ñu@example.org')).toBe('ñ•••@example.org');
    expect(maskEmail('roto')).toBe('•••');
  });
});

describe('account links', () => {
  const token = 'A'.repeat(20) + '_-' + 'z'.repeat(21);

  it('round-trip through the address fragment', () => {
    expect(accountLinkHash('reset', token)).toBe(
      `#logistica/cuenta/restablecer/${token}`,
    );
    expect(parseAccountLink(accountLinkHash('reset', token))).toEqual({
      purpose: 'reset',
      token,
    });
    expect(parseAccountLink(accountLinkHash('verify', token))).toEqual({
      purpose: 'verify',
      token,
    });
  });

  it('reject anything else', () => {
    expect(parseAccountLink('#logistica/cuenta/restablecer/corto')).toBeNull();
    expect(parseAccountLink(`#logistica/cuenta/borrar/${token}`)).toBeNull();
    expect(parseAccountLink('#logistica/hoy')).toBeNull();
  });
});

describe('device labels', () => {
  it('keeps the browser family and the system only', () => {
    const cases: [string, string | null][] = [
      [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
        'Chrome · Windows',
      ],
      [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 Edg/131.0',
        'Edge · Windows',
      ],
      [
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
        'Safari · iPhone',
      ],
      [
        'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36',
        'Samsung Internet · Android',
      ],
      [
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:132.0) Gecko/20100101 Firefox/132.0',
        'Firefox · macOS',
      ],
      ['curl/8.5.0', null],
      ['', null],
    ];
    for (const [ua, label] of cases) expect(deviceLabel(ua), ua).toBe(label);
    expect(deviceLabel(null)).toBeNull();
  });
});
