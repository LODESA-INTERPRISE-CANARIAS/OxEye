/**
 * Offer terms, requests and proposals in the Gestor's words (Revisión 1 ·
 * E6–E7). Pure: no React, no store. The rules (cost, comparison, expiry)
 * live in `shared/logistics/offer-terms.ts` and `proposals.ts`; this only
 * says them.
 */
import {formatEuros} from '../../../shared/logistics/catalogue.ts';
import type {
  LocalDate,
  Offer,
  OfferTerms,
  OfferVersion,
  OfferVersionStatus,
  ProposalState,
  ProposalVia,
  QuoteLinkStatus,
  QuoteNeed,
  Supplement,
  SupplementPer,
} from '../../../shared/logistics/contracts.ts';
import {
  legacyTerms,
  PRICE_BASIS_LABEL,
} from '../../../shared/logistics/offer-terms.ts';
import {daysBetween} from '../../../shared/logistics/time.ts';
import {dayMonthShort, plural} from '../lib/format';

// ---------------------------------------------------------------- dates

const DAY_YEAR = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** «2 dic 2026». */
export function dayYear(date: LocalDate): string {
  return DAY_YEAR.format(new Date(`${date}T12:00:00Z`)).replace(/\./g, '');
}

/** «12 – 15 dic», «12 dic», or null without dates. */
export function needDates(
  need: Pick<QuoteNeed, 'dateFrom' | 'dateTo'>,
): string | null {
  if (!need.dateFrom) return null;
  if (!need.dateTo || need.dateTo === need.dateFrom) {
    return dayMonthShort(need.dateFrom);
  }
  return `${dayMonthShort(need.dateFrom)} – ${dayMonthShort(need.dateTo)}`;
}

export type ValidityKind = 'unknown' | 'expired' | 'soon' | 'current';

export interface Validity {
  kind: ValidityKind;
  /** Days left until the deadline (negative once expired); null if unknown. */
  daysLeft: number | null;
  /** «Vigente hasta el 31 dic 2026», «Vence en 12 días», «Caducada el …». */
  text: string;
}

/** How long an offer can still be accepted. `soonDays`: «vence pronto». */
export function validityOf(
  acceptUntil: LocalDate | null,
  today: LocalDate,
  soonDays = 30,
): Validity {
  if (!acceptUntil) {
    return {
      kind: 'unknown',
      daysLeft: null,
      text: 'Sin fecha límite para aceptarla',
    };
  }
  const left = daysBetween(today, acceptUntil);
  if (left < 0) {
    return {
      kind: 'expired',
      daysLeft: left,
      text: `Caducada el ${dayYear(acceptUntil)}`,
    };
  }
  if (left === 0) {
    return {kind: 'soon', daysLeft: 0, text: 'Vence hoy'};
  }
  if (left <= soonDays) {
    return {
      kind: 'soon',
      daysLeft: left,
      text: `Vence en ${plural(left, 'día', 'días')}`,
    };
  }
  return {
    kind: 'current',
    daysLeft: left,
    text: `Vigente hasta el ${dayYear(acceptUntil)}`,
  };
}

// ---------------------------------------------------------------- labels

export const VERSION_STATUS_LABEL: Record<OfferVersionStatus, string> = {
  current: 'Vigente',
  expired: 'Caducada',
  superseded: 'Sustituida',
};

export const LINK_STATUS_LABEL: Record<QuoteLinkStatus, string> = {
  waiting: 'Sin respuesta',
  answered: 'Ha respondido',
  approved: 'Aprobada',
  rejected: 'Rechazada',
  declined: 'No puede',
  revoked: 'Enlace anulado',
};

export const PROPOSAL_STATE_LABEL: Record<ProposalState, string> = {
  pending: 'Pendiente de un administrador',
  approved: 'Aprobada',
  rejected: 'Rechazada',
};

export const VIA_LABEL: Record<ProposalVia, string> = {
  link: 'Por su enlace',
  open: 'Formulario abierto',
  manual: 'Registrada a mano',
};

/** «por unidad y jornada», «por escenario». */
export function basisText(
  terms: Pick<OfferTerms, 'basis' | 'customUnit'>,
): string {
  if (terms.basis === 'custom')
    {return terms.customUnit?.trim() || 'otra unidad';}
  return PRICE_BASIS_LABEL[terms.basis];
}

/** «195 € por unidad y jornada», or null when there is no price. */
export function priceText(
  terms: Pick<OfferTerms, 'price' | 'basis' | 'customUnit'>,
): string | null {
  if (terms.price === null) return null;
  return `${formatEuros(terms.price)} ${basisText(terms)}`;
}

