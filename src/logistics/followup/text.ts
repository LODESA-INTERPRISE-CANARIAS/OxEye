/**
 * Plain Spanish for the «¿Y si…?» sheet and the quick actions: amounts, the
 * one-sentence summary of a delay analysis, event margins and the label of a
 * saved hypothesis. Pure; the analysis itself is `analyzeDelay` (shared).
 */
import {minutesLabel} from '../../../shared/logistics/conflicts.ts';
import type {
  DelayHypothesis,
  DelayMode,
} from '../../../shared/logistics/contracts.ts';
import type {
  DelayAnalysis,
  EventMargin,
} from '../../../shared/logistics/followup.ts';
import {hypothesisLabel} from '../../../shared/logistics/history.ts';
import {MAX_DELAY_MINUTES} from '../../../shared/logistics/rules.ts';
import {DEFAULT_TIMEZONE, utcToLocal} from '../../../shared/logistics/time.ts';
import {dayMonthShort, instantShort} from '../lib/format';

/** «≈ 15 min» for an estimate, «15 min» for a known delay. */
export function amountText(minutes: number, estimated: boolean): string {
  return `${estimated ? '≈ ' : ''}${minutesLabel(minutes)}`;
}

/** Whole days from one local date to another. */
function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) /
      86_400_000,
  );
}

/**
 * «08:15–13:15», «22:00–01:00 (+1 día)», «2 dic 08:00 – 4 dic 18:00» when it
 * spans more days, «Desde las 08:15».
 */
export function slotText(
  startsAt: string | null,
  endsAt: string | null,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  const s = startsAt ? utcToLocal(startsAt, timeZone) : null;
  const e = endsAt ? utcToLocal(endsAt, timeZone) : null;
  if (s && e) {
    const days = daysBetween(s.date, e.date);
    if (days > 1) {
      return `${dayMonthShort(s.date)} ${s.time} – ${dayMonthShort(e.date)} ${e.time}`;
    }
    return `${s.time}–${e.time}${days === 1 ? ' (+1 día)' : ''}`;
  }
  if (s) return `Desde las ${s.time}`;
  if (e) return `Hasta las ${e.time}`;
  return 'Sin hora';
}

/** What the delay does to the task itself: «empieza ≈ 15 min más tarde». */
export function delayPhrase(
  mode: DelayMode,
  minutes: number,
  estimated: boolean,
): string {
  const amount = amountText(minutes, estimated);
  return mode === 'extend'
    ? `se alarga ${amount}`
    : `empieza ${amount} más tarde`;
}

/**
 * One sentence: what moves, and the margin the task had before anything
 * else had to move (`budget`).
 */
export function hypothesisSummary(input: {
  title: string;
  minutes: number;
  estimated: boolean;
  analysis: Pick<DelayAnalysis, 'impact' | 'budget' | 'mode'>;
}): string {
  const {title, minutes, estimated, analysis} = input;
  const {impact, budget, mode} = analysis;
  if (impact.unknown.includes(impact.rootId)) {
    return `No se puede calcular: a «${title}» le falta la hora.`;
  }
  const others = impact.shifted.filter(s => s.id !== impact.rootId).length;
  const what = `Si «${title}» ${delayPhrase(mode, minutes, estimated)}`;
  const moves =
    others === 0
      ? 'no se mueve ninguna otra tarea'
      : others === 1
        ? 'se mueve 1 tarea más'
        : `se mueven ${others} tareas más`;
  const margin =
    budget === null
      ? 'Ninguna tarea con hora espera a que termine.'
      : budget === 0
        ? 'No tenía margen: lo que va después empieza en cuanto termina.'
        : `Tenía ${minutesLabel(budget)} de margen antes de mover nada más.`;
  return `${what}, ${moves}. ${margin}`;
}

/** «Antes 2 h de margen; con el retraso, 1 h 45 min» or «entra 15 min…». */
export function marginText(m: EventMargin): {text: string; over: boolean} {
  if (m.after < 0) {
    return {
      text: `Entra ${minutesLabel(-m.after)} en el horario de «${m.eventName}».`,
      over: true,
    };
  }
  return {
    text: `«${m.eventName}»: quedan ${minutesLabel(m.after)} antes de que empiece (antes, ${minutesLabel(m.before)}).`,
    over: false,
  };
}

/**
 * «Retraso ≈ 15 min · Camión Demo · Elvis, 10:32» (the time alone when it was
 * saved today, otherwise «2 dic, 10:32»). Never the note.
 */
export function hypothesisChipLabel(
  h: Pick<
    DelayHypothesis,
    | 'delayMinutes'
    | 'mode'
    | 'estimated'
    | 'taskTitle'
    | 'createdBy'
    | 'createdAt'
  >,
  today: string,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  const local = utcToLocal(h.createdAt, timeZone);
  const when =
    local.date === today ? local.time : instantShort(h.createdAt, timeZone);
  return `${hypothesisLabel(h)} · ${h.createdBy.displayName}, ${when}`;
}

/** The minutes field: a whole number from 1 to 1440, or a Spanish error. */
export function parseDelayMinutes(
  raw: string,
): {value: number; error: null} | {value: null; error: string} {
  const text = raw.trim();
  const error = `Escribe los minutos como un número entero entre 1 y ${MAX_DELAY_MINUTES}.`;
  if (!/^\d{1,5}$/.test(text)) return {value: null, error};
  const value = Number(text);
  if (value < 1 || value > MAX_DELAY_MINUTES) return {value: null, error};
  return {value, error: null};
}
