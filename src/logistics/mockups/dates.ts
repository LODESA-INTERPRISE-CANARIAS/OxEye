/** Date helpers for the mock-ups (local calendar dates, `YYYY-MM-DD`). */
import {MOCK_TODAY} from './data';

const DAY = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

const anchor = (iso: string) => new Date(`${iso}T12:00:00Z`);

/** «27 dic 2026». */
export function fmtDay(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return DAY.format(anchor(iso)).replace('.', '');
}

export function addDays(iso: string, days: number): string {
  const d = anchor(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addMonths(iso: string, months: number): string {
  const d = anchor(iso);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** Whole days from the mock's «today» to `iso` (negative when past). */
export function daysFromToday(iso: string): number {
  return Math.round(
    (anchor(iso).getTime() - anchor(MOCK_TODAY).getTime()) / 86_400_000,
  );
}

/** «vence en 30 días», «vence mañana», «caducó hace 58 días». */
export function expiryText(iso: string): string {
  const n = daysFromToday(iso);
  if (n < 0) return `caducó hace ${-n} ${-n === 1 ? 'día' : 'días'}`;
  if (n === 0) return 'vence hoy';
  if (n === 1) return 'vence mañana';
  return `vence en ${n} días`;
}
