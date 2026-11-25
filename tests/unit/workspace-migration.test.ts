import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {MAPS_DATA} from '../../src/data/geodata';
import {createDefaultProject, parseImportedProject} from '../../src/db/repository';
import {
  adoptSavedProject,
  bootstrapWorkspace,
  importV1AsNewProject,
  payloadTitle,
  projectHash,
} from '../../src/db/workspace-migration';
import {MemoryWorkspaceRepository} from '../../src/db/workspace-repository';
import {contentHash, deterministicId} from '../../src/engine/workspace/ids';
import type {ProjectFile, VenueKey} from '../../src/types';
import type {Membership} from '../../src/types/workspace';

const T = '2026-01-01T00:00:00.000Z';
const T2 = '2026-02-01T00:00:00.000Z';
const VENUE_KEYS: VenueKey[] = ['cristo', 'constitucion', 'vega'];

function elementCounts(p: ProjectFile) {
  return Object.fromEntries(
    VENUE_KEYS.map((k) => [
      k,
      {
        fences: p.scenes[k].fences?.length ?? 0,
        infrastructure: p.scenes[k].infrastructure?.length ?? 0,
        booths: p.scenes[k].base?.booths?.length ?? 0,
      },
    ])
  );
}

describe('Workspace deterministic ids', () => {
  it('contentHash is a stable 32-hex digest that changes with the input', () => {
    const a = contentHash('{"a":1}');
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(contentHash('{"a":1}')).toBe(a);
    expect(contentHash('{"a":2}')).not.toBe(a);
    expect(contentHash('')).toMatch(/^[0-9a-f]{32}$/);
  });

  it('deterministicId is UUID-shaped and depends on namespace and hash', () => {
    const h = contentHash('x');
    const id = deterministicId('project', h);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(deterministicId('project', h)).toBe(id);
    expect(deterministicId('event', h)).not.toBe(id);
    expect(deterministicId('project', contentHash('y'))).not.toBe(id);
  });

  it('projectHash is stable for equal content and changes with content', () => {
    const p = {format: 'ojo-de-buey', version: 1, nested: {a: [1, 2]}};
    expect(projectHash(structuredClone(p))).toBe(projectHash(p));
    expect(projectHash({...p, nested: {a: [1, 3]}})).not.toBe(projectHash(p));
  });

  it('payloadTitle uses the trimmed active scene title or the fallback', () => {
    const p = createDefaultProject();
    p.scenes[p.active].title = '  Fiestas del Cristo  ';
    expect(payloadTitle(p, 'X')).toBe('Fiestas del Cristo');
    p.scenes[p.active].title = '   ';
    expect(payloadTitle(p, 'X')).toBe('X');
  });
});

