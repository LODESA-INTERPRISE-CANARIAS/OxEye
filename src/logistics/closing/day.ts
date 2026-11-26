/**
 * Presentation helpers for «Cierre de jornada»: the day in the link, the
 * sections in reading order, the figures of the summary and the groupings
 * of the plan lists. Pure: no React, no store, no DOM. The report itself is
 * always `buildDayReport` (shared/logistics/day-report.ts).
 */
import type {LocalDate} from '../../../shared/logistics/contracts.ts';
import {
  DAY_RECORD_LABEL,
  type DayRecordLine,
  type DayRecordType,
  type DayReport,
} from '../../../shared/logistics/day-report.ts';
import {isLocalDate, utcToLocal} from '../../../shared/logistics/time.ts';
import {dayMonthShort} from '../lib/format';

export const CLOSE_HASH = '#logistica/cierre';

/** The day of `#logistica/cierre/2026-12-02`, or null. */
export function dayFromHash(hash: string): LocalDate | null {
  const match = /^#logistica\/cierre\/(\d{4}-\d{2}-\d{2})$/.exec(hash);
  return match && isLocalDate(match[1]) ? match[1] : null;
}

/** Today keeps the plain link (a bookmark always opens today's close). */
export function hashForDay(date: LocalDate, today: LocalDate): string {
  return date === today ? CLOSE_HASH : `${CLOSE_HASH}/${date}`;
}

/** A day close is about a day that happened: later days fall back to today. */
export function clampDay(date: LocalDate, today: LocalDate): LocalDate {
  return date > today ? today : date;
}

/** «2 dic 2026, 20:04» in `timeZone`, for the page's footer. */
export function stampText(instant: string, timeZone: string): string {
  const local = utcToLocal(instant, timeZone);
  return `${dayMonthShort(local.date)} ${local.date.slice(0, 4)}, ${local.time}`;
}

export type RecordSectionKey = keyof DayReport['records'];

export interface RecordSection {
  key: RecordSectionKey;
  type: DayRecordType;
  title: string;
}

/** Reading order of «Lo registrado», as the product vision lists it. */
export const RECORD_SECTIONS: readonly RecordSection[] = [
  {key: 'events', type: 'event', title: 'Eventos creados o modificados'},
  {key: 'tasks', type: 'task', title: 'Tareas acordadas o cambiadas'},
  {key: 'contacts', type: 'contact', title: 'Personas nuevas'},
  {key: 'companies', type: 'company', title: 'Empresas y entidades nuevas'},
  {key: 'resources', type: 'resource', title: 'Recursos inventariados'},
  {key: 'offers', type: 'offer', title: 'Ofertas incorporadas'},
  {key: 'warehouses', type: 'warehouse', title: 'Almacenes nuevos'},
];

export interface CountTile {
  type: DayRecordType;
  label: string;
  created: number;
  modified: number;
  deleted: number;
  /** Records touched (created or modified); deletions apart. */
  total: number;
}

/** Summary tiles; notes only for members (guests never see notes). */
export function countTiles(report: DayReport): CountTile[] {
  const types: DayRecordType[] = [
    ...RECORD_SECTIONS.map(s => s.type),
    ...(report.notes ? (['note'] as const) : []),
  ];
  return types.map(type => {
    const c = report.counts[type];
    return {
      type,
      label: DAY_RECORD_LABEL[type],
      created: c.created,
      modified: c.modified,
      deleted: c.deleted,
      total: c.created + c.modified,
    };
  });
}

/** «2 nuevos · 1 con cambios · 1 borrado», only the parts that apply. */
export function tileDetail(tile: CountTile): string {
  const parts: string[] = [];
  if (tile.created) {
    parts.push(`${tile.created} ${tile.created === 1 ? 'nuevo' : 'nuevos'}`);
  }
  if (tile.modified) parts.push(`${tile.modified} con cambios`);
  if (tile.deleted) {
    parts.push(
      `${tile.deleted} ${tile.deleted === 1 ? 'borrado' : 'borrados'}`,
    );
  }
  return parts.length ? parts.join(' · ') : 'Sin cambios';
}

/** Every change counted that day, deletions included. */
export function totalChanges(report: DayReport): number {
  return Object.values(report.counts).reduce(
    (sum, c) => sum + c.created + c.modified + c.deleted,
    0,
  );
}

/**
 * Nothing happened that day: no change counted or listed, no note written
 * that day (earlier open ones are still waiting, not news) and no
 * hypothesis explored or applied.
 */
export function isQuietDay(report: DayReport): boolean {
  const lines = RECORD_SECTIONS.some(s => report.records[s.key].length > 0);
  const notes = report.notes?.some(s => s.items.some(n => !n.earlier)) ?? false;
  const hypotheses =
    !!report.hypotheses &&
    report.hypotheses.open.length + report.hypotheses.applied.length > 0;
  return (
    !lines &&
    !notes &&
    !hypotheses &&
    !report.otherNotes &&
    totalChanges(report) === 0
  );
}

/** Titles of the note sections whose text goes into the page. */
export function includedTextTitles(report: DayReport): string[] {
  return (report.notes ?? [])
    .filter(s => s.textIncluded && s.items.some(n => n.text))
    .map(s => s.title);
}

/** «Decisiones», «Decisiones e Incidencias», «A, B y C». */
export function listJoin(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  const last = items[items.length - 1];
  // «e» before an /i/ sound («e Incidencias»), not before «hie-», «hia-».
  const glue = /^h?i(?![aeo])/i.test(last) ? ' e ' : ' y ';
  return `${items.slice(0, -1).join(', ')}${glue}${last}`;
}

/** «incidencias, decisiones ni preguntas», after «Sin». */
export function listNi(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} ni ${items[items.length - 1]}`;
}

/** What the page says about note text, on screen and in print. */
export function noteTextSummary(report: DayReport): string | null {
  if (!report.notes) return null;
  const titles = includedTextTitles(report);
  return titles.length
    ? `Incluye el texto de: ${listJoin(titles)}.`
    : 'Las notas aparecen por su tipo y estado, sin su texto.';
}

/** Records the summary counts as «nuevo» in a line («Nuevo» / «Cambios»). */
export function changeLabel(line: DayRecordLine): string {
  return line.change === 'created' ? 'Nuevo' : 'Cambios';
}

/**
 * Lines grouped under the first of `days` they occupy, in the order of
 * `days`; a line whose days are unknown goes under its own date.
 */
export function groupByDay<T extends {id: string; date: LocalDate | null}>(
  lines: readonly T[],
  days: readonly LocalDate[],
  occupied: (line: T) => readonly LocalDate[],
): {day: LocalDate; items: T[]}[] {
  const groups = new Map<LocalDate, T[]>(days.map(d => [d, []]));
  for (const line of lines) {
    const own = occupied(line);
    const day = days.find(d => own.includes(d)) ?? line.date ?? days[0];
    if (!day) continue;
    const list = groups.get(day) ?? [];
    list.push(line);
    groups.set(day, list);
  }
  return [...groups.entries()]
    .filter(([, items]) => items.length > 0)
    .map(([day, items]) => ({day, items}));
}
