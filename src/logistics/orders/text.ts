/**
 * Pure helpers for the work-order sheet: which days a recipient has tasks
 * on, the day chosen by default, the «generated at» stamp and the outgoing
 * e-mail and WhatsApp links. The order itself is `buildWorkOrder` /
 * `workOrderText` (shared); nothing here decides what an order contains.
 */
import {
  mailtoHref,
  whatsappHref,
  type PhoneInfo,
} from '../../../shared/logistics/contact-links.ts';
import type {Task} from '../../../shared/logistics/contracts.ts';
import type {WorkOrder} from '../../../shared/logistics/work-order.ts';
import {DEFAULT_TIMEZONE, utcToLocal} from '../../../shared/logistics/time.ts';
import {dayMonthShort} from '../lib/format';
import {recordDays} from '../lib/tasks';

/** A day filter: a local date, every task, or tasks without a date. */
export type OrderDay = string | 'all' | 'undated';

/** Days with tasks (sorted) and whether some task has no date. */
export function orderDays(tasks: Task[]): {days: string[]; undated: boolean} {
  const days = new Set<string>();
  let undated = false;
  for (const t of tasks) {
    const list = recordDays(t);
    if (!list.length) undated = true;
    for (const d of list) days.add(d);
  }
  return {days: [...days].sort(), undated};
}

/** Today when it has tasks, else the next day with tasks, else every task. */
export function defaultOrderDay(days: string[], today: string): OrderDay {
  if (days.includes(today)) return today;
  return days.find(d => d > today) ?? 'all';
}

export function tasksOnDay(tasks: Task[], day: OrderDay): Task[] {
  if (day === 'all') return tasks;
  if (day === 'undated') return tasks.filter(t => !recordDays(t).length);
  return tasks.filter(t => recordDays(t).includes(day));
}

/** «26 nov 2026, 10:32» in the organization's time zone. */
export function generatedAtText(
  now: number,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  const local = utcToLocal(new Date(now).toISOString(), timeZone);
  return `${dayMonthShort(local.date)} ${local.date.slice(0, 4)}, ${local.time}`;
}

/** Days the order covers, as its header shows them. */
export function orderDaysLabel(order: WorkOrder): string | null {
  const days = [...new Set(order.items.map(i => i.day).filter(Boolean))];
  if (!days.length) return null;
  return days.length === 1 ? days[0] : days.join(' · ');
}

/** Above this length some mail programs cut or refuse a `mailto:` link. */
export const MAILTO_MAX = 1800;

export const MAILTO_SHORT_BODY =
  'El texto de la orden de trabajo está copiado: pégalo aquí.';

export const WHATSAPP_SHORT_TEXT =
  'Te envío la orden de trabajo: el texto está copiado, pégalo aquí.';

/**
 * An outgoing link for an order. When the full link would be too long,
 * `short` is true: `href` then says the text was copied (use it only after
 * the copy succeeded) and `plainHref` carries no claim (for a failed copy).
 */
export interface OrderLink {
  href: string;
  short: boolean;
  plainHref: string;
}

/** The e-mail link: subject = order title, body = the order's text. */
export function orderMailto(
  email: string | null,
  subject: string,
  body: string,
): OrderLink {
  const full = mailtoHref(email ?? '', subject, body);
  const plainHref = mailtoHref(email ?? '', subject);
  if (full.length <= MAILTO_MAX) return {href: full, short: false, plainHref};
  return {
    href: mailtoHref(email ?? '', subject, MAILTO_SHORT_BODY),
    short: true,
    plainHref,
  };
}

/** The WhatsApp link with the order's text, or null when WhatsApp can't be used. */
export function orderWhatsapp(info: PhoneInfo, text: string): OrderLink | null {
  const full = whatsappHref(info, text);
  const plainHref = whatsappHref(info);
  if (!full || !plainHref) return null;
  if (full.length <= MAILTO_MAX) return {href: full, short: false, plainHref};
  return {
    href: whatsappHref(info, WHATSAPP_SHORT_TEXT) ?? plainHref,
    short: true,
    plainHref,
  };
}
