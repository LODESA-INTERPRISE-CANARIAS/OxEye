/**
 * Workspace domain types (OX-03): organizations, local users, memberships,
 * projects and events. Local mode only: there is no server and these records
 * live in the browser's IndexedDB. Permissions derived from them are
 * indicative and do not protect data.
 */
import type {ProjectFile} from './index';

/** Minimal role set proposed by OX-03 (to be validated in OX-20 / OX-24). */
export type WorkspaceRole =
  | 'org_admin'
  | 'event_coordinator'
  | 'technician'
  | 'team_lead'
  | 'installer'
  | 'external_supplier'
  | 'read_only';

/** Actions checked by the permission matrix. */
export type WorkspaceAction =
  | 'project.view'
  | 'project.create'
  | 'project.edit'
  | 'project.delete'
  | 'event.view'
  | 'event.create'
  | 'event.edit'
  | 'event.delete'
  | 'members.manage'
  | 'budget.view'
  | 'budget.edit'
  | 'orders.view'
  | 'orders.update'
  | 'sensitive.view'
  | 'export';

/** Where a membership applies. Event memberships override project ones for that event. */
export type MembershipScope = 'organization' | 'project' | 'event';

export interface Organization {
  id: string;
  name: string;
  createdAt: string;
}

/** Local person profile. Minimal personal data (CUM-008): name and optional professional contact. */
export interface LocalUser {
  id: string;
  name: string;
  contact?: string;
  createdAt: string;
}

export interface Membership {
  id: string;
  orgId: string;
  userId: string;
  role: WorkspaceRole;
  scope: MembershipScope;
  projectId?: string;
  eventId?: string;
  createdAt: string;
  createdBy: string;
}

export interface WorkspaceProject {
  id: string;
  orgId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceEvent {
  id: string;
  orgId: string;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** Content hash of an imported v1 file, used to avoid duplicates on re-import. */
  importHash?: string;
}

export type AccessLogAction = 'invite' | 'role_change' | 'revoke';

/** Who changed whose access, and when (INV-012). */
export interface AccessLogEntry {
  id: string;
  orgId: string;
  projectId?: string;
  eventId?: string;
  at: string;
  actorId: string;
  action: AccessLogAction;
  targetUserId: string;
  role?: WorkspaceRole;
  previousRole?: WorkspaceRole;
}

/** The event content: an unchanged v1 `ProjectFile` (plan D1). */
export interface EventPayload {
  eventId: string;
  orgId: string;
  project: ProjectFile;
  updatedAt: string;
}

/** In-memory view of workspace records (payloads excluded). */
export interface WorkspaceData {
  organizations: Organization[];
  users: LocalUser[];
  memberships: Membership[];
  projects: WorkspaceProject[];
  events: WorkspaceEvent[];
  accessLog: AccessLogEntry[];
}

/** Target of a permission check. */
export interface PermissionTarget {
  orgId: string;
  projectId?: string;
  eventId?: string;
}
