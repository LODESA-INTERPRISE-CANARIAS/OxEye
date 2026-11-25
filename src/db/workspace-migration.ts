/**
 * Workspace bootstrap and v1 import (OX-03, plan D8 / D9).
 */
import {VENUES} from '../data/catalog';
import {MAPS_DATA} from '../data/geodata';
import {eventVenues} from '../engine/workspace/context';
import {contentHash, deterministicId} from '../engine/workspace/ids';
import {
  ALL_PHASES,
  contentFingerprint,
  splitLegacyScene,
} from '../engine/workspace/venue-layout';
import type {MapMetadata, ProjectFile, VenueKey} from '../types';
import type {Layout, Venue, VenueContent} from '../types/venue';
import type {
  LocalUser,
  Membership,
  Organization,
  WorkspaceEvent,
  WorkspaceProject,
} from '../types/workspace';
import {createDefaultProject, parseImportedProject} from './repository';
import type {WorkspaceRepository} from './workspace-repository';

export const DEFAULT_ORG_NAME = 'Mi organización';
export const DEFAULT_USER_NAME = 'Usuario local';

export interface BootstrapResult {
  orgId: string;
  userId: string;
  projectId?: string;
  eventId?: string;
}

/** Display name of an event payload: the active scene title, if any. */
export function payloadTitle(project: ProjectFile, fallback: string): string {
  const t = project.scenes[project.active]?.title;
  return typeof t === 'string' && t.trim() ? t.trim() : fallback;
}

/** Stable hash of a project payload, independent of JSON whitespace. */
export function projectHash(project: unknown): string {
  return contentHash(JSON.stringify(project));
}

/**
 * Creates the initial workspace when IndexedDB holds none: a default
 * organization and local user (organization administration). If a v1 project
 * was already saved in this browser it is wrapped as one project with one
 * event, without modifying it. Returns `null` when a workspace already exists.
 */
export async function bootstrapWorkspace(
  repo: WorkspaceRepository,
  savedProject: ProjectFile | null,
  now = new Date().toISOString()
): Promise<BootstrapResult | null> {
  if (!(await repo.isEmpty())) return null;
  const org: Organization = {id: crypto.randomUUID(), name: DEFAULT_ORG_NAME, createdAt: now};
  const user: LocalUser = {id: crypto.randomUUID(), name: DEFAULT_USER_NAME, createdAt: now};
  const membership: Membership = {
    id: crypto.randomUUID(),
    orgId: org.id,
    userId: user.id,
    role: 'org_admin',
    scope: 'organization',
    createdAt: now,
    createdBy: user.id,
  };
  await repo.putOrganization(org);
  await repo.putUser(user);
  await repo.putMembership(membership);
  const result: BootstrapResult = {orgId: org.id, userId: user.id};
  if (savedProject) {
    const hash = projectHash(savedProject);
    const project: WorkspaceProject = {
      id: deterministicId('project', hash),
      orgId: org.id,
      name: payloadTitle(savedProject, 'Proyecto recuperado'),
      createdAt: now,
      updatedAt: now,
    };
    const event: WorkspaceEvent = {
      id: deterministicId('event', hash),
      orgId: org.id,
      projectId: project.id,
      name: payloadTitle(savedProject, 'Evento recuperado'),
      createdAt: now,
      updatedAt: now,
    };
    await repo.putProject(project);
    await repo.putEvent(event);
    await repo.putPayload({
      eventId: event.id,
      orgId: org.id,
      project: structuredClone(savedProject),
      updatedAt: now,
    });
    result.projectId = project.id;
    result.eventId = event.id;
  }
  return result;
}

/**
 * Attaches a model saved in this browser that belongs to no event (for example
 * saved from the menu before any event existed). If an event of `orgId`
 * already stores the same content, that event is returned; otherwise a
 * project with one event is created with deterministic ids, so repeating the
 * operation never duplicates (INV-001).
 */
export async function adoptSavedProject(
  repo: WorkspaceRepository,
  orgId: string,
  saved: ProjectFile,
  now = new Date().toISOString()
): Promise<WorkspaceEvent> {
  const hash = projectHash(saved);
  const all = await repo.loadAll();
  for (const e of all.events.filter((x) => x.orgId === orgId)) {
    const stored = await repo.getPayload(e.id);
    if (stored && projectHash(stored.project) === hash) return e;
  }
  const project: WorkspaceProject = {
    id: deterministicId('project:adopt:' + orgId, hash),
    orgId,
    name: payloadTitle(saved, 'Proyecto recuperado'),
    createdAt: now,
    updatedAt: now,
  };
  const event: WorkspaceEvent = {
    id: deterministicId('event:adopt:' + orgId, hash),
    orgId,
    projectId: project.id,
    name: payloadTitle(saved, 'Evento recuperado'),
    createdAt: now,
    updatedAt: now,
  };
  await repo.putProject(project);
  await repo.putEvent(event);
  await repo.putPayload({eventId: event.id, orgId, project: structuredClone(saved), updatedAt: now});
  return event;
}

export interface ImportResult {
  /** `true` when the same file had already been imported; nothing was created. */
  existing: boolean;
  project: WorkspaceProject;
  event: WorkspaceEvent;
  payload: ProjectFile;
}

/**
 * Imports a v1 project JSON (or legacy single-venue file) as the first event of
 * a new project in `orgId` (card req. 6). The file is parsed against a fresh
 * default project, so nothing leaks from the open event. Importing the same
 * file again returns the existing event instead of duplicating it.
 *
 * @throws Error with a Spanish message if the file is not a valid OxEye model.
 */
