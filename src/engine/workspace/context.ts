/**
 * Derived views of an event payload (plan D2): Jornadas and venues are read
 * from the existing `ProjectFile`, never stored as a second source of truth.
 */
import type {PhaseKey, ProjectFile, VenueKey} from '../../types';

export interface EventDayView {
  id: string;
  name: string;
  kind: PhaseKey;
  date: string;
}

/** Jornadas of the active venue scene, ordered pre → event → post, then by date. */
export function eventDays(project: ProjectFile): EventDayView[] {
  const scene = project.scenes[project.active];
  const order: Record<PhaseKey, number> = {pre: 0, event: 1, post: 2};
  return (scene?.workDays || [])
    .map((d) => ({id: d.id, name: d.name, kind: d.kind, date: d.date}))
    .sort(
      (a, b) =>
        order[a.kind] - order[b.kind] || String(a.date).localeCompare(String(b.date))
    );
}

/**
 * Venues used by an event: the active venue plus any other venue whose scene
 * has a defined perimeter (≥ 3 points).
 */
export function eventVenues(project: ProjectFile): VenueKey[] {
  const keys = Object.keys(project.scenes) as VenueKey[];
  return keys.filter(
    (k) => k === project.active || (project.scenes[k]?.boundary?.length || 0) >= 3
  );
}
