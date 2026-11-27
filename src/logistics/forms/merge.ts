/**
 * Merging a form after a 409 (milestone 5). The three-way merge itself is
 * `mergeThreeWay` (shared); this module only folds fields that belong
 * together (date and times are one choice, not five) and turns field keys
 * and values into short Spanish for the notice.
 */
import type {
  DataSource,
  Verification,
} from '../../../shared/logistics/contracts.ts';
import {mergeThreeWay, sameValue} from '../../../shared/logistics/merge.ts';
import {SOURCE_LABEL, VERIFICATION_LABEL} from '../lib/events';
import {dayMonthShort} from '../lib/format';

/** Keys of the date-and-time block (`SlotValues`), merged as one choice. */
export const SLOT_KEYS = [
  'date',
  'endDate',
  'multiDay',
  'startTime',
  'endTime',
] as const;

/** One item the user may have to choose on: a field or a group of fields. */
export interface MergeClash<V> {
  /** Field key, or group name («slot»). */
  key: string;
  /** Form keys it covers. */
  keys: (keyof V & string)[];
  /** The user's values for those keys, as typed before the 409. */
  mine: Partial<V>;
  /** The server's values for those keys. */
  theirs: Partial<V>;
}

export interface FormMerge<V> {
  merged: V;
  clashes: MergeClash<V>[];
  /** Field keys or group names taken from the server copy. */
  fromTheirs: string[];
}

type Groups<V> = Record<string, readonly (keyof V & string)[]>;

/** The slot group when the form has date and time fields. */
export function slotGroups<V extends object>(sample: V): Groups<V> {
  return SLOT_KEYS.every(k => k in sample)
    ? {slot: SLOT_KEYS as unknown as (keyof V & string)[]}
    : {};
}

function fold<V extends object>(
  values: V,
  groups: Groups<V>,
): Record<string, unknown> {
  const out = {...values} as Record<string, unknown>;
  for (const [name, keys] of Object.entries(groups)) {
    const part: Record<string, unknown> = {};
    for (const k of keys) {
      part[k] = (values as Record<string, unknown>)[k];
      delete out[k];
    }
    out[`group:${name}`] = part;
  }
  return out;
}

function unfold<V extends object>(
  folded: Record<string, unknown>,
  groups: Groups<V>,
): V {
  const out: Record<string, unknown> = {...folded};
  for (const name of Object.keys(groups)) {
    const part = out[`group:${name}`] as Record<string, unknown>;
    delete out[`group:${name}`];
    Object.assign(out, part);
  }
  return out as V;
}

const pick = <V extends object>(
  values: V,
  keys: readonly (keyof V & string)[],
): Partial<V> => {
  const out: Partial<V> = {};
  for (const k of keys) out[k] = values[k];
  return out;
};

/**
 * `mergeThreeWay(base, mine, theirs)` with `groups` merged as single fields
 * (by default the date-and-time block, when the form has one).
 */
export function mergeForm<V extends object>(
  base: V,
  mine: V,
  theirs: V,
  groups: Groups<V> = slotGroups(mine),
): FormMerge<V> {
  const result = mergeThreeWay(
    fold(base, groups),
    fold(mine, groups),
    fold(theirs, groups),
  );
  const toItem = (key: string) => {
    const name = key.startsWith('group:') ? key.slice(6) : key;
    const keys = (groups[name] ?? [key]) as (keyof V & string)[];
    return {name, keys};
  };
  return {
    merged: unfold<V>(result.merged, groups),
    fromTheirs: result.fromTheirs.map(k => toItem(k).name),
    clashes: result.clashes.map(k => {
      const {name, keys} = toItem(k);
      return {
        key: name,
        keys,
        mine: pick(mine, keys),
        theirs: pick(theirs, keys),
      };
    }),
  };
}

/** Which side the form currently holds for a clash. */
export function clashChoice<V extends object>(
  values: V,
  clash: MergeClash<V>,
): 'mine' | 'theirs' {
  return clash.keys.every(k => sameValue(values[k], clash.theirs[k])) &&
    !clash.keys.every(k => sameValue(values[k], clash.mine[k]))
    ? 'theirs'
    : 'mine';
}

