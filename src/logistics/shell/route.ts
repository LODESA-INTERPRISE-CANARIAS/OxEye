/**
 * The Gestor's addresses (deep links). Pure: no React, no DOM.
 *
 * An address is the path relative to the build's base, with a leading slash
 * (`address.ts` reads and writes it on `location`). Base, what the screen
 * shows:
 *   /gestor-logistico                         Hoy
 *   /gestor-logistico/<space>                 calendario, tareas, inventarios,
 *                                             contactos, catalogo, cierre
 *   /gestor-logistico/calendario/YYYY-MM-DD   a calendar day
 *   /gestor-logistico/cierre/YYYY-MM-DD       the day close of a past day
 *   /gestor-logistico/maquetas                mock-ups (development builds only)
 *
 * A record sheet adds `/ficha/<tipo>/<id>` to the base, e.g.
 *   /gestor-logistico/ficha/tarea/<id>                      a task over Hoy
 *   /gestor-logistico/calendario/2026-12-02/ficha/evento/<id>
 *   /gestor-logistico/contactos/ficha/empresa/<id>
 *   /gestor-logistico/tareas/ficha/tarea/<id>
 *
 * Until 2026-11-28 the same addresses lived in the fragment (`#logistica…`).
 * Those links are in mails, phones and bookmarks: `parseRoute` still reads
 * them and `legacyLocation` translates them, secret tokens included.
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
  /** `/gestor-logistico/maquetas` (honoured only in development builds). */
  mockups: boolean;
  sheet: SheetAddress | null;
}

export const ROOT_ADDRESS = '/gestor-logistico';
/** The fragment form used before 2026-11-28. */
export const LEGACY_ROOT = '#logistica';
const SHEET_WORD = 'ficha';

/** True for the Gestor's root address and everything under it. */
export function isGestorAddress(address: string): boolean {
  return address === ROOT_ADDRESS || address.startsWith(`${ROOT_ADDRESS}/`);
}

/** True for any `#logistica…` fragment (not `#logisticas`). */
export function isLegacyHash(hash: string): boolean {
  return hash === LEGACY_ROOT || hash.startsWith(`${LEGACY_ROOT}/`);
}

/**
 * The current form of an address: a legacy `#logistica…` fragment becomes
 * `/gestor-logistico…`, and trailing or repeated slashes are dropped.
 */
export function normalizeAddress(address: string): string {
  const current = isLegacyHash(address)
    ? `${ROOT_ADDRESS}${address.slice(LEGACY_ROOT.length)}`
    : address;
  const parts = current.split('/').filter(Boolean);
  return `/${parts.join('/')}`;
}

const TOKEN = '[A-Za-z0-9_-]{43}';
const LEGACY_ACCOUNT = new RegExp(
  `^#logistica/cuenta/(restablecer|verificar)/(${TOKEN})$`,
);
const LEGACY_SUPPLIER = new RegExp(
  `^#logistica/proveedor/(abierto/)?(${TOKEN})$`,
);

/**
 * Where a legacy `#logistica…` link belongs now, or null when the fragment
 * is not one. Secret tokens (account and supplier links) move to the
 * fragment of the new address, never to the path: a fragment never reaches
 * a server, a proxy or a log.
 */
export function legacyLocation(
  hash: string,
): {address: string; hash: string} | null {
  if (!isLegacyHash(hash)) return null;
  const account = LEGACY_ACCOUNT.exec(hash);
  if (account) {
    return {
      address: `${ROOT_ADDRESS}/cuenta/${account[1]}`,
      hash: `#${account[2]}`,
    };
  }
  const supplier = LEGACY_SUPPLIER.exec(hash);
  if (supplier) {
    return {
      address: `${ROOT_ADDRESS}/proveedor${supplier[1] ? '/abierto' : ''}`,
      hash: `#${supplier[2]}`,
    };
  }
  // A malformed token link (a trailing slash, punctuation pasted with it, a
  // cut token) may still carry a valid token: nothing after `cuenta` or
  // `proveedor` may ever reach the path, so it opens the Gestor's root.
  if (/^#logistica\/(cuenta|proveedor)(\/|$)/.test(hash)) {
    return {address: ROOT_ADDRESS, hash: ''};
  }
  // A `?` or `#` inside an old fragment was never part of the address.
  const plain = hash.slice(1).split(/[?#]/)[0];
  return {address: normalizeAddress(`#${plain}`), hash: ''};
}
/** Record ids: UUIDs on the server, short ids in the fixtures. */
const ID = /^[A-Za-z0-9_-]{1,80}$/;

export function sameAddress(
  a: SheetAddress | null | undefined,
  b: SheetAddress | null | undefined,
): boolean {
  return !!a && !!b && a.type === b.type && a.id === b.id;
}

/**
 * Reads any Gestor address (current or legacy fragment); anything unknown
 * falls back to Hoy.
 */
export function parseRoute(address: string): Route {
  const route: Route = {
    space: 'hoy',
    calendarDay: null,
    closeDay: null,
    mockups: false,
    sheet: null,
  };
  const normal = normalizeAddress(address);
  if (!isGestorAddress(normal)) return route;
  const rest = normal.slice(ROOT_ADDRESS.length);
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
export function baseAddress(route: Omit<Route, 'sheet'>): string {
  if (route.mockups) return `${ROOT_ADDRESS}/maquetas`;
  if (route.space === 'hoy') return ROOT_ADDRESS;
  if (route.space === 'calendario' && route.calendarDay) {
    return `${ROOT_ADDRESS}/calendario/${route.calendarDay}`;
  }
  if (route.space === 'cierre' && route.closeDay) {
    return `${ROOT_ADDRESS}/cierre/${route.closeDay}`;
  }
  return `${ROOT_ADDRESS}/${route.space}`;
}

/** A base address with the sheet on top, if it has an address. */
export function withSheet(base: string, sheet: SheetAddress | null): string {
  return sheet
    ? `${base}/${SHEET_WORD}/${SHEET_SLUG[sheet.type]}/${sheet.id}`
    : base;
}

/** The base part of any Gestor address (drops `/ficha/…`). */
export function stripSheet(address: string): string {
  const at = address.indexOf(`/${SHEET_WORD}/`);
  return at >= 0 ? address.slice(0, at) : address;
}
