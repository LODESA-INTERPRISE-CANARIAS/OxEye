/**
 * The Logistics Manager's spaces. The five main spaces are reachable from the
 * tab bar and by horizontal swipe; «Cierre de jornada» lives in the sidebar
 * and the account sheet.
 */
import {isLocalDate} from '../../../shared/logistics/time.ts';
import type {NavItem} from '../ui';

export type MainSpace =
  'hoy' | 'calendario' | 'inventarios' | 'contactos' | 'catalogo';
export type Space = MainSpace | 'cierre';

export const MAIN_SPACES: NavItem<MainSpace>[] = [
  {id: 'hoy', label: 'Hoy', icon: 'today'},
  {id: 'calendario', label: 'Calendario', icon: 'calendar'},
  {id: 'inventarios', label: 'Inventarios', icon: 'inventory'},
  {id: 'contactos', label: 'Contactos', icon: 'contacts'},
  {id: 'catalogo', label: 'Catálogo', icon: 'catalog'},
];

export const SPACE_TITLE: Record<Space, string> = {
  hoy: 'Hoy',
  calendario: 'Calendario',
  inventarios: 'Inventarios',
  contactos: 'Contactos',
  catalogo: 'Catálogo',
  cierre: 'Cierre de jornada',
};

const ALL: Space[] = [...MAIN_SPACES.map(s => s.id), 'cierre'];

export function isSpace(value: string): value is Space {
  return (ALL as string[]).includes(value);
}

/** Reads the space from `#logistica/<space>`; defaults to «Hoy». */
export function spaceFromHash(hash: string): Space {
  const match = /^#logistica\/([a-z]+)/.exec(hash);
  return match && isSpace(match[1]) ? match[1] : 'hoy';
}

/** The day of `#logistica/calendario/2026-12-02`, or null (month view). */
export function calendarDayFromHash(hash: string): string | null {
  const match = /^#logistica\/calendario\/(\d{4}-\d{2}-\d{2})$/.exec(hash);
  return match && isLocalDate(match[1]) ? match[1] : null;
}

/** Hash of a space; the calendar adds the day when its day view is open. */
export function hashFor(space: Space, calendarDay?: string | null): string {
  if (space === 'hoy') return '#logistica';
  if (space === 'calendario' && calendarDay) {
    return `#logistica/calendario/${calendarDay}`;
  }
  return `#logistica/${space}`;
}

/** Neighbour in swipe order, or null at the ends. */
export function neighbourSpace(current: Space, step: 1 | -1): MainSpace | null {
  const ids = MAIN_SPACES.map(s => s.id);
  const index = ids.indexOf(current as MainSpace);
  if (index < 0) return step === 1 ? null : ids[ids.length - 1];
  return ids[index + step] ?? null;
}
