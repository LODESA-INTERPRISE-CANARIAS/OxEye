/**
 * Search ranking shared by the server (universal search) and the UI (instant
 * suggestions over loaded lists). Accent- and case-insensitive, prefix-aware,
 * tolerant to one typo in longer words.
 */
import type {
  Category,
  Company,
  Contact,
  LogisticsEvent,
  Offer,
  SearchEntityType,
  SearchHit,
  Task,
  Uuid,
  Venue,
} from './contracts.ts';
import {COMPANY_KIND_LABEL} from './rules.ts';

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
        else if (
          qw.length >= 5 &&
          withinOneEdit(qw, w.slice(0, qw.length + 1))
        ) {
          s = 2;
        }
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

// ---------------------------------------------------------------- possible duplicates (M3)

/** Words that do not tell two names apart («de», «la», legal forms such as «S.L.»). */
const NAME_NOISE = new Set([
  'de',
  'del',
  'la',
  'las',
  'el',
  'los',
  'y',
  'e',
  'sl',
  'slu',
  'sa',
  'sll',
  'scp',
  'cb',
  'sociedad',
  'limitada',
]);

function significantWords(name: string): string[] {
  return normalize(name)
    .split(' ')
    .filter(w => w.length > 1 && !NAME_NOISE.has(w));
}

/**
 * True when two names probably refer to the same company or person:
 * «Carpas Teide» ~ «Carpas del Teide, S.L.», «Vallas Norte» ~ «Valas Norte»,
 * «Teide Carpas» ~ «Carpas Teide». A single shared word («Carpas») is not
 * enough.
 */
export function namesLookAlike(a: string, b: string): boolean {
  const wa = significantWords(a);
  const wb = significantWords(b);
  if (!wa.length || !wb.length) return normalize(a) === normalize(b);
  const ja = wa.join(' ');
  const jb = wb.join(' ');
  if (ja === jb) return true;
  if (ja.length >= 5 && jb.length >= 5 && withinOneEdit(ja, jb)) return true;
  const sa = new Set(wa);
  const sb = new Set(wb);
  const [small, large] = sa.size <= sb.size ? [sa, sb] : [sb, sa];
  if (small.size < 2) return false;
  for (const w of small) if (!large.has(w)) return false;
  return true;
}

/**
 * Existing records whose name looks like `name` (exact matches first), for
 * «¿Es la misma que…?» before creating a new one. `excludeId` skips the
 * record being edited.
 */
export function findLookAlikes<T extends {id: string; name: string}>(
  name: string,
  candidates: T[],
  opts: {excludeId?: string; limit?: number} = {},
): T[] {
  if (!normalize(name)) return [];
  const n = normalize(name);
  return candidates
    .filter(c => c.id !== opts.excludeId && namesLookAlike(name, c.name))
    .sort(
      (x, y) =>
        Number(normalize(y.name) === n) - Number(normalize(x.name) === n),
    )
    .slice(0, opts.limit ?? 3);
}

// ---------------------------------------------------------------- universal search (M3)

/** What the universal search looks through; each list is optional. */
export interface SearchSources {
  events?: Pick<LogisticsEvent, 'id' | 'name' | 'venue'>[];
  tasks?: Pick<Task, 'id' | 'title' | 'venue' | 'company'>[];
  venues?: Pick<Venue, 'id' | 'name' | 'address'>[];
  companies?: Pick<Company, 'id' | 'name' | 'kind' | 'categoryIds'>[];
  contacts?: Pick<
    Contact,
    'id' | 'name' | 'role' | 'company' | 'description'
  >[];
  offers?: Pick<
    Offer,
    'id' | 'name' | 'company' | 'categoryId' | 'description'
  >[];
  /** Names for matching and subtitles of companies and offers. */
  categories?: Pick<Category, 'id' | 'name'>[];
}

export interface SearchOptions {
  /** Only these types (all when empty or missing). */
  types?: SearchEntityType[];
  /** Only companies and offers in this category. */
  categoryId?: Uuid | null;
  limit?: number;
}

/** Display order of types when scores tie, and of the type filter chips. */
export const SEARCH_TYPE_ORDER: SearchEntityType[] = [
  'contact',
  'company',
  'offer',
  'event',
  'task',
  'venue',
  'warehouse',
  'resource',
  'note',
];

export const SEARCH_TYPE_LABEL: Record<SearchEntityType, string> = {
  event: 'Evento',
  task: 'Tarea',
  venue: 'Lugar',
  company: 'Empresa o entidad',
  contact: 'Persona',
  offer: 'Oferta',
  warehouse: 'Almacén',
  resource: 'Recurso',
  note: 'Nota',
};

