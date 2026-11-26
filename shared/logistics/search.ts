/**
 * Search ranking shared by the server (universal search) and the UI (instant
 * suggestions over loaded lists). Accent- and case-insensitive, prefix-aware,
 * tolerant to one typo in longer words.
 */

/** Lower-case, strip accents and collapse whitespace: «Plaza del Cristo» → «plaza del cristo». */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim();
}

function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/**
 * Score of `fields` for `query` (0 = no match). The first field is the title
 * and weighs most. Every query word must match some word of some field.
 */
export function scoreMatch(
  query: string,
  fields: (string | null | undefined)[],
): number {
  const q = normalize(query);
  if (!q) return 0;
  const qWords = q.split(' ');
  const fieldWords = fields.map(f =>
    f ? normalize(f).split(' ').filter(Boolean) : [],
  );
  let total = 0;
  for (const qw of qWords) {
    let best = 0;
    fieldWords.forEach((words, fi) => {
      const weight = fi === 0 ? 3 : 1;
      for (const w of words) {
        let s = 0;
        if (w === qw) s = 10;
        else if (w.startsWith(qw)) s = 7;
        else if (qw.length >= 4 && w.includes(qw)) s = 4;
        else if (qw.length >= 5 && withinOneEdit(qw, w.slice(0, qw.length + 1)))
          {s = 2;}
        best = Math.max(best, s * weight);
      }
    });
    if (best === 0) return 0;
    total += best;
  }
  const title = fields[0] ? normalize(fields[0]) : '';
  if (title.startsWith(q)) total += 15;
  return total;
}

/** Ranks items by score, dropping non-matches; ties keep input order. */
export function rank<T>(
  query: string,
  items: T[],
  fields: (item: T) => (string | null | undefined)[],
  limit = 20,
): {item: T; score: number}[] {
  return items
    .map((item, i) => ({item, score: scoreMatch(query, fields(item)), i}))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit)
    .map(({item, score}) => ({item, score}));
}

/** Keeps the five most recent distinct queries, newest first. */
export function pushRecent(recent: string[], query: string, max = 5): string[] {
  const q = query.trim();
  if (!q) return recent;
  const n = normalize(q);
  return [q, ...recent.filter(r => normalize(r) !== n)].slice(0, max);
}
