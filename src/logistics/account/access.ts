/**
 * Revisión 1 · E4, UI side of roles and personal access. Pure: what the
 * viewer may see and why not, labels for the security log, and an
 * indicative password-strength hint. The server enforces every permission;
 * these only decide what to show.
 */
import type {
  Organization,
  OrgRole,
  Permission,
  Role,
  SecurityEventKind,
  SessionUser,
} from '../../../shared/logistics/contracts.ts';
import {
  can,
  heldByProvisional,
  isSharedAccount,
  NO_ACCESS,
  PROVISIONAL_HOLD,
  ROLE_LABEL,
} from '../../../shared/logistics/permissions.ts';
import {PASSWORD_MIN} from '../../../shared/logistics/account.ts';

/** What a pre-E4 server implied: members edit and read the directory. */
const LEGACY_MEMBER: readonly Permission[] = ['plan.edit', 'directory.read'];

/**
 * The viewer's permissions in an organization. A server not yet on E4 sends
 * none: members then keep what they had (edit and directory), guests read.
 */
export function orgPermissions(
  org: Pick<Organization, 'permissions'> | null | undefined,
  role: Role | null | undefined,
): readonly Permission[] {
  if (org && Array.isArray(org.permissions)) return org.permissions;
  return role === 'member' ? LEGACY_MEMBER : [];
}

export function orgRoles(
  org: Pick<Organization, 'roles'> | null | undefined,
): readonly OrgRole[] {
  return org && Array.isArray(org.roles) ? org.roles : [];
}

export interface AccessView {
  permissions: readonly Permission[];
  roles: readonly OrgRole[];
  /** False when the server sent no roles (not yet on E4). */
  rolesKnown: boolean;
  role: Role | null;
  provisional: boolean;
  /**
   * A shared account (Invitado, or «Equipo»: no administration or
   * development role anywhere), used by several people: its password, name
   * and photo are set by administration, never from the account itself.
   */
  shared: boolean;
  /** A support session or «Ver como Invitado» is running. */
  support: SessionUser['support'];
}

/**
 * `organizations`: all of the viewer's organizations (a shared account has
 * no administration or development role in any of them); defaults to `org`.
 */
export function accessView(
  user: SessionUser | null | undefined,
  org: Organization | null | undefined,
  organizations: readonly Organization[] = org ? [org] : [],
): AccessView {
  const role = user?.role ?? null;
  const known = organizations.filter(o => Array.isArray(o.roles));
  return {
    permissions: orgPermissions(org, user?.role),
    roles: orgRoles(org),
    rolesKnown: !!org && Array.isArray(org.roles),
    role,
    // `=== true`: a pre-E4 server sends nothing, which is not provisional.
    provisional: user?.passwordProvisional === true,
    // Without roles from the server (pre-E4) only the guest is known shared.
    shared:
      role === 'guest' ||
      (role === 'member' &&
        known.length > 0 &&
        isSharedAccount(
          role,
          known.map(o => o.roles),
        )),
    support: user?.support ?? null,
  };
}

/**
 * Why a permission is missing: `held` when only the provisional password
 * stands in the way (the UI asks for a new one), `none` otherwise.
 */
export type Denial = {kind: 'held' | 'none'; message: string};

export function denial(
  view: AccessView,
  permission: Permission,
): Denial | null {
  if (can(view.permissions, permission)) return null;
  if (view.provisional && heldByProvisional(view.roles, permission)) {
    return {kind: 'held', message: PROVISIONAL_HOLD};
  }
  return {kind: 'none', message: NO_ACCESS[permission]};
}

/** «Administración · Desarrollo», «Invitado · solo lectura», «Soporte»… */
export function roleSummary(view: AccessView): string {
  if (view.support?.kind === 'view_as_guest') return 'Vista como Invitado';
  if (view.support) return 'Sesión de soporte';
  if (view.role === 'guest') return 'Invitado · solo lectura';
  if (view.roles.length > 0) {
    return view.roles.map(r => ROLE_LABEL[r]).join(' · ');
  }
  // No roles is not «Equipo» (the team role): say what is known.
  return view.rolesKnown ? 'Sin rol asignado' : 'Miembro';
}

/** The own account may be edited (profile, password, e-mail, photo). */
export function ownsAccountSpace(view: AccessView): boolean {
  return view.role === 'member' && !view.support;
}