interface Candidate {
  type: SearchEntityType;
  id: string;
  title: string;
  subtitle: string | null;
  fields: (string | null | undefined)[];
  categoryIds: string[];
}

const join = (parts: (string | null | undefined)[]): string | null =>
  parts.filter(Boolean).join(' · ') || null;

/**
 * Accent-insensitive search across the loaded lists, best first (ties by
 * SEARCH_TYPE_ORDER, then input order). Matches names, places, companies,
 * roles, categories, offer descriptions and contact descriptions (so «el de
 * las vallas» finds the person; guests receive descriptions as null, so for
 * them it matches nothing). Never notes or offer conditions, and subtitles
 * never quote any free text. An empty query with a type or category filter
 * lists everything that passes the filter, by title.
 */
export function universalSearch(
  query: string,
  sources: SearchSources,
  opts: SearchOptions = {},
): SearchHit[] {
  const categoryName = new Map(
    (sources.categories ?? []).map(c => [c.id, c.name]),
  );
  const names = (ids: string[]) =>
    ids
      .map(id => categoryName.get(id))
      .filter(Boolean)
      .join(', ') || null;
  const candidates: Candidate[] = [];

  for (const c of sources.contacts ?? []) {
    candidates.push({
      type: 'contact',
      id: c.id,
      title: c.name,
      subtitle: join([c.role, c.company?.name]),
      fields: [c.name, c.role, c.company?.name, c.description],
      categoryIds: [],
    });
  }
  for (const c of sources.companies ?? []) {
    const cats = names(c.categoryIds);
    candidates.push({
      type: 'company',
      id: c.id,
      title: c.name,
      subtitle: join([COMPANY_KIND_LABEL[c.kind], cats]),
      fields: [c.name, cats],
      categoryIds: c.categoryIds,
    });
  }
  for (const o of sources.offers ?? []) {
    const cat = o.categoryId ? categoryName.get(o.categoryId) : null;
    candidates.push({
      type: 'offer',
      id: o.id,
      title: o.name,
      subtitle: join([o.company.name, cat]),
      fields: [o.name, o.company.name, cat, o.description],
      categoryIds: o.categoryId ? [o.categoryId] : [],
    });
  }
  for (const e of sources.events ?? []) {
    candidates.push({
      type: 'event',
      id: e.id,
      title: e.name,
      subtitle: e.venue?.name ?? null,
      fields: [e.name, e.venue?.name],
      categoryIds: [],
    });
  }
  for (const t of sources.tasks ?? []) {
    candidates.push({
      type: 'task',
      id: t.id,
      title: t.title,
      subtitle: join([t.company?.name, t.venue?.name]),
      fields: [t.title, t.company?.name, t.venue?.name],
      categoryIds: [],
    });
  }
  for (const v of sources.venues ?? []) {
    candidates.push({
      type: 'venue',
      id: v.id,
      title: v.name,
      subtitle: v.address,
      fields: [v.name, v.address],
      categoryIds: [],
    });
  }

  const types = opts.types?.length ? new Set(opts.types) : null;
  const filtered = candidates.filter(
    c =>
      (!types || types.has(c.type)) &&
      (!opts.categoryId || c.categoryIds.includes(opts.categoryId)),
  );
  const order = (t: SearchEntityType) => SEARCH_TYPE_ORDER.indexOf(t);
  const limit = opts.limit ?? 30;
  const toHit = (c: Candidate, score: number): SearchHit => ({
    type: c.type,
    id: c.id,
    title: c.title,
    subtitle: c.subtitle,
    score,
  });

  if (!normalize(query)) {
    if (!types && !opts.categoryId) return [];
    return filtered
      .map((c, i) => ({c, i}))
      .sort(
        (a, b) =>
          a.c.title.localeCompare(b.c.title, 'es', {sensitivity: 'base'}) ||
          order(a.c.type) - order(b.c.type) ||
          a.i - b.i,
      )
      .slice(0, limit)
      .map(({c}) => toHit(c, 0));
  }

  return filtered
    .map((c, i) => ({c, i, score: scoreMatch(query, c.fields)}))
    .filter(r => r.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || order(a.c.type) - order(b.c.type) || a.i - b.i,
    )
    .slice(0, limit)
    .map(({c, score}) => toHit(c, score));
}

/** Keeps the five most recent distinct queries, newest first. */
export function pushRecent(recent: string[], query: string, max = 5): string[] {
  const q = query.trim();
  if (!q) return recent;
  const n = normalize(q);
  return [q, ...recent.filter(r => normalize(r) !== n)].slice(0, max);
}
