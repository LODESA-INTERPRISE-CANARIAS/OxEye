/**
 * Revisión 1 · E4, the UI side of roles and access (`src/logistics/account/
 * access.ts`): what the viewer may see and why not, the role line, the
 * entry points, the countdown and the indicative password strength.
 */
import {describe, expect, it} from 'vitest';
import type {
  Organization,
  SecurityEventKind,
  SessionUser,
} from '../../../shared/logistics/contracts';
import {
  NO_ACCESS,
  PROVISIONAL_HOLD,
  effectivePermissions,
} from '../../../shared/logistics/permissions';
import {
  SECURITY_LABEL,
  accessView,
  countdown,
  denial,
  offersUsers,
  orgPermissions,
  ownsAccountSpace,
  passwordStrength,
  roleSummary,
  secondsLeft,
} from '../../../src/logistics/account/access';

const user = (extra: Partial<SessionUser> = {}): SessionUser => ({
  id: 'u1',
  username: 'Dailos',
  displayName: 'Dailos',
  role: 'member',
  avatarId: null,
  accent: null,
  passwordProvisional: false,
  welcomed: true,
  support: null,
  ...extra,
});

const org = (
  roles: Organization['roles'],
  state = {provisional: false, support: false},
): Organization => ({
  id: 'o1',
  name: 'Ayuntamiento',
  timezone: 'Atlantic/Canary',
  acronym: null,
  version: 1,
  roles,
  permissions: effectivePermissions(roles, state),
});

describe('orgPermissions', () => {
  it('uses what the server sends', () => {
    expect(orgPermissions(org(['team']), 'member')).toEqual([
      'plan.edit',
      'directory.read',
    ]);
  });

  it('falls back for a server before E4: members edit, guests read', () => {
    const legacy = {permissions: undefined} as unknown as Organization;
    expect(orgPermissions(legacy, 'member')).toEqual([
      'plan.edit',
      'directory.read',
    ]);
    expect(orgPermissions(legacy, 'guest')).toEqual([]);
    expect(orgPermissions(null, null)).toEqual([]);
  });
});

describe('denial', () => {
  it('none when the viewer has it', () => {
    const view = accessView(user(), org(['team']));
    expect(denial(view, 'directory.read')).toBeNull();
  });

  it('«Sin acceso» with the reason for the guest', () => {
    const view = accessView(user({role: 'guest'}), org([]));
    expect(denial(view, 'directory.read')).toEqual({
      kind: 'none',
      message: NO_ACCESS['directory.read'],
    });
  });

  it('a provisional password asks for a new one instead', () => {
    const provisional = {provisional: true, support: false};
    const view = accessView(
      user({passwordProvisional: true}),
      org(['admin'], provisional),
    );
    expect(denial(view, 'users.manage')).toEqual({
      kind: 'held',
      message: PROVISIONAL_HOLD,
    });
    // Not sensitive: still there.
    expect(denial(view, 'plan.edit')).toBeNull();
    // A role that never gives it is a plain «Sin acceso».
    const team = accessView(
      user({passwordProvisional: true}),
      org(['team'], provisional),
    );
    expect(denial(team, 'users.manage')?.kind).toBe('none');
  });
});