/** Spanish names of form fields across the sheets. */
export const MERGE_FIELD_LABEL: Record<string, string> = {
  slot: 'Fecha y horario',
  title: 'Qué hay que hacer',
  name: 'Nombre',
  kind: 'Tipo',
  eventId: 'Evento',
  eventIds: 'Eventos',
  venueName: 'Lugar',
  companyName: 'Empresa',
  contactId: 'Persona de contacto',
  mainContactId: 'Persona de contacto principal',
  status: 'Estado',
  heavy: 'Carga pesada',
  subsoilReviewed: 'Subsuelo revisado en el simulador',
  dependsOn: 'Depende de que termine',
  resourceIds: 'Recursos',
  notes: 'Observaciones',
  source: 'Origen del dato',
  verification: 'Verificación',
  role: 'Cargo',
  phone: 'Teléfono',
  email: 'Correo',
  description: 'Descripción',
  website: 'Web',
  categoryIds: 'Categorías',
  categoryId: 'Categoría',
  ownership: 'Propiedad',
  quantity: 'Cantidad',
  unit: 'Unidad',
  toAssess: 'Aún por evaluar',
  dimensions: 'Medidas',
  condition: 'Estado de conservación',
  availability: 'Disponibilidad',
  warehouseName: 'Almacén',
  location: 'Ubicación en el almacén',
  offerId: 'Oferta',
  address: 'Dirección',
  text: 'Texto',
  ref: 'Relacionada con',
  resolved: 'Resuelta',
  price: 'Precio',
  customUnit: 'Unidad',
  transportCost: 'Coste de transporte',
  assemblyCost: 'Coste de montaje',
  maintenanceCost: 'Coste de mantenimiento',
  vat: 'Impuestos (IGIC/IVA)',
  conditions: 'Condiciones',
  acronym: 'Siglas',
  openingHours: 'Horario',
  opensAt: 'Abre',
  closesAt: 'Cierra',
};

export function mergeFieldLabel(key: string): string {
  return MERGE_FIELD_LABEL[key] ?? 'Otro dato';
}

/** Free-text keys: their value is shown, shortened. */
const TEXT_KEYS = new Set([
  'title',
  'name',
  'acronym',
  'opensAt',
  'closesAt',
  'venueName',
  'companyName',
  'notes',
  'role',
  'phone',
  'email',
  'description',
  'website',
  'quantity',
  'dimensions',
  'warehouseName',
  'location',
  'address',
  'text',
  'price',
  'customUnit',
  'transportCost',
  'assemblyCost',
  'maintenanceCost',
  'conditions',
]);

const MAX_SHOWN = 60;

function short(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  if (!t) return 'vacío';
  return t.length > MAX_SHOWN ? `«${t.slice(0, MAX_SHOWN - 1)}…»` : `«${t}»`;
}

function slotText(v: Record<string, unknown>): string {
  const date = typeof v.date === 'string' && v.date ? v.date : null;
  const end =
    v.multiDay && typeof v.endDate === 'string' && v.endDate ? v.endDate : null;
  const start = typeof v.startTime === 'string' ? v.startTime : '';
  const stop = typeof v.endTime === 'string' ? v.endTime : '';
  const day = date
    ? `${dayMonthShort(date)}${end ? ` – ${dayMonthShort(end)}` : ''}`
    : 'sin fecha';
  const hours =
    start && stop
      ? `${start}–${stop}`
      : start
        ? `desde las ${start}`
        : stop
          ? `hasta las ${stop}`
          : 'sin hora';
  return `${day}, ${hours}`;
}

/**
 * Short readable value of a field or group, or null when it is a code or a
 * list (the notice then says «tu selección» / «la suya»). `describe` lets a
 * sheet name its own codes (status, kind, event…).
 */
export function mergeValueText<V extends object>(
  key: string,
  values: Partial<V>,
  describe?: (key: string, values: Partial<V>) => string | null | undefined,
): string | null {
  const custom = describe?.(key, values);
  if (custom !== undefined) return custom;
  const all = values as Record<string, unknown>;
  if (key === 'slot') return slotText(all);
  const value = all[key];
  if (key === 'source') {
    return value ? SOURCE_LABEL[value as DataSource] : 'sin indicar';
  }
  if (key === 'verification') {
    return VERIFICATION_LABEL[value as Verification] ?? null;
  }
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (typeof value === 'string' && TEXT_KEYS.has(key)) return short(value);
  return null;
}

/** Field names as a Spanish list: «Lugar, Estado y Observaciones». */
export function fieldList(keys: string[]): string {
  const labels = keys.map(mergeFieldLabel);
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} y ${labels[labels.length - 1]}`;
}
