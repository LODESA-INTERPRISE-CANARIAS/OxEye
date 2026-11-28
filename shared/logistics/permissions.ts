/**
 * Roles and permissions (Revisión 1 · E4). Pure: the server enforces these
 * sets on every route and the UI uses the same ones to decide what to show,
 * so they never disagree.
 *
 * Roles belong to a membership (one account may hold several in one
 * organization, and they add up). The shared guest account («Invitado») is
 * an account kind (`Role` 'guest'), not an organization role: it holds no
 * roles and only reads.
 *
 * Two things take permissions away from what the roles give:
 * - a provisional password (set by someone else) withholds the sensitive
 *   ones until its owner replaces it;
 * - a support session (an administrator acting on someone's account) never
 *   carries account administration, whoever the account is.
 */
import type {OrgRole, Permission, Role} from './contracts.ts';

/** Every permission, in a stable order (lists are returned in this order). */
export const PERMISSIONS = [
  'plan.edit',
  'directory.read',
  'budget.read',
  'budget.edit',
  'offers.approve',
  'users.manage',
  'support.start',
  'view_as_guest',
  'diagnostics.read',
] as const satisfies readonly Permission[];

export const ORG_ROLES = [
  'admin',
  'developer',
  'team',
] as const satisfies readonly OrgRole[];

/** Spanish names for the UI. */
export const ROLE_LABEL: Record<OrgRole, string> = {
  admin: 'Administración',
  developer: 'Desarrollo',
  team: 'Equipo',
};

/**
 * What each role gives. The developer role sees budgets (a separate
 * permission, easy to withdraw) and helps people get back in (provisional
 * passwords and reset links through `users.manage`), but only
 * administrators change roles, approve offers or open support sessions.
 * A developer account always holds `admin` too (see `isDeveloper`), so in
 * practice it has everything; `developer` adds the diagnostics.
 */
export const ROLE_PERMISSIONS: Record<OrgRole, readonly Permission[]> = {
  admin: [
    'plan.edit',
    'directory.read',
    'budget.read',
    'budget.edit',
    'offers.approve',
    'users.manage',
    'support.start',
    'view_as_guest',
  ],
  developer: [
    'plan.edit',
    'directory.read',
    'budget.read',
    'users.manage',
    'view_as_guest',
    'diagnostics.read',
  ],
  team: ['plan.edit', 'directory.read'],
};

/** Withheld while the password is provisional. */
export const SENSITIVE_PERMISSIONS = [
  'budget.read',
  'budget.edit',
  'offers.approve',
  'users.manage',
  'support.start',
  'diagnostics.read',
] as const satisfies readonly Permission[];

/** Never carried by a support session. */
export const SUPPORT_WITHHELD = [
  'users.manage',
  'support.start',
  'view_as_guest',
  'diagnostics.read',
] as const satisfies readonly Permission[];

export interface PermissionState {
  /** The account's password was set by someone else. */
  provisional: boolean;
  /** This session is a support session. */
  support: boolean;
}

export function isOrgRole(value: unknown): value is OrgRole {
  return (ORG_ROLES as readonly unknown[]).includes(value);
}

/** Known roles only, without repeats, in ORG_ROLES order. */
export function normalizeRoles(roles: readonly unknown[]): OrgRole[] {
  return ORG_ROLES.filter(r => roles.includes(r));
}

/**
 * Developer accounts are the technical owners of the pilot: their roles are
 * fixed (administration + development, nobody changes them from the app)
 * and the development role is only given by the pilot seed, never from the
 * app. The database enforces developer ⇒ admin too (migration 0013).
 */
export function isDeveloper(roles: readonly unknown[]): boolean {
  return roles.includes('developer');
}

/** Everything the roles give, before any withholding, in PERMISSIONS order. */
export function rolePermissions(roles: readonly OrgRole[]): Permission[] {
  const given = new Set(roles.flatMap(r => ROLE_PERMISSIONS[r] ?? []));
  return PERMISSIONS.filter(p => given.has(p));
}

/** What the viewer may do: roles, minus provisional and support withholding. */
export function effectivePermissions(
  roles: readonly OrgRole[],
  state: PermissionState,
): Permission[] {
  const withheld = new Set<Permission>([
    ...(state.provisional ? SENSITIVE_PERMISSIONS : []),
    ...(state.support ? SUPPORT_WITHHELD : []),
  ]);
  return rolePermissions(roles).filter(p => !withheld.has(p));
}

export function can(
  permissions: readonly Permission[],
  permission: Permission,
): boolean {
  return permissions.includes(permission);
}

/**
 * True when the roles give the permission but a provisional password holds
 * it back: the UI then asks for a new password instead of showing «Sin
 * acceso».
 */
export function heldByProvisional(
  roles: readonly OrgRole[],
  permission: Permission,
): boolean {
  return (
    rolePermissions(roles).includes(permission) &&
    (SENSITIVE_PERMISSIONS as readonly Permission[]).includes(permission)
  );
}

/**
 * Shared accounts: the guest account, and members whose only role is
 * `team` («Equipo», used by several people). They have no recovery e-mail;
 * an administrator or developer sets their password.
 */
export function isSharedAccount(
  role: Role,
  rolesByOrganization: readonly (readonly OrgRole[])[],
): boolean {
  if (role === 'guest') return true;
  const all = new Set(rolesByOrganization.flat());
  return !all.has('admin') && !all.has('developer');
}

/** «Sin acceso» messages, plain Spanish, per permission a screen needs. */
export const NO_ACCESS: Record<Permission, string> = {
  'plan.edit':
    'Este usuario solo puede consultar. Entra con tu usuario para hacer cambios.',
  'directory.read':
    'Contactos y Catálogo no están disponibles con este usuario: contienen datos de personas y precios.',
  'budget.read': 'El presupuesto solo lo ven las personas con ese permiso.',
  'budget.edit': 'Solo las personas con ese permiso cambian el presupuesto.',
  'offers.approve': 'Solo administración aprueba las ofertas recibidas.',
  'users.manage': 'Solo administración y desarrollo gestionan los usuarios.',
  'support.start': 'Solo administración abre sesiones de soporte.',
  view_as_guest: 'Solo administración y desarrollo pueden ver como Invitado.',
  'diagnostics.read': 'Solo desarrollo ve el diagnóstico técnico.',
};

/** Shown instead of NO_ACCESS when a provisional password holds it back. */
export const PROVISIONAL_HOLD =
  'Cambia tu contraseña provisional para acceder a esta función.';
