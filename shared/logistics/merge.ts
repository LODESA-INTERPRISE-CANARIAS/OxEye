/**
 * Three-way merge of a form after a 409 (M5). `base` is the record the form
 * was opened from, `mine` what the user typed, `theirs` the server's current
 * copy (both as form values). A field only the other person changed takes
 * their value; a field only the user changed keeps theirs; a field both
 * changed to different values is a clash the user resolves. Nothing is
 * overwritten silently in either direction.
 */

export interface MergeResult<T> {
  /** The form after the merge; clashing fields keep the user's value. */
  merged: T;
  /** Fields both people changed to different values. */
  clashes: (keyof T & string)[];
  /** Fields taken from the server copy (only the other person changed them). */
  fromTheirs: (keyof T & string)[];
}

/** Structural equality for form values (strings, numbers, booleans, null, arrays, plain objects). */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (
    a === null ||
    b === null ||
    typeof a !== 'object' ||
    typeof b !== 'object'
  ) {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
  }
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  return (
    ka.length === kb.length &&
    ka.every(k =>
      sameValue(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
      ),
    )
  );
}

export function mergeThreeWay<T extends object>(
  base: T,
  mine: T,
  theirs: T,
): MergeResult<T> {
  const merged = {...mine};
  const clashes: (keyof T & string)[] = [];
  const fromTheirs: (keyof T & string)[] = [];
  const keys = new Set([
    ...Object.keys(base),
    ...Object.keys(mine),
    ...Object.keys(theirs),
  ]) as Set<keyof T & string>;
  for (const key of keys) {
    const b = base[key];
    const m = mine[key];
    const t = theirs[key];
    const iChanged = !sameValue(b, m);
    const theyChanged = !sameValue(b, t);
    if (!theyChanged) continue;
    if (!iChanged) {
      merged[key] = t;
      fromTheirs.push(key);
    } else if (!sameValue(m, t)) {
      clashes.push(key);
    }
  }
  return {merged, clashes, fromTheirs};
}
