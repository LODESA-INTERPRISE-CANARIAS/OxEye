/**
 * Presentation helpers for inventories and notes: ordering, the groups of
 * the Inventarios space, the notes that belong to a record and the notes Hoy
 * shows. No React, no store. Quantities, labels and the note label live in
 * `shared/logistics/` (inventory.ts, history.ts).
 *
 * Nothing here combines quantity, unit or dimensions: they are inventory
 * data, never a load on the ground.
 */
import type {
  Category,
  Company,
  Note,
  NoteKind,
  NoteRefType,
  Resource,
  ResourceAvailability,
  ResourceCondition,
  Uuid,
  Warehouse,
} from '../../../shared/logistics/contracts.ts';
import {RESOLVABLE_NOTE_KINDS} from '../../../shared/logistics/rules.ts';
import {DEFAULT_TIMEZONE, utcToLocal} from '../../../shared/logistics/time.ts';
import type {IconName} from '../ui/icons';
import {byName} from './directory';

/** Server order of warehouses and resources: by name, ignoring case. */
export const sortWarehouses = (list: Warehouse[]) => byName(list);
export const sortResources = (list: Resource[]) => byName(list);

/** Server order of notes: newest first. */
export function sortNotes(list: Note[]): Note[] {
  return [...list].sort(
    (a, b) =>
      Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** Resource categories in display order (built-ins, then custom). */
export function resourceCategories(categories: Category[]): Category[] {
  return categories.filter(c => c.scope === 'resource');
}

// ---------------------------------------------------------------- groups

/** Key of the group of resources without a warehouse or a company. */
export const LOOSE = '__none__';

export interface WarehouseGroup {
  key: string;
  warehouse: Warehouse | null;
  items: Resource[];
}

/**
 * Owned material grouped by warehouse, in warehouse name order, then the
 * resources without a warehouse. With `includeEmpty`, warehouses with nothing
 * listed still appear (a warehouse just created must be visible).
 */
export function groupByWarehouse(
  resources: Resource[],
  warehouses: Warehouse[],
  includeEmpty: boolean,
): WarehouseGroup[] {
  const byWarehouse = new Map<string, Resource[]>();
  const loose: Resource[] = [];
  const known = new Set(warehouses.map(w => w.id));
  for (const r of resources) {
    const id = r.warehouse?.id;
    if (!id || !known.has(id)) {
      loose.push(r);
      continue;
    }
    const list = byWarehouse.get(id);
    if (list) list.push(r);
    else byWarehouse.set(id, [r]);
  }
  const groups: WarehouseGroup[] = [];
  for (const w of sortWarehouses(warehouses)) {
    const items = byWarehouse.get(w.id) ?? [];
    if (items.length || includeEmpty) {
      groups.push({key: w.id, warehouse: w, items: sortResources(items)});
    }
  }
  if (loose.length) {
    groups.push({key: LOOSE, warehouse: null, items: sortResources(loose)});
  }
  return groups;
}

export interface CompanyGroup {
  key: string;
  /** The company as embedded in the resource, plus the full record if loaded. */
  company: {id: Uuid; name: string} | null;
  record: Company | null;
  items: Resource[];
}

/** Contracted services grouped by company (by name), then those without one. */
export function groupByCompany(
  resources: Resource[],
  companies: Company[],
): CompanyGroup[] {
  const groups = new Map<string, CompanyGroup>();
  const loose: Resource[] = [];
  const records = new Map(companies.map(c => [c.id, c]));
  for (const r of resources) {
    if (!r.company) {
      loose.push(r);
      continue;
    }
    const g = groups.get(r.company.id);
    if (g) g.items.push(r);
    else {
      groups.set(r.company.id, {
        key: r.company.id,
        company: r.company,
        record: records.get(r.company.id) ?? null,
        items: [r],
      });
    }
  }
  const collator = new Intl.Collator('es', {sensitivity: 'base'});
  const out = [...groups.values()]
    .sort((a, b) => collator.compare(a.company!.name, b.company!.name))
    .map(g => ({...g, items: sortResources(g.items)}));
  if (loose.length) {
    out.push({
      key: LOOSE,
      company: null,
      record: null,
      items: sortResources(loose),
    });
  }
  return out;
}

/** How many resources there are per category id (`LOOSE` = none). */
export function countByCategory(resources: Resource[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of resources) {
    const k = r.categoryId ?? LOOSE;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

// ---------------------------------------------------------------- certainty

export type QuantityCertainty =
  'confirmed' | 'planned' | 'hypothesis' | 'pending';

/**
 * How sure the recorded quantity is, in OxEye's certainty grammar: not
 * counted → dotted (pending); «aún por evaluar» → hatched (provisional
 * figure); counted and validated → solid; counted, not validated → outline.
 */
export function quantityCertainty(
  r: Pick<Resource, 'quantity' | 'toAssess' | 'verification'>,
): QuantityCertainty {
  if (r.quantity === null) return 'pending';
  if (r.toAssess) return 'hypothesis';
  return r.verification === 'validated' ? 'confirmed' : 'planned';
}

/** Tone of a condition chip: damage stands out, unknown is pending. */
export function conditionTone(
  c: ResourceCondition,
): 'danger' | 'neutral' | 'pending' {
  if (c === 'damaged') return 'danger';
  if (c === 'unknown') return 'pending';
  return 'neutral';
}

export function availabilityTone(
  a: ResourceAvailability,
): 'accent' | 'danger' | 'neutral' | 'pending' {
  if (a === 'available') return 'accent';
  if (a === 'maintenance') return 'danger';
  if (a === 'unknown') return 'pending';
  return 'neutral';
}

// ---------------------------------------------------------------- notes

export const NOTE_KIND_ICON: Record<NoteKind, IconName> = {
  note: 'note',
  incident: 'alert',
  decision: 'decision',
  open_question: 'question',
  feature_idea: 'idea',
};

/** Incidents and open questions not yet resolved or answered. */
export function isOpenNote(n: Pick<Note, 'kind' | 'resolved'>): boolean {
  return RESOLVABLE_NOTE_KINDS.has(n.kind) && !n.resolved;
}

/** «Resuelta» / «Respondida», or «Abierta» / «Sin responder». */
export function resolvedLabel(
  n: Pick<Note, 'kind' | 'resolved'>,
): string | null {
  if (!RESOLVABLE_NOTE_KINDS.has(n.kind)) return null;
  if (n.kind === 'open_question') {
    return n.resolved ? 'Respondida' : 'Sin responder';
  }
  return n.resolved ? 'Resuelta' : 'Abierta';
}

/** The record a list of notes belongs to: an event, or one linked record. */
export type NoteTarget =
  {type: 'event'; id: Uuid} | {type: NoteRefType; id: Uuid};

/**
 * Notes of a record, newest first. An event's notes are those filed under
 * that event (whatever else they point at); any other record's are those
 * linked to it.
 */
export function notesAbout(notes: Note[], target: NoteTarget): Note[] {
  return notes.filter(n =>
    target.type === 'event'
      ? n.event?.id === target.id
      : n.ref?.type === target.type && n.ref.id === target.id,
  );
}

/**
 * What Hoy shows: open incidents and open questions first (whatever their
 * day, oldest first: they have waited longest), then the other notes created
 * today, newest first.
 */
export function notesForToday(
  notes: Note[],
  today: string,
  timeZone: string = DEFAULT_TIMEZONE,
): {open: Note[]; today: Note[]} {
  const open = notes
    .filter(isOpenNote)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const openIds = new Set(open.map(n => n.id));
  const todays = sortNotes(
    notes.filter(
      n =>
        !openIds.has(n.id) && utcToLocal(n.createdAt, timeZone).date === today,
    ),
  );
  return {open, today: todays};
}

/** The first line of a note, cut short for a list (members only). */
export function excerpt(text: string, max = 140): string {
  const line = text.trim().replace(/\s+/g, ' ');
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}