describe('MemoryWorkspaceRepository cascades', () => {
  function seed() {
    const repo = new MemoryWorkspaceRepository();
    const m = (id: string, extra: Partial<Membership>): Membership => ({
      id,
      orgId: 'org-a',
      userId: 'u-' + id,
      role: 'technician',
      scope: 'project',
      createdAt: T,
      createdBy: 'seed',
      ...extra,
    });
    repo.data.organizations.push({id: 'org-a', name: 'A', createdAt: T});
    repo.data.projects.push(
      {id: 'p1', orgId: 'org-a', name: 'P1', createdAt: T, updatedAt: T},
      {id: 'p2', orgId: 'org-a', name: 'P2', createdAt: T, updatedAt: T}
    );
    repo.data.events.push(
      {id: 'e1', orgId: 'org-a', projectId: 'p1', name: 'E1', createdAt: T, updatedAt: T},
      {id: 'e2', orgId: 'org-a', projectId: 'p1', name: 'E2', createdAt: T, updatedAt: T},
      {id: 'e3', orgId: 'org-a', projectId: 'p2', name: 'E3', createdAt: T, updatedAt: T}
    );
    repo.data.memberships.push(
      m('org', {scope: 'organization', role: 'org_admin'}),
      m('p1', {projectId: 'p1'}),
      m('e1', {scope: 'event', projectId: 'p1', eventId: 'e1'}),
      m('e2', {scope: 'event', projectId: 'p1', eventId: 'e2'}),
      m('p2', {projectId: 'p2'}),
      m('e3', {scope: 'event', projectId: 'p2', eventId: 'e3'})
    );
    for (const id of ['e1', 'e2', 'e3']) {
      repo.payloads.set(id, {
        eventId: id,
        orgId: 'org-a',
        project: {} as ProjectFile,
        updatedAt: T,
      });
    }
    return repo;
  }

  it('deleteProject removes its events, payloads and memberships only', async () => {
    const repo = seed();
    await repo.deleteProject('p1');
    expect(repo.data.projects.map((p) => p.id)).toEqual(['p2']);
    expect(repo.data.events.map((e) => e.id)).toEqual(['e3']);
    expect([...repo.payloads.keys()]).toEqual(['e3']);
    expect(repo.data.memberships.map((m) => m.id)).toEqual(['org', 'p2', 'e3']);
  });

  it('deleteEvent removes the event, its payload and event memberships only', async () => {
    const repo = seed();
    await repo.deleteEvent('e1');
    expect(repo.data.events.map((e) => e.id)).toEqual(['e2', 'e3']);
    expect([...repo.payloads.keys()].sort()).toEqual(['e2', 'e3']);
    expect(repo.data.memberships.map((m) => m.id)).toEqual(['org', 'p1', 'e2', 'p2', 'e3']);
    expect(repo.data.projects.map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  it('returns copies so callers cannot mutate stored records', async () => {
    const repo = seed();
    const all = await repo.loadAll();
    all.projects[0].name = 'mutated';
    expect(repo.data.projects[0].name).toBe('P1');
    const payload = await repo.getPayload('e1');
    (payload!.project as unknown as {x: number}).x = 1;
    expect((repo.payloads.get('e1')!.project as unknown as {x?: number}).x).toBeUndefined();
  });

  it('upserts by id without duplicating records', async () => {
    const repo = seed();
    await repo.putProject({id: 'p1', orgId: 'org-a', name: 'Renamed', createdAt: T, updatedAt: T2});
    expect(repo.data.projects.filter((p) => p.id === 'p1')).toHaveLength(1);
    expect(repo.data.projects.find((p) => p.id === 'p1')!.name).toBe('Renamed');
  });
});

describe('bootstrapWorkspace', () => {
  it('wraps a saved v1 project as one project with one event, once', async () => {
    const repo = new MemoryWorkspaceRepository();
    const saved = createDefaultProject();
    const snapshot = structuredClone(saved);

    const result = await bootstrapWorkspace(repo, saved, T);
    expect(result).not.toBeNull();
    expect(repo.data.organizations).toHaveLength(1);
    expect(repo.data.users).toHaveLength(1);
    expect(repo.data.memberships).toHaveLength(1);
    expect(repo.data.memberships[0]).toMatchObject({
      orgId: result!.orgId,
      userId: result!.userId,
      role: 'org_admin',
      scope: 'organization',
    });
    expect(repo.data.projects).toHaveLength(1);
    expect(repo.data.events).toHaveLength(1);
    expect(repo.data.projects[0].id).toBe(result!.projectId);
    expect(repo.data.events[0]).toMatchObject({
      id: result!.eventId,
      projectId: result!.projectId,
      orgId: result!.orgId,
    });
    const hash = projectHash(snapshot);
    expect(result!.projectId).toBe(deterministicId('project', hash));
    expect(result!.eventId).toBe(deterministicId('event', hash));

    const payload = await repo.getPayload(result!.eventId!);
    expect(payload!.project).toEqual(snapshot);
    // The saved project itself is not modified, and the stored copy is independent.
    expect(saved).toEqual(snapshot);
    saved.scenes.cristo.title = 'mutated after bootstrap';
    expect((await repo.getPayload(result!.eventId!))!.project).toEqual(snapshot);

    const second = await bootstrapWorkspace(repo, snapshot, T2);
    expect(second).toBeNull();
    expect(repo.data.organizations).toHaveLength(1);
    expect(repo.data.users).toHaveLength(1);
    expect(repo.data.memberships).toHaveLength(1);
    expect(repo.data.projects).toHaveLength(1);
    expect(repo.data.events).toHaveLength(1);
    expect(repo.payloads.size).toBe(1);
  });

  it('creates only the organization and admin user when nothing was saved', async () => {
    const repo = new MemoryWorkspaceRepository();
    const result = await bootstrapWorkspace(repo, null, T);
    expect(result).not.toBeNull();
    expect(result!.projectId).toBeUndefined();
    expect(result!.eventId).toBeUndefined();
    expect(repo.data.organizations).toHaveLength(1);
    expect(repo.data.users).toHaveLength(1);
    expect(repo.data.memberships.map((m) => m.role)).toEqual(['org_admin']);
    expect(repo.data.projects).toHaveLength(0);
    expect(repo.data.events).toHaveLength(0);
    expect(repo.payloads.size).toBe(0);
    expect(await bootstrapWorkspace(repo, null, T2)).toBeNull();
    expect(repo.data.organizations).toHaveLength(1);
  });
});

describe('adoptSavedProject', () => {
  it('returns the existing event of the organization whose payload matches', async () => {
    const repo = new MemoryWorkspaceRepository();
    const saved = createDefaultProject();
    const boot = await bootstrapWorkspace(repo, saved, T);
    const before = structuredClone(repo.data);

    const event = await adoptSavedProject(repo, boot!.orgId, structuredClone(saved), T2);
    expect(event.id).toBe(boot!.eventId);
    expect(repo.data).toEqual(before);
    expect(repo.payloads.size).toBe(1);
  });

  it('creates one project with one event when no payload matches, and is idempotent', async () => {
    const repo = new MemoryWorkspaceRepository();
    const boot = await bootstrapWorkspace(repo, null, T);
    const orgId = boot!.orgId;
    const saved = createDefaultProject();
    saved.scenes.cristo.title = 'Modelo sin evento';
    const hash = projectHash(saved);

    const first = await adoptSavedProject(repo, orgId, saved, T);
    expect(first).toMatchObject({
      id: deterministicId('event:adopt:' + orgId, hash),
      projectId: deterministicId('project:adopt:' + orgId, hash),
      orgId,
      name: 'Modelo sin evento',
    });
    expect(repo.data.projects).toHaveLength(1);
    expect(repo.data.projects[0]).toMatchObject({id: first.projectId, orgId, name: 'Modelo sin evento'});
    expect(repo.data.events).toHaveLength(1);
    expect((await repo.getPayload(first.id))!.project).toEqual(saved);

    const second = await adoptSavedProject(repo, orgId, saved, T2);
    expect(second.id).toBe(first.id);
    expect(repo.data.projects).toHaveLength(1);
    expect(repo.data.events).toHaveLength(1);
    expect(repo.payloads.size).toBe(1);
  });

  it('does not reuse an event of another organization with the same payload', async () => {
    const repo = new MemoryWorkspaceRepository();
    const saved = createDefaultProject();
    const boot = await bootstrapWorkspace(repo, saved, T);
    const event = await adoptSavedProject(repo, 'org-other', saved, T2);
    expect(event.id).not.toBe(boot!.eventId);
    expect(event.orgId).toBe('org-other');
    expect(repo.data.projects).toHaveLength(2);
    expect(repo.data.events).toHaveLength(2);
  });
});

describe('importV1AsNewProject', () => {
  // parseImportedProject stamps a wall-clock `demandConfig.updatedAt` on scenes
  // that lack one; freeze Date so two parses of the same file are comparable.
  beforeEach(() => {
    vi.useFakeTimers({toFake: ['Date']});
    vi.setSystemTime(new Date(T));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('imports a current v1 export without losing elements', async () => {
    const source = createDefaultProject();
    const text = JSON.stringify(source);
    const repo = new MemoryWorkspaceRepository();

    const result = await importV1AsNewProject(repo, text, 'org-a', T);
    const expected = parseImportedProject(text, createDefaultProject(), MAPS_DATA);

    expect(result.existing).toBe(false);
    expect(result.payload).toEqual(expected);
    expect((await repo.getPayload(result.event.id))!.project).toEqual(expected);
    expect(elementCounts(result.payload)).toEqual(elementCounts(source));
    // Sanity check that the fixture actually contains elements.
    expect(elementCounts(source).cristo.booths).toBeGreaterThan(0);
    expect(result.event).toMatchObject({
      orgId: 'org-a',
      projectId: result.project.id,
      importHash: contentHash(JSON.stringify(JSON.parse(text))),
    });
    expect(repo.data.projects).toHaveLength(1);
    expect(repo.data.events).toHaveLength(1);
  });

  it('returns the existing event when the same file is imported again', async () => {
    const text = JSON.stringify(createDefaultProject());
    const repo = new MemoryWorkspaceRepository();
    const first = await importV1AsNewProject(repo, text, 'org-a', T);
    const second = await importV1AsNewProject(repo, text, 'org-a', T2);
    expect(second.existing).toBe(true);
    expect(second.project.id).toBe(first.project.id);
    expect(second.event.id).toBe(first.event.id);
    expect(second.payload).toEqual(first.payload);
    expect(repo.data.projects).toHaveLength(1);
    expect(repo.data.events).toHaveLength(1);
    expect(repo.payloads.size).toBe(1);
  });

  it('treats whitespace-only JSON differences as the same file', async () => {
    const source = createDefaultProject();
    const repo = new MemoryWorkspaceRepository();
    const first = await importV1AsNewProject(repo, JSON.stringify(source), 'org-a', T);
    const pretty = await importV1AsNewProject(repo, JSON.stringify(source, null, 2), 'org-a', T2);
    expect(pretty.existing).toBe(true);
    expect(pretty.event.id).toBe(first.event.id);
    expect(pretty.event.importHash).toBe(first.event.importHash);
    expect(repo.data.events).toHaveLength(1);
  });

  it('does not reuse an import of another organization', async () => {
    const text = JSON.stringify(createDefaultProject());
    const repo = new MemoryWorkspaceRepository();
    const a = await importV1AsNewProject(repo, text, 'org-a', T);
    const b = await importV1AsNewProject(repo, text, 'org-b', T);
    expect(b.existing).toBe(false);
    expect(b.project.id).not.toBe(a.project.id);
    expect(b.event.id).not.toBe(a.event.id);
    expect(b.event.orgId).toBe('org-b');
  });

  it('throws on invalid JSON and creates nothing', async () => {
    const repo = new MemoryWorkspaceRepository();
    await expect(importV1AsNewProject(repo, '{not json', 'org-a', T)).rejects.toThrow(
      /JSON no válido/
    );
    await expect(importV1AsNewProject(repo, '[]', 'org-a', T)).rejects.toThrow();
    expect(repo.data.projects).toHaveLength(0);
    expect(repo.data.events).toHaveLength(0);
    expect(repo.payloads.size).toBe(0);
  });
});