describe('role line and entry points', () => {
  const support = {
    kind: 'support' as const,
    by: {id: 'u2', displayName: 'Elvis'},
    reason: 'No ve las tareas',
    endsAt: '2026-12-02T10:15:00.000Z',
  };

  it('names the roles, the guest and the sessions on behalf of someone', () => {
    expect(roleSummary(accessView(user(), org(['admin', 'developer'])))).toBe(
      'Administración · Desarrollo',
    );
    expect(roleSummary(accessView(user(), org(['team'])))).toBe('Equipo');
    expect(roleSummary(accessView(user({role: 'guest'}), org([])))).toBe(
      'Invitado · solo lectura',
    );
    expect(roleSummary(accessView(user({support}), org(['team'])))).toBe(
      'Sesión de soporte',
    );
    expect(
      roleSummary(
        accessView(
          user({role: 'guest', support: {...support, kind: 'view_as_guest'}}),
          org([]),
        ),
      ),
    ).toBe('Vista como Invitado');
  });

  it('no roles is never read as «Equipo»', () => {
    expect(roleSummary(accessView(user(), org([])))).toBe('Sin rol asignado');
    const legacy = {
      ...org(['admin']),
      roles: undefined,
    } as unknown as Organization;
    expect(roleSummary(accessView(user(), legacy))).toBe('Miembro');
  });

  it('shared accounts: the guest, and «Equipo» everywhere it is a member', () => {
    expect(accessView(user({role: 'guest'}), org([])).shared).toBe(true);
    expect(accessView(user(), org(['team'])).shared).toBe(true);
    expect(accessView(user(), org(['admin'])).shared).toBe(false);
    // Team here but administration in another organization: personal.
    const here = org(['team']);
    const there = {...org(['admin']), id: 'o2'};
    expect(accessView(user(), here, [here, there]).shared).toBe(false);
    // A server before E4 sends no roles: not assumed shared.
    const legacy = {
      ...org(['team']),
      roles: undefined,
    } as unknown as Organization;
    expect(accessView(user(), legacy).shared).toBe(false);
  });

  it('own space for members only, never during a support session', () => {
    expect(ownsAccountSpace(accessView(user(), org(['team'])))).toBe(true);
    expect(ownsAccountSpace(accessView(user({role: 'guest'}), org([])))).toBe(
      false,
    );
    expect(ownsAccountSpace(accessView(user({support}), org(['team'])))).toBe(
      false,
    );
  });

  it('«Usuarios» when allowed or held by the provisional password', () => {
    expect(offersUsers(accessView(user(), org(['admin'])))).toBe(true);
    expect(offersUsers(accessView(user(), org(['team'])))).toBe(false);
    expect(
      offersUsers(
        accessView(
          user({passwordProvisional: true}),
          org(['developer'], {provisional: true, support: false}),
        ),
      ),
    ).toBe(true);
    expect(
      offersUsers(
        accessView(
          user({support}),
          org(['admin'], {provisional: false, support: true}),
        ),
      ),
    ).toBe(false);
  });
});

describe('countdown', () => {
  const now = Date.parse('2026-12-02T10:00:00.000Z');
  it('seconds left, never negative', () => {
    expect(secondsLeft('2026-12-02T10:14:05.000Z', now)).toBe(845);
    expect(secondsLeft('2026-12-02T09:59:00.000Z', now)).toBe(0);
    expect(secondsLeft('no es una fecha', now)).toBe(0);
  });

  it('minutes and seconds', () => {
    expect(countdown(845)).toBe('14:05');
    expect(countdown(9)).toBe('0:09');
  });
});

describe('passwordStrength (indicative)', () => {
  it('short passwords are at most «Muy débil» and say how many are missing', () => {
    const s = passwordStrength('abc');
    expect(s.level).toBe(0);
    expect(s.tip).toBe('Faltan 7 caracteres.');
  });

  it('length counts most', () => {
    const ten = passwordStrength('montaje26x');
    const long = passwordStrength('carpas de la plaza del cristo');
    expect(long.level).toBeGreaterThan(ten.level);
    expect(long.level).toBeGreaterThanOrEqual(3);
  });

  it('repeats, sequences and the username weaken it', () => {
    expect(passwordStrength('aaaaaaaaaaaaaaaa').level).toBe(0);
    expect(passwordStrength('1234567890abcdefg').level).toBeLessThan(2);
    const withName = passwordStrength('dailos-montaje-2026', 'Dailos');
    expect(withName.tip).toContain('nombre de usuario');
  });

  it('empty is not judged', () => {
    expect(passwordStrength('')).toEqual({
      level: 0,
      label: 'Muy débil',
      tip: null,
    });
  });
});

describe('security labels', () => {
  it('every kind has a Spanish line', () => {
    const kinds: SecurityEventKind[] = [
      'login',
      'login_failed',
      'logout',
      'password_changed',
      'password_provisional_set',
      'recovery_requested',
      'reset_link_created',
      'password_reset',
      'email_requested',
      'email_verified',
      'email_removed',
      'sessions_revoked',
      'support_started',
      'support_ended',
      'view_as_guest',
      'roles_changed',
      'profile_changed',
    ];
    for (const k of kinds) expect(SECURITY_LABEL[k]).toMatch(/\S/);
  });
});
