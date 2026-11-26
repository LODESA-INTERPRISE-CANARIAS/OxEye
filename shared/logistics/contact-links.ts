/**
 * Reaching people: phone normalisation, call / WhatsApp / e-mail links and
 * the text of a shared contact card. Pure; the UI opens a link only after the
 * user confirms it in a sheet that shows exactly what will open.
 *
 * Phones are kept as typed; these helpers only derive the dialable form.
 * Spanish numbers without a prefix (9 digits starting with 6, 7, 8 or 9) get
 * +34; anything else without a prefix cannot be sent to WhatsApp, which needs
 * the country code, and the UI says so.
 */
import type {Contact} from './contracts.ts';

export interface PhoneInfo {
  /** Digits as typed, for display («+34 000 000 001»). */
  display: string;
  /** For `tel:`: «+34922606060», or the bare digits of a short number («010»). */
  dial: string;
  /** Country code + number, digits only, for wa.me; null when the country is unknown. */
  international: string | null;
  /** A human warning when the number looks incomplete or the country is unknown. */
  warning: string | null;
  /** Machine-readable cause of `warning` (null when there is none). */
  reason: PhoneWarningReason | null;
}

export type PhoneWarningReason =
  'two_numbers' | 'missing_34' | 'incomplete' | 'unknown_country';

const SPANISH_NATIONAL = /^[6789]\d{8}$/;
/** Short public numbers: 112, 010, 016, 091, 092… */
const SHORT_NUMBER = /^(0\d{2}|1\d{2,5})$/;

export function phoneInfo(raw: string): PhoneInfo | null {
  const display = raw.trim().replace(/\s+/g, ' ');
  const plus = display.startsWith('+');
  let digits = display.replace(/\D/g, '');
  if (!digits) return null;
  let international: string | null = null;
  let reason: PhoneWarningReason | null = null;

  if (
    display.includes('/') ||
    (!plus && !digits.startsWith('00') && digits.length > 12)
  ) {
    // «922 00 00 00 / 600 00 00 00»: two numbers in one field.
    reason = 'two_numbers';
  } else if (plus || digits.startsWith('00')) {
    if (!plus) digits = digits.slice(2);
    international = digits;
    if (SPANISH_NATIONAL.test(digits)) {
      // «+600 000 000»: the + is there but the 34 is missing (+60 is another country).
      reason = 'missing_34';
    } else if (digits.startsWith('34') && digits.length !== 11) {
      reason = 'incomplete';
    } else if (digits.length < 8 || digits.length > 15) {
      reason = 'incomplete';
    }
  } else if (SPANISH_NATIONAL.test(digits)) {
    international = `34${digits}`;
  } else if (SHORT_NUMBER.test(digits)) {
    // A short public number: dialable, not a WhatsApp account.
  } else if (digits.length < 9) {
    reason = 'incomplete';
  } else {
    reason = 'unknown_country';
  }

  const spanishDigits =
    !plus && !digits.startsWith('00') ? true : digits.startsWith('34');
  return {
    display,
    dial: international ? `+${international}` : digits,
    international,
    warning: reason ? warningText(reason, spanishDigits) : null,
    reason,
  };
}

function warningText(reason: PhoneWarningReason, spanish: boolean): string {
  switch (reason) {
    case 'two_numbers':
      return 'Parece que hay dos números en el mismo campo: deja solo uno.';
    case 'missing_34':
      return '¿Falta el 34? Un número español con «+» empieza por +34.';
    case 'incomplete':
      return spanish
        ? 'El número parece incompleto: un número español tiene 9 cifras.'
        : 'El número parece incompleto.';
    case 'unknown_country':
      return 'No sabemos el prefijo del país; WhatsApp necesita el número con prefijo (+…).';
  }
}

export function telHref(info: PhoneInfo): string {
  return `tel:${info.dial}`;
}

/**
 * wa.me link, or null when the country code is unknown or the number looks
 * wrong (any `warning`): better no WhatsApp than a chat with a stranger.
 */
export function whatsappHref(info: PhoneInfo, text?: string): string | null {
  if (!info.international || info.warning) return null;
  const q = text ? `?text=${encodeURIComponent(text)}` : '';
  return `https://wa.me/${info.international}${q}`;
}

/** `mailto:` link; an empty `email` leaves the recipient for the user to choose. */
export function mailtoHref(
  email: string,
  subject?: string,
  body?: string,
): string {
  const params = [
    subject ? `subject=${encodeURIComponent(subject)}` : '',
    body ? `body=${encodeURIComponent(body)}` : '',
  ].filter(Boolean);
  const q = params.length ? `?${params.join('&')}` : '';
  return `mailto:${encodeURIComponent(email.trim()).replace(/%40/g, '@')}${q}`;
}

/**
 * Fields a contact card can share. Observations (`description`, `notes`) are
 * never shared from here: they are the team's notes about a person.
 */
export type ContactShareField = 'name' | 'role' | 'company' | 'phone' | 'email';

export const CONTACT_SHARE_FIELDS: readonly ContactShareField[] = [
  'name',
  'role',
  'company',
  'phone',
  'email',
];

export const CONTACT_SHARE_LABEL: Record<ContactShareField, string> = {
  name: 'Nombre',
  role: 'Cargo',
  company: 'Empresa o entidad',
  phone: 'Teléfono',
  email: 'Correo',
};

/** Pre-selected when the share sheet opens. */
export const DEFAULT_CONTACT_SHARE: readonly ContactShareField[] = [
  'name',
  'phone',
];

function valueOf(
  c: Pick<Contact, 'name' | 'role' | 'company' | 'phone' | 'email'>,
  field: ContactShareField,
): string | null {
  switch (field) {
    case 'name':
      return c.name;
    case 'role':
      return c.role;
    case 'company':
      return c.company?.name ?? null;
    case 'phone':
      return c.phone;
    case 'email':
      return c.email;
  }
}

/** Fields that have a value, in card order (the share sheet offers only these). */
export function shareableFields(
  c: Pick<Contact, 'name' | 'role' | 'company' | 'phone' | 'email'>,
): ContactShareField[] {
  return CONTACT_SHARE_FIELDS.filter(f => Boolean(valueOf(c, f)));
}

/**
 * Plain text of a contact card with only the chosen fields, in card order:
 * «Ana Demo · Coordinadora · Carpas Demo\nTeléfono: +34 000 000 001».
 * Empty fields and fields not chosen are left out.
 */
export function contactShareText(
  c: Pick<Contact, 'name' | 'role' | 'company' | 'phone' | 'email'>,
  fields: readonly ContactShareField[],
): string {
  const chosen = new Set(fields);
  const head = (['name', 'role', 'company'] as const)
    .filter(f => chosen.has(f))
    .map(f => valueOf(c, f))
    .filter(Boolean)
    .join(' · ');
  const lines = (['phone', 'email'] as const)
    .filter(f => chosen.has(f) && valueOf(c, f))
    .map(f => `${CONTACT_SHARE_LABEL[f]}: ${valueOf(c, f)}`);
  return [head, ...lines].filter(Boolean).join('\n');
}
