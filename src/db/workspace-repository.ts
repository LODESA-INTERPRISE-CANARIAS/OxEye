/**
 * Workspace repository (OX-03). Local mode: IndexedDB via Dexie. A future
 * server implementation replaces this module's implementation, not the UI
 * (data authority map §4 step 6).
 */
import {db} from './repository';
import type {
  AccessLogEntry,
  EventPayload,
  LocalUser,
  Membership,
  Organization,
  WorkspaceData,
  WorkspaceEvent,
  WorkspaceProject,
} from '../types/workspace';

export interface WorkspaceRepository {
  isEmpty(): Promise<boolean>;
  loadAll(): Promise<WorkspaceData>;
  putOrganization(org: Organization): Promise<void>;
  putUser(user: LocalUser): Promise<void>;
  putMembership(m: Membership): Promise<void>;
  deleteMembership(id: string): Promise<void>;
  putProject(p: WorkspaceProject): Promise<void>;
  /** Deletes the project with its events, payloads and memberships. */
  deleteProject(id: string): Promise<void>;
  putEvent(e: WorkspaceEvent): Promise<void>;
  /** Deletes the event with its payload and memberships. */
  deleteEvent(id: string): Promise<void>;
  findEventByImportHash(hash: string, orgId: string): Promise<WorkspaceEvent | undefined>;
  appendAccessLog(entry: AccessLogEntry): Promise<void>;
  getPayload(eventId: string): Promise<EventPayload | undefined>;
  putPayload(payload: EventPayload): Promise<void>;
}

export function emptyWorkspaceData(): WorkspaceData {
  return {
    organizations: [],
    users: [],
    memberships: [],
    projects: [],
    events: [],
    accessLog: [],
  };
}

/**
 * Restricts workspace data to the organizations `userId` belongs to
 * (local equivalent of INV-002). Users are limited to members of those
 * organizations plus the user itself.
 */
export function scopeToUser(data: WorkspaceData, userId: string): WorkspaceData {
  const orgs = new Set(
    data.memberships.filter((m) => m.userId === userId).map((m) => m.orgId)
  );
  const memberships = data.memberships.filter((m) => orgs.has(m.orgId));
  const userIds = new Set(memberships.map((m) => m.userId));
  userIds.add(userId);
  return {
    organizations: data.organizations.filter((o) => orgs.has(o.id)),
    users: data.users.filter((u) => userIds.has(u.id)),
    memberships,
    projects: data.projects.filter((p) => orgs.has(p.orgId)),
    events: data.events.filter((e) => orgs.has(e.orgId)),
    accessLog: data.accessLog.filter((a) => orgs.has(a.orgId)),
  };
}

/** Dexie-backed implementation. */
export class DexieWorkspaceRepository implements WorkspaceRepository {
  async isEmpty() {
    return (await db.organizations.count()) === 0;
  }

  async loadAll(): Promise<WorkspaceData> {
    const [organizations, users, memberships, projects, events, accessLog] =
      await Promise.all([
        db.organizations.toArray(),
        db.users.toArray(),
        db.memberships.toArray(),
        db.workspaceProjects.toArray(),
        db.events.toArray(),
        db.accessLog.orderBy('at').toArray(),
      ]);
    return {organizations, users, memberships, projects, events, accessLog};
  }

