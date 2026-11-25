/**
 * Role × action permission matrix (OX-03).
 *
 * Pure module: no store, UI or data imports, so a future server can reuse it.
 * In local mode these checks are indicative only and do not protect data
 * (UX-009 / SEC-001 require server-side enforcement).
 */
import type {
  Membership,
  PermissionTarget,
  WorkspaceAction,
  WorkspaceData,
  WorkspaceRole,
} from '../../types/workspace';

export const WORKSPACE_ROLES: readonly WorkspaceRole[] = [
  'org_admin',
  'event_coordinator',
  'technician',
  'team_lead',
  'installer',
  'external_supplier',
  'read_only',
];

export const WORKSPACE_ACTIONS: readonly WorkspaceAction[] = [
  'project.view',
  'project.create',
  'project.edit',
  'project.delete',
  'event.view',
  'event.create',
  'event.edit',
  'event.delete',
  'members.manage',
  'budget.view',
  'budget.edit',
  'orders.view',
  'orders.update',
  'sensitive.view',
  'export',
];

/** Spanish UI labels for roles. */
export const ROLE_LABELS: Record<WorkspaceRole, string> = {
  org_admin: 'Administración de organización',
  event_coordinator: 'Coordinación de evento',
  technician: 'Técnico/a',
  team_lead: 'Jefe/a de equipo',
  installer: 'Montador/a',
  external_supplier: 'Proveedor externo',
  read_only: 'Solo lectura',
};

const ALL = new Set<WorkspaceAction>(WORKSPACE_ACTIONS);

/**
 * Allowed actions per role. `sensitive.view` (Punto Violeta) is granted only to
 * organization administration and event coordination.
 *
 * NOT a privacy gate: `sensitive.view` and `export` are not yet consumed by any
 * view or export (OX-03 plan §6, KI-05). Existing Punto Violeta protections
 * remain the only enforcement until a shared privacy gate uses this matrix.
 */
export const ROLE_MATRIX: Record<WorkspaceRole, ReadonlySet<WorkspaceAction>> = {
  org_admin: ALL,
  event_coordinator: new Set<WorkspaceAction>([
    'project.view',
    'project.edit',
    'event.view',
    'event.create',
    'event.edit',
    'members.manage',
    'budget.view',
    'budget.edit',
    'orders.view',
    'orders.update',
    'sensitive.view',
    'export',
  ]),
  technician: new Set<WorkspaceAction>([
    'project.view',
    'event.view',
    'event.edit',
    'budget.view',
    'orders.view',
    'orders.update',
    'export',
  ]),
  team_lead: new Set<WorkspaceAction>([
    'project.view',
    'event.view',
    'orders.view',
    'orders.update',
  ]),
  installer: new Set<WorkspaceAction>([
    'project.view',
    'event.view',
    'orders.view',
    'orders.update',
  ]),
  external_supplier: new Set<WorkspaceAction>(['orders.view']),
  read_only: new Set<WorkspaceAction>([
    'project.view',
    'event.view',
    'budget.view',
    'orders.view',
  ]),
};

/** Whether a role allows an action, independently of scope. */
export function roleAllows(role: WorkspaceRole, action: WorkspaceAction): boolean {
  return ROLE_MATRIX[role].has(action);
}

/**
 * Resolves the role a user holds on a target.
 *
 * Precedence: an organization-level `org_admin` always wins; otherwise the
 * most specific membership applies (event > project > organization).
 * Memberships of another organization are never considered (INV-002).
 */
export function effectiveRole(
  userId: string,
  memberships: readonly Membership[],
  target: PermissionTarget
): WorkspaceRole | null {
  const own = memberships.filter(
    (m) => m.userId === userId && m.orgId === target.orgId
  );
  const orgLevel = own.find((m) => m.scope === 'organization');
  if (orgLevel?.role === 'org_admin') return 'org_admin';
  if (target.eventId) {
    const ev = own.find(
      (m) => m.scope === 'event' && m.eventId === target.eventId
    );
    if (ev) return ev.role;
  }
  if (target.projectId) {
    const pr = own.find(
      (m) => m.scope === 'project' && m.projectId === target.projectId
    );
    if (pr) return pr.role;
  }
  return orgLevel?.role ?? null;
}

/**
 * Roles an actor may grant at a project or event scope: never `org_admin`
 * (organization-level only) and only roles whose permissions are a subset of
 * the actor's own role, so nobody can grant more than they hold.
 */
export function assignableRoles(actorRole: WorkspaceRole | null): WorkspaceRole[] {
  if (!actorRole || !roleAllows(actorRole, 'members.manage')) return [];
  const own = ROLE_MATRIX[actorRole];
  return WORKSPACE_ROLES.filter(
    (r) => r !== 'org_admin' && [...ROLE_MATRIX[r]].every((a) => own.has(a))
  );
}

/** Whether `userId` may perform `action` on `target`. */
export function can(
  userId: string | null | undefined,
  memberships: readonly Membership[],
  action: WorkspaceAction,
  target: PermissionTarget
): boolean {
  if (!userId) return false;
  const role = effectiveRole(userId, memberships, target);
  return role ? roleAllows(role, action) : false;
}

/**
 * Roles that may edit a venue (OX-04 plan D16). PROVISIONAL: who edits the
 * venue is not decided yet (plan §12.7); change it here when OX-20 / OX-24
 * settle it. Kept outside `ROLE_MATRIX` so `assignableRoles` is unchanged.
 * Creating, duplicating and promoting layouts use `event.edit`.
 */
export const VENUE_EDIT_ROLES: ReadonlySet<WorkspaceRole> = new Set<WorkspaceRole>([
  'org_admin',
  'event_coordinator',
]);

/** Whether `userId` may edit the venue used by `target` (event scope). */
export function canEditVenue(
  userId: string | null | undefined,
  memberships: readonly Membership[],
  target: PermissionTarget
): boolean {
  if (!userId) return false;
  const role = effectiveRole(userId, memberships, target);
  return !!role && VENUE_EDIT_ROLES.has(role);
}

/**
 * Organization ids the user belongs to (any scope). Every listing starts from
 * these, so data of other organizations is never returned (INV-002, local).
 */
export function userOrgIds(userId: string, data: WorkspaceData): Set<string> {
  return new Set(
    data.memberships.filter((m) => m.userId === userId).map((m) => m.orgId)
  );
}

/** Projects the user may view, restricted to the user's organizations. */
export function visibleProjects(userId: string, data: WorkspaceData) {
  const orgs = userOrgIds(userId, data);
  return data.projects.filter((p) => {
    if (!orgs.has(p.orgId)) return false;
    if (can(userId, data.memberships, 'project.view', {orgId: p.orgId, projectId: p.id})) {
      return true;
    }
    // A user invited only to one event still sees its project as a container.
    return data.events.some(
      (e) =>
        e.projectId === p.id &&
        can(userId, data.memberships, 'event.view', {
          orgId: e.orgId,
          projectId: e.projectId,
          eventId: e.id,
        })
    );
  });
}

/** Events of a project the user may view. */
export function visibleEvents(
  userId: string,
  data: WorkspaceData,
  projectId: string
) {
  const orgs = userOrgIds(userId, data);
  return data.events.filter(
    (e) =>
      e.projectId === projectId &&
      orgs.has(e.orgId) &&
      can(userId, data.memberships, 'event.view', {
        orgId: e.orgId,
        projectId: e.projectId,
        eventId: e.id,
      })
  );
}
