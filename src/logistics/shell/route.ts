/**
 * The Gestor's addresses (deep links). Pure: no React, no DOM.
 *
 * Base, what the screen shows:
 *   #logistica                         Hoy
 *   #logistica/<space>                 calendario, tareas, inventarios,
 *                                      contactos, catalogo, cierre
 *   #logistica/calendario/YYYY-MM-DD   a calendar day
 *   #logistica/cierre/YYYY-MM-DD       the day close of a past day
 *   #logistica/maquetas                mock-ups (development builds only)
 *
 * A record sheet adds `/ficha/<tipo>/<id>` to the base, e.g.
 *   #logistica/ficha/tarea/<id>                      a task over Hoy
 *   #logistica/calendario/2026-12-02/ficha/evento/<id>
 *   #logistica/contactos/ficha/empresa/<id>
 *   #logistica/tareas/ficha/tarea/<id>
 * The filters of «Tareas» are kept per device, not in the address.
 * with <tipo>: evento, tarea, persona, empresa, oferta, almacen, recurso,
 * nota, lugar, presupuesto (an event's budget: the id is the event's; without
 * `budget.read` it opens on «Sin acceso», never on the data). Opening such a
 * link opens that sheet (after signing in, once
 * the record is loaded); Back closes it and stays on the base. Forms for a
 * new record, the search and other sheets without a record of their own
 * have no address: they are steps of «Atrás» but keep the address below.
 */
import type {LocalDate} from '../../../shared/logistics/contracts.ts';
import {isLocalDate} from '../../../shared/logistics/time.ts';
import {isSpace, type Space} from './spaces';

export type SheetType =
  | 'event'
  | 'task'
  | 'contact'
  | 'company'
  | 'offer'
  | 'warehouse'
  | 'resource'
  | 'note'
  | 'venue'
  | 'budget';

/** Spanish words in the address, as people read and share it. */
export const SHEET_SLUG: Record<SheetType, string> = {
  event: 'evento',
  task: 'tarea',
  contact: 'persona',
  company: 'empresa',
  offer: 'oferta',
  warehouse: 'almacen',
  resource: 'recurso',
  note: 'nota',
  venue: 'lugar',
  budget: 'presupuesto',
};

const TYPE_OF_SLUG = new Map(
  (Object.entries(SHEET_SLUG) as [SheetType, string][]).map(([t, s]) => [s, t]),
);

export interface SheetAddress {
  type: SheetType;
  id: string;
}

export interface Route {
  space: Space;
  /** Calendar day view, or null (month). */
  calendarDay: LocalDate | null;
  /** Day close of another day, or null (today). */
  closeDay: LocalDate | null;
  /** `#logistica/maquetas` (honoured only in development builds). */
  mockups: boolean;
  sheet: SheetAddress | null;
}

export const ROOT_HASH = '#logistica';
const SHEET_WORD = 'ficha';
/** Record ids: UUIDs on the server, short ids in the fixtures. */
const ID = /^[A-Za-z0-9_-]{1,80}$/;

export function sameAddress(
  a: SheetAddress | null | undefined,
  b: SheetAddress | null | undefined,
): boolean {
  return !!a && !!b && a.type === b.type && a.id === b.id;
}

/** Reads any Gestor address; anything unknown falls back to Hoy. */
export function parseRoute(hash: string): Route {
  const route: Route = {
    space: 'hoy',
    calendarDay: null,
    closeDay: null,
    mockups: false,
    sheet: null,
  };
  if (!hash.startsWith(ROOT_HASH)) return route;
  const rest = hash.slice(ROOT_HASH.length);
  if (rest && !rest.startsWith('/')) return route;
  const parts = rest.split('/').filter(Boolean);
  const at = parts.indexOf(SHEET_WORD);
  const base = at >= 0 ? parts.slice(0, at) : parts;
  if (at >= 0) {
    const type = TYPE_OF_SLUG.get(parts[at + 1] ?? '');
    const id = parts[at + 2] ?? '';
    if (type && ID.test(id) && parts.length === at + 3) {
      route.sheet = {type, id};
    }
  }
  const [first, second] = base;
  if (first === 'maquetas') {
    route.mockups = true;
    return route;
  }
  if (first && isSpace(first)) {
    route.space = first;
    if (second && isLocalDate(second)) {
      if (first === 'calendario') route.calendarDay = second;
      if (first === 'cierre') route.closeDay = second;
    }
  }
  return route;
}

/** The base address of what the screen shows (no sheet). */
export function baseHash(route: Omit<Route, 'sheet'>): string {
  if (route.mockups) return `${ROOT_HASH}/maquetas`;
  if (route.space === 'hoy') return ROOT_HASH;
  if (route.space === 'calendario' && route.calendarDay) {
    return `${ROOT_HASH}/calendario/${route.calendarDay}`;
  }
  if (route.space === 'cierre' && route.closeDay) {
    return `${ROOT_HASH}/cierre/${route.closeDay}`;
  }
  return `${ROOT_HASH}/${route.space}`;
}

/** A base address with the sheet on top, if it has an address. */
export function withSheet(base: string, sheet: SheetAddress | null): string {
  return sheet
    ? `${base}/${SHEET_WORD}/${SHEET_SLUG[sheet.type]}/${sheet.id}`
    : base;
}

/** The base part of any Gestor address (drops `/ficha/…`). */
export function stripSheet(hash: string): string {
  const at = hash.indexOf(`/${SHEET_WORD}/`);
  return at >= 0 ? hash.slice(0, at) : hash;
}