  async putOrganization(org: Organization) {
    await db.organizations.put(org);
  }
  async putUser(user: LocalUser) {
    await db.users.put(user);
  }
  async putMembership(m: Membership) {
    await db.memberships.put(m);
  }
  async deleteMembership(id: string) {
    await db.memberships.delete(id);
  }
  async putProject(p: WorkspaceProject) {
    await db.workspaceProjects.put(p);
  }
  async deleteProject(id: string) {
    await db.transaction(
      'rw',
      [db.workspaceProjects, db.events, db.eventPayloads, db.memberships],
      async () => {
        const eventIds = (await db.events.where('projectId').equals(id).toArray()).map(
          (e) => e.id
        );
        await db.eventPayloads.bulkDelete(eventIds);
        await db.events.bulkDelete(eventIds);
        const ms = await db.memberships
          .filter((m) => m.projectId === id || (!!m.eventId && eventIds.includes(m.eventId)))
          .toArray();
        await db.memberships.bulkDelete(ms.map((m) => m.id));
        await db.workspaceProjects.delete(id);
      }
    );
  }
  async putEvent(e: WorkspaceEvent) {
    await db.events.put(e);
  }
  async deleteEvent(id: string) {
    await db.transaction('rw', [db.events, db.eventPayloads, db.memberships], async () => {
      await db.eventPayloads.delete(id);
      const ms = await db.memberships.filter((m) => m.eventId === id).toArray();
      await db.memberships.bulkDelete(ms.map((m) => m.id));
      await db.events.delete(id);
    });
  }
  async findEventByImportHash(hash: string, orgId: string) {
    return db.events
      .where('importHash')
      .equals(hash)
      .filter((e) => e.orgId === orgId)
      .first();
  }
  async appendAccessLog(entry: AccessLogEntry) {
    await db.accessLog.put(entry);
  }
  async getPayload(eventId: string) {
    return db.eventPayloads.get(eventId);
  }
  async putPayload(payload: EventPayload) {
    await db.eventPayloads.put(payload);
  }
}

/** In-memory implementation for unit tests (no IndexedDB dependency). */
export class MemoryWorkspaceRepository implements WorkspaceRepository {
  data: WorkspaceData = emptyWorkspaceData();
  payloads = new Map<string, EventPayload>();

  private upsert<T extends {id: string}>(list: T[], item: T): void {
    const i = list.findIndex((x) => x.id === item.id);
    if (i >= 0) list[i] = structuredClone(item);
    else list.push(structuredClone(item));
  }

  async isEmpty() {
    return this.data.organizations.length === 0;
  }
  async loadAll() {
    return structuredClone(this.data);
  }
  async putOrganization(org: Organization) {
    this.upsert(this.data.organizations, org);
  }
  async putUser(user: LocalUser) {
    this.upsert(this.data.users, user);
  }
  async putMembership(m: Membership) {
    this.upsert(this.data.memberships, m);
  }
  async deleteMembership(id: string) {
    this.data.memberships = this.data.memberships.filter((m) => m.id !== id);
  }
  async putProject(p: WorkspaceProject) {
    this.upsert(this.data.projects, p);
  }
  async deleteProject(id: string) {
    const eventIds = this.data.events.filter((e) => e.projectId === id).map((e) => e.id);
    for (const eid of eventIds) this.payloads.delete(eid);
    this.data.events = this.data.events.filter((e) => e.projectId !== id);
    this.data.memberships = this.data.memberships.filter(
      (m) => m.projectId !== id && !(m.eventId && eventIds.includes(m.eventId))
    );
    this.data.projects = this.data.projects.filter((p) => p.id !== id);
  }
  async putEvent(e: WorkspaceEvent) {
    this.upsert(this.data.events, e);
  }
  async deleteEvent(id: string) {
    this.payloads.delete(id);
    this.data.memberships = this.data.memberships.filter((m) => m.eventId !== id);
    this.data.events = this.data.events.filter((e) => e.id !== id);
  }
  async findEventByImportHash(hash: string, orgId: string) {
    const e = this.data.events.find((x) => x.importHash === hash && x.orgId === orgId);
    return e ? structuredClone(e) : undefined;
  }
  async appendAccessLog(entry: AccessLogEntry) {
    this.upsert(this.data.accessLog, entry);
  }
  async getPayload(eventId: string) {
    const p = this.payloads.get(eventId);
    return p ? structuredClone(p) : undefined;
  }
  async putPayload(payload: EventPayload) {
    this.payloads.set(payload.eventId, structuredClone(payload));
  }
}
