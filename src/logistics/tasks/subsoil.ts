/**
 * The subsoil review mark after a 409 merge in the task form (pure).
 *
 * A declared review belongs to a venue, a heavy load and a set of resources.
 * When the other person changed any of them (or both of you did), a tick the
 * user gave earlier would otherwise be sent with the merged placement and
 * declare a review nobody did for it. So the mark goes back to the server's
 * value, nothing is re-declared, and the notice says why.
 */
import type {MergeClash} from '../forms/merge';

/** Form keys that make a declared subsoil review stale. */
export const PLACEMENT_KEYS: readonly string[] = [
  'venueName',
  'heavy',
  'resourceIds',
];

const SUBSOIL_KEYS = new Set(['subsoilReviewed', 'subsoilRedeclare']);

export const SUBSOIL_MERGE_NOTE =
  'Han cambiado el lugar, la carga pesada o los recursos: vuelve a marcar la revisión del subsuelo solo si revisaste el plan nuevo en el simulador.';

interface SubsoilValues {
  subsoilReviewed: boolean;
  subsoilRedeclare: boolean;
}

export function subsoilAfterMerge<V extends SubsoilValues>(
  merge: {merged: V; clashes: MergeClash<V>[]; fromTheirs: string[]},
  /** Whether the server copy carries a declared review. */
  serverReviewed: boolean,
): {merged: V; clashes: MergeClash<V>[]; note: string | null} {
  const touched =
    merge.fromTheirs.some(k => PLACEMENT_KEYS.includes(k)) ||
    merge.clashes.some(c => PLACEMENT_KEYS.includes(c.key));
  if (!touched) {
    return {merged: merge.merged, clashes: merge.clashes, note: null};
  }
  return {
    merged: {
      ...merge.merged,
      subsoilReviewed: serverReviewed,
      subsoilRedeclare: false,
    },
    // The mark is no longer the user's to choose from an old tick.
    clashes: merge.clashes.filter(c => !SUBSOIL_KEYS.has(c.key)),
    note: SUBSOIL_MERGE_NOTE,
  };
}