const PER_TEXT: Record<SupplementPer, string> = {
  order: 'por pedido',
  unit: 'por unidad',
  unit_day: 'por unidad y jornada',
  day: 'por jornada',
  percent: 'del precio base',
};

/** «Transporte · 120 € por pedido», «Montaje · incluido», «Limpieza nocturna · sin precio». */
export function supplementText(s: Supplement): string {
  if (s.included) return `${s.label} · incluido`;
  if (s.amount === null) return `${s.label} · sin precio`;
  const amount =
    s.per === 'percent'
      ? `${s.amount.toLocaleString('es-ES')} %`
      : formatEuros(s.amount);
  return `${s.label} · ${amount} ${PER_TEXT[s.per]}`;
}

/** «3 carpas · 4 jornadas · 12 – 15 dic». */
export function needText(
  need: Pick<
    QuoteNeed,
    'quantity' | 'unitLabel' | 'days' | 'dateFrom' | 'dateTo'
  >,
): string {
  const unit = need.unitLabel?.trim() || 'unidades';
  const parts = [
    `${need.quantity.toLocaleString('es-ES')} ${need.quantity === 1 ? singular(unit) : unit}`,
    plural(need.days, 'jornada', 'jornadas'),
  ];
  const dates = needDates(need);
  if (dates) parts.push(dates);
  return parts.join(' · ');
}

/** «carpas» → «carpa», «unidades» → «unidad»: enough for the usual words. */
function singular(word: string): string {
  if (/des$/.test(word)) return word.slice(0, -2);
  if (/[aeiou]s$/.test(word)) return word.slice(0, -1);
  return word;
}

// ---------------------------------------------------------------- terms of an offer

export interface OfferTermsView {
  terms: OfferTerms;
  version: OfferVersion | null;
  /** Recorded before versions: no dates, costs only as written. */
  legacy: boolean;
}

/** The terms in force of a catalogue offer: its version, else its old data. */
export function termsOfOffer(
  offer: Offer,
  version: OfferVersion | null | undefined,
): OfferTermsView {
  if (version) return {terms: version.terms, version, legacy: false};
  return {terms: legacyTerms(offer), version: null, legacy: true};
}

// ---------------------------------------------------------------- sharing a link

/**
 * The address to share: this Gestor's own address (origin and path, so a
 * Gestor served under a sub-path works) with the link's `#logistica/…`
 * part. Falls back to the server's address when it has no `#`.
 */
export function shareableUrl(
  serverUrl: string,
  location: Pick<Location, 'origin' | 'pathname'>,
): string {
  const at = serverUrl.indexOf('#');
  if (at < 0) return serverUrl;
  return `${location.origin}${location.pathname}${serverUrl.slice(at)}`;
}

/** A Gestor opened as localhost only works on this computer. */
export function isLocalOnly(hostname: string): boolean {
  return /^(localhost|127(\.\d+){3}|\[?::1\]?)$/i.test(hostname);
}

export const LOCAL_LINK_WARNING =
  'Este enlace solo funciona en este ordenador. Abre el Gestor con la dirección del equipo (npm run equipo) antes de enviarlo.';

export interface LinkMessage {
  /** Who asks («Ayuntamiento de La Laguna»). */
  organization: string;
  /** Who sends it (the signed-in person). */
  sender: string;
  company: string;
  need: Pick<
    QuoteNeed,
    'title' | 'quantity' | 'unitLabel' | 'days' | 'dateFrom' | 'dateTo' | 'note'
  >;
  url: string;
  expiresOn: LocalDate;
}

/** Subject and body of the e-mail (or message) that carries a personal link. */
export function linkMessage(m: LinkMessage): {subject: string; body: string} {
  const lines = [
    `Hola, ${m.company}:`,
    '',
    `Desde ${m.organization} te pedimos presupuesto para: ${m.need.title} (${needText(m.need)}).`,
  ];
  if (m.need.note?.trim()) lines.push('', m.need.note.trim());
  lines.push(
    '',
    'Puedes responder desde el móvil en este enlace personal, sin crear cuenta:',
    m.url,
    '',
    `El enlace sirve hasta el ${dayYear(m.expiresOn)} y solo para esta solicitud. Si no puedes atenderla, indícalo en el mismo enlace.`,
    '',
    'Gracias,',
    m.sender,
  );
  return {
    subject: `Petición de presupuesto · ${m.need.title}`,
    body: lines.join('\n'),
  };
}

/** `mailto:` that opens the user's own mail with the message ready. */
export function mailtoHref(email: string | null, m: LinkMessage): string {
  const {subject, body} = linkMessage(m);
  const to = email ? encodeURIComponent(email) : '';
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