/**
 * «Usuarios» is offered when the viewer may manage users, or would but for
 * the provisional password (the sheet then asks for a new one).
 */
export function offersUsers(view: AccessView): boolean {
  if (view.support) return false;
  return (
    can(view.permissions, 'users.manage') ||
    (view.provisional && heldByProvisional(view.roles, 'users.manage'))
  );
}

/** Seconds left until `endsAt`, never negative. */
export function secondsLeft(endsAt: string, now: number = Date.now()): number {
  const end = Date.parse(endsAt);
  if (Number.isNaN(end)) return 0;
  return Math.max(0, Math.ceil((end - now) / 1000));
}

/** «14:05» (minutes and seconds) for a countdown. */
export function countdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** One line per security-log entry, in plain Spanish. */
export const SECURITY_LABEL: Record<SecurityEventKind, string> = {
  login: 'Entrada en el Gestor',
  login_failed: 'Intento de entrada fallido',
  logout: 'Salida del Gestor',
  password_changed: 'Contraseña cambiada',
  password_provisional_set: 'Contraseña provisional puesta',
  recovery_requested: 'Recuperación de contraseña pedida',
  reset_link_created: 'Enlace de restablecimiento creado',
  password_reset: 'Contraseña restablecida con un enlace',
  email_requested: 'Correo de recuperación pendiente de verificar',
  email_verified: 'Correo de recuperación verificado',
  email_removed: 'Correo de recuperación quitado',
  sessions_revoked: 'Sesiones cerradas',
  support_started: 'Sesión de soporte iniciada',
  support_ended: 'Sesión de soporte terminada',
  view_as_guest: 'Vista como Invitado',
  roles_changed: 'Roles cambiados',
  profile_changed: 'Perfil cambiado',
};

/** Entries worth a second look (shown with the warning tone). */
export const SECURITY_ALERT: ReadonlySet<SecurityEventKind> = new Set([
  'login_failed',
  'password_provisional_set',
  'reset_link_created',
  'support_started',
]);

export type StrengthLevel = 0 | 1 | 2 | 3 | 4;

export interface Strength {
  level: StrengthLevel;
  label: string;
  /** What would make it better, or null when nothing obvious. */
  tip: string | null;
}

const STRENGTH_LABEL: Record<StrengthLevel, string> = {
  0: 'Muy débil',
  1: 'Débil',
  2: 'Aceptable',
  3: 'Buena',
  4: 'Muy buena',
};

/**
 * Indicative strength of a new password: length first, then variety. A
 * hint to help choose, not a guarantee; the hard rules are in
 * `passwordProblem` (shared with the server).
 */
export function passwordStrength(password: string, username = ''): Strength {
  const chars = [...password];
  const length = chars.length;
  if (length === 0) return {level: 0, label: STRENGTH_LABEL[0], tip: null};
  const lower = password.toLowerCase();
  const name = username.trim().toLowerCase();
  const classes = [/[a-zñáéíóúü]/, /[A-ZÑÁÉÍÓÚÜ]/, /\d/, /[^\p{L}\d]/u].filter(
    re => re.test(password),
  ).length;
  const distinct = new Set(chars.map(c => c.toLowerCase())).size;

  let score = 0;
  if (length >= PASSWORD_MIN) score += 1;
  if (length >= 14) score += 1;
  if (length >= 20) score += 1;
  if (classes >= 3) score += 1;
  if (distinct < Math.min(6, length)) score -= 2;
  if (name && name.length >= 3 && lower.includes(name)) score -= 1;
  if (/^(.)\1+$/.test(password) || /^(0123|1234|abcd|qwer)/i.test(password)) {
    score -= 2;
  }
  if (length < PASSWORD_MIN) score = Math.min(score, 0);
  const level = Math.max(0, Math.min(4, score)) as StrengthLevel;

  let tip: string | null = null;
  if (length < PASSWORD_MIN) {
    tip = `Faltan ${PASSWORD_MIN - length} caracteres.`;
  } else if (name && name.length >= 3 && lower.includes(name)) {
    tip = 'Evita tu nombre de usuario dentro de la contraseña.';
  } else if (level < 3) {
    tip = 'Más larga es mejor: prueba con tres o cuatro palabras sueltas.';
  }
  return {level, label: STRENGTH_LABEL[level], tip};
}