export async function importV1AsNewProject(
  repo: WorkspaceRepository,
  text: string,
  orgId: string,
  now = new Date().toISOString()
): Promise<ImportResult> {
  const payload = parseImportedProject(text, createDefaultProject(), MAPS_DATA);
  const hash = contentHash(JSON.stringify(JSON.parse(text)));
  const existingEvent = await repo.findEventByImportHash(hash, orgId);
  if (existingEvent) {
    const stored = await repo.getPayload(existingEvent.id);
    const all = await repo.loadAll();
    const project = all.projects.find((p) => p.id === existingEvent.projectId);
    if (stored && project) {
      return {existing: true, project, event: existingEvent, payload: stored.project};
    }
  }
  const project: WorkspaceProject = {
    id: deterministicId('project:' + orgId, hash),
    orgId,
    name: payloadTitle(payload, 'Proyecto importado'),
    createdAt: now,
    updatedAt: now,
  };
  const event: WorkspaceEvent = {
    id: deterministicId('event:' + orgId, hash),
    orgId,
    projectId: project.id,
    name: payloadTitle(payload, 'Evento importado'),
    createdAt: now,
    updatedAt: now,
    importHash: hash,
  };
  await repo.putProject(project);
  await repo.putEvent(event);
  await repo.putPayload({eventId: event.id, orgId, project: payload, updatedAt: now});
  return {existing: false, project, event, payload};
}

/* ------------------------------------------------------------------ */
/* OX-04: venues and layouts (plan D13, D15)                            */
/* ------------------------------------------------------------------ */

/** Display name of a venue drawn in `site` with `map`. */
export function venueDisplayName(site: VenueKey, map: MapMetadata | undefined): string {
  const label = map?.customLocation?.label?.trim();
  return label || VENUES[site]?.name || 'Recinto';
}

/** Identity hash of venue content drawn on a base map (dedupe across events). */
export function venueIdentity(site: VenueKey, map: MapMetadata | undefined, content: VenueContent) {
  return contentFingerprint({site, map: map ?? null, content});
}

export interface EventComposition {
  venues: Venue[];
  layouts: Layout[];
  /** `true` when venues or layouts were created by this call. */
  created: boolean;
}

/**
 * Makes sure every venue scene of an event has a venue and at least one
 * layout (lazy migration, plan D15). A scene without layouts is split into a
 * venue and one `current` layout covering all phases, with deterministic ids,
 * so running it twice creates nothing new. Identical venue content in the
 * same organization reuses the same venue. `useVenue` assigns a saved venue
 * to a site instead of the scene's own venue content (wizard, plan D13).
 */
export async function ensureEventLayouts(
  repo: WorkspaceRepository,
  event: WorkspaceEvent,
  payload: ProjectFile,
  opts: {
    useVenue?: Partial<Record<VenueKey, Venue>>;
    /** `current` for legacy content (acceptance criterion); `draft` for new events. */
    initialState?: Layout['state'];
    /** `false` for new events: always create the event's own venue. */
    shareVenue?: boolean;
    now?: string;
  } = {}
): Promise<EventComposition> {
  const now = opts.now ?? new Date().toISOString();
  const venues = await repo.listVenues(event.orgId);
  const layouts = await repo.listLayouts(event.orgId);
  const own = layouts.filter((l) => l.eventId === event.id);
  let created = false;
  const newLayouts: Layout[] = [];

  for (const site of eventVenues(payload)) {
    if (own.some((l) => l.site === site)) continue;
    const scene = payload.scenes[site];
    if (!scene) continue;
    const split = splitLegacyScene(scene);
    const map = payload.maps[site];
    let venue = opts.useVenue?.[site];
    if (!venue) {
      const hash = venueIdentity(site, map, split.venue);
      // Only complete venues (with a perimeter) are shared between events;
      // a new event's own venue is never shared implicitly.
      const share = opts.shareVenue !== false && split.venue.boundary.length >= 3;
      const sharedId = deterministicId('venue:' + event.orgId, hash);
      const shared = share ? venues.find((v) => v.id === sharedId) : undefined;
      if (shared && venueIdentity(shared.site, shared.map, shared.content) === hash) {
        venue = shared;
      } else {
        // The shared venue changed since; keep this event's own copy.
        const id =
          shared || !share
            ? deterministicId('venue:' + event.orgId + ':' + event.id + ':' + site, hash)
            : sharedId;
        venue = venues.find((v) => v.id === id);
        if (!venue) {
          venue = {
            id,
            orgId: event.orgId,
            name: venueDisplayName(site, map),
            site,
            version: 1,
            map: structuredClone(map),
            content: split.venue,
            createdAt: now,
            updatedAt: now,
          };
          await repo.putVenue(venue);
          venues.push(venue);
          created = true;
        }
      }
    }
    newLayouts.push({
      id: deterministicId('layout:' + event.id, site),
      orgId: event.orgId,
      eventId: event.id,
      venueId: venue.id,
      site,
      name: 'Distribución principal',
      state: opts.initialState ?? 'current',
      phases: [...ALL_PHASES],
      version: 1,
      baseVenueVersion: venue.version,
      content: split.layout,
      accessOverrides: {},
      safety: split.safety,
      createdAt: now,
      updatedAt: now,
    });
  }
  if (newLayouts.length) {
    await repo.putLayouts(newLayouts);
    created = true;
  }
  const allLayouts = [...layouts.filter((l) => !newLayouts.some((n) => n.id === l.id)), ...newLayouts];
  const usedVenueIds = new Set(allLayouts.filter((l) => l.eventId === event.id).map((l) => l.venueId));
  return {
    venues: venues.filter((v) => usedVenueIds.has(v.id)),
    layouts: allLayouts.filter((l) => l.eventId === event.id),
    created,
  };
}
