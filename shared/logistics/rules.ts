/**
 * Domain constants shared by the server (validation) and the UI (forms,
 * labels), so both sides accept exactly the same values.
 */
import type {
  CompanyKind,
  EventStatus,
  PriceUnit,
  TaskKind,
  TaskStatus,
} from './contracts.ts';

/** Display order: the life of an event, from set-up to tear-down. */
export const TASK_KINDS = [
  'assembly',
  'activity',
  'dismantling',
  'transport',
  'delivery',
  'other',
] as const satisfies readonly TaskKind[];

export const TASK_STATUSES = [
  'planned',
  'confirmed',
  'in_progress',
  'done',
  'delayed',
  'cancelled',
] as const satisfies readonly TaskStatus[];

export const EVENT_STATUSES = [
  'planned',
  'confirmed',
  'delayed',
  'cancelled',
] as const satisfies readonly EventStatus[];

/** Longest multi-day span accepted (a typo in the year would fill the calendar). */
export const MAX_SPAN_DAYS = 366;

// ---------------------------------------------------------------- contacts and catalogue (M3)

export const COMPANY_KINDS = [
  'supplier',
  'public_body',
  'association',
  'other',
] as const satisfies readonly CompanyKind[];

export const COMPANY_KIND_LABEL: Record<CompanyKind, string> = {
  supplier: 'Proveedor',
  public_body: 'Organismo público',
  association: 'Asociación',
  other: 'Otra entidad',
};

export const PRICE_UNITS = [
  'unit',
  'metre',
  'hour',
  'day',
  'km',
  'pack',
  'custom',
] as const satisfies readonly PriceUnit[];

/**
 * Service categories every organization starts with, in display order (the
 * spectrum of the product vision). Users add more; built-ins stay.
 */
export const BUILT_IN_SERVICE_CATEGORIES = [
  'Montaje',
  'Estructuras',
  'Carpas',
  'Vallas',
  'Transporte',
  'Catering',
  'Publicidad',
  'Personal',
  'Seguridad',
  'Sonido',
  'Iluminación',
  'Audiovisuales',
  'Limpieza',
  'Ocio',
  'Otros servicios',
] as const;

export const CATEGORY_NAME_MAX = 60;
/** Highest amount accepted for a price or cost, in euros. */
export const MAX_AMOUNT_EUR = 10_000_000;
export const PHONE_MAX = 50;
export const EMAIL_MAX = 254;
export const WEBSITE_MAX = 500;
export const ROLE_MAX = 120;
export const CUSTOM_UNIT_MAX = 60;
export const MAX_CATEGORIES_PER_COMPANY = 20;
export const MAX_EVENTS_PER_CONTACT = 100;
export const RECENT_SEARCH_MAX_LENGTH = 100;
export const RECENT_SEARCHES_KEPT = 5;

/**
 * A phone as typed on site: digits with spaces, dots, dashes, slashes,
 * brackets and an optional leading +; at least 3 digits (short municipal
 * numbers such as 112 or 010 are valid). Rejects free text («mañana lo paso»).
 */
export function isPlausiblePhone(value: string): boolean {
  const v = value.trim();
  if (v.length > PHONE_MAX) return false;
  if (!/^\+?[0-9 ().\-/]+$/.test(v)) return false;
  return (v.match(/[0-9]/g) ?? []).length >= 3;
}

/** Loose e-mail shape: something@domain.tld, no spaces. */
export function isPlausibleEmail(value: string): boolean {
  const v = value.trim();
  return v.length <= EMAIL_MAX && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

/** An amount in euros: finite, 0 – MAX_AMOUNT_EUR, at most two decimals. */
export function isValidAmount(value: number): boolean {
  return (
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_AMOUNT_EUR &&
    Math.abs(Math.round(value * 100) - value * 100) < 1e-6
  );
}
