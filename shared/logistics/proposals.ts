/**
 * Quote requests and supplier proposals (Revisión 1 · E6–E7): limits, the
 * personal link addresses, the privacy text, the terms each proposed product
 * becomes and the points an administrator checks before approving. Pure;
 * shared by the server and the UI.
 */
import type {
  LocalDate,
  OfferTerms,
  ProposalContent,
  ProposalProductInput,
  TaxInfo,
} from './contracts.ts';
import {sameTax, taxRate} from './money.ts';
import {addDays} from './time.ts';

// ---------------------------------------------------------------- limits

/** Companies one request goes to. */
export const QUOTE_MAX_COMPANIES = 20;
export const QUOTE_LINK_DAYS_DEFAULT = 7;
export const QUOTE_LINK_DAYS_MAX = 60;
export const QUOTE_TITLE_MAX = 200;
export const QUOTE_NOTE_MAX = 1000;
export const QUOTE_UNIT_MAX = 40;

export const PROPOSAL_MAX_PRODUCTS = 10;
export const PROPOSAL_MAX_ANSWERS = 40;
export const PROPOSAL_KEY_MAX = 40;
export const PROPOSAL_ANSWER_MAX = 500;
export const PROPOSAL_ORIGIN_MAX = 200;
export const PROPOSAL_REASON_MIN = 3;
export const PROPOSAL_REASON_MAX = 280;
/** A public proposal body is at most this big (the rest of the API: 100 KB). */
export const PROPOSAL_BODY_MAX_BYTES = 48 * 1024;

// ---------------------------------------------------------------- links

/** Personal and open links: 32 random bytes, base64url (43 characters). */
export const LINK_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/*
 * Link addresses are relative to the web's address (the server prefixes
 * `${base}/`). The token travels in the fragment, so it never reaches a
 * server, a proxy or a log.
 */

/** `gestor-logistico/proveedor#<token>`: the company's personal form for one request. */
export function supplierLinkHash(token: string): string {
  return `gestor-logistico/proveedor#${token}`;
}

/** `gestor-logistico/proveedor/abierto#<token>`: the open «presentar oferta» form. */
export function openOfferLinkHash(token: string): string {
  return `gestor-logistico/proveedor/abierto#${token}`;
}

const SUPPLIER_LINK =
  /^\/?gestor-logistico\/proveedor(\/abierto)?\/?#([A-Za-z0-9_-]{43})$/;
/** The form sent before 2026-11-28, still honoured. */
const LEGACY_SUPPLIER_LINK =
  /^#logistica\/proveedor\/(abierto\/)?([A-Za-z0-9_-]{43})$/;

/**
 * Kind and token of a supplier link, or null. Reads the address and fragment
 * together (`/gestor-logistico/proveedor#<token>`) or a legacy fragment
 * alone (`#logistica/proveedor/<token>`).
 */
export function parseSupplierLink(
  location: string,
): {kind: 'request' | 'open'; token: string} | null {
  const m = SUPPLIER_LINK.exec(location) ?? LEGACY_SUPPLIER_LINK.exec(location);
  if (!m) return null;
  return {kind: m[1] ? 'open' : 'request', token: m[2] as string};
}

// ---------------------------------------------------------------- privacy

/**
 * Drafted by the team; to be reviewed by the organization's legal service
 * before real use (decision 2026-11-27). Bump the version when it changes:
 * each proposal stores the one it accepted.
 */
export const SUPPLIER_PRIVACY_VERSION = '2026-11-27-borrador';

export const SUPPLIER_PRIVACY_TEXT =
  'Los datos que envías (empresa, persona de contacto, teléfono, correo y la oferta) los recibe la organización que te ha pedido presupuesto, solo para estudiar tu oferta y contactar contigo sobre ella. No se publican ni los ve ninguna otra empresa. Puedes pedir que se corrijan o se borren escribiendo a quien te envió el enlace. Texto pendiente de revisión jurídica.';

// ---------------------------------------------------------------- terms

/** A validity choice of the form → its acceptance deadline. */
export function acceptUntilFor(
  choice: '30d' | '3m' | '6m' | '1y' | '2y',
  today: LocalDate,
): LocalDate {
  const days = {'30d': 30, '3m': 91, '6m': 182, '1y': 365, '2y': 730}[choice];
  return addDays(today, days);
}

function joinText(...parts: (string | null | undefined)[]): string | null {
  const kept = parts.map(p => p?.trim()).filter((p): p is string => !!p);
  return kept.length ? kept.join('\n') : null;
}

/** The terms one product of a proposal becomes (a new offer version). */
export function proposalTerms(
  content: Pick<
    ProposalContent,
    | 'tax'
    | 'pricesIncludeTax'
    | 'acceptUntil'
    | 'serviceMonths'
    | 'serviceNote'
    | 'commitment'
    | 'conditions'
  >,
  product: ProposalProductInput,
): OfferTerms {
  return {
    basis: product.basis,
    customUnit:
      product.basis === 'custom' ? (product.customUnit ?? null) : null,
    price: product.price,
    pricesIncludeTax: content.pricesIncludeTax,
    seasonal: product.seasonal ?? [],
    supplements: product.supplements ?? [],
    notIncluded: product.notIncluded ?? [],
    minimumDays: product.minimumDays ?? null,
    minimumQuantity: product.minimumQuantity ?? null,
    minimumOrder: product.minimumOrder ?? null,
    acceptUntil: content.acceptUntil,
    serviceMonths: content.serviceMonths,
    serviceNote: content.serviceNote ?? null,
    commitment: content.commitment
      ? {
          years: content.commitment.years,
          price: product.commitmentPrice ?? null,
          conditions: content.commitment.conditions ?? null,
        }
      : null,
    conditions: joinText(product.conditions, content.conditions),
    available: product.available ?? null,
    tax: content.tax,
  };
}

/**
 * The tax a proposal brings into the catalogue: as stated, «por verificar»,
 * unless it is the company's known and validated tax (then validated).
 */
export function proposalTax(
  stated: TaxInfo | null,
  companyTax: TaxInfo | null,
): TaxInfo | null {
  if (!stated) return null;
  const toVerify: TaxInfo = {...stated, verification: 'to_verify'};
  if (
    companyTax?.verification === 'validated' &&
    sameTax(toVerify, {...companyTax, verification: 'to_verify'})
  ) {
    return {...stated, verification: 'validated'};
  }
  return toVerify;
}

const TAX_NAME: Record<TaxInfo['regime'], string> = {
  igic: 'IGIC',
  iva: 'IVA',
  other: 'Impuesto',
  none: 'Sin impuesto',
  unknown: 'Impuesto sin saber',
};

/**
 * Points to check before approving, plain Spanish, in a stable order:
 * missing tax or prices, tax to verify, prices with tax, unpriced extras,
 * multi-year deals, a near or missing deadline.
 */
export function proposalFlags(
  content: Pick<
    ProposalContent,
    | 'tax'
    | 'pricesIncludeTax'
    | 'acceptUntil'
    | 'commitment'
    | 'products'
    | 'serviceMonths'
  >,
  today: LocalDate,
): string[] {
  const flags: string[] = [];
  const tax = content.tax;
  if (!tax || tax.regime === 'unknown') {
    flags.push('Falta el impuesto');
  } else if (tax.verification === 'to_verify' && tax.regime !== 'none') {
    const rate = taxRate(tax);
    const name =
      tax.regime === 'other' ? (tax.name ?? 'Impuesto') : TAX_NAME[tax.regime];
    flags.push(
      `${name}${rate !== null ? ` ${rate.toLocaleString('es-ES')} %` : ''} · por verificar`,
    );
  }
  if (content.pricesIncludeTax === true) {
    flags.push('Precios con impuesto incluido');
  }
  if (content.pricesIncludeTax === null) {
    flags.push('No dice si el precio incluye impuesto');
  }
  for (const p of content.products) {
    if (p.price === null) flags.push(`${p.name}: sin precio`);
    for (const s of p.supplements ?? []) {
      if (!s.included && s.amount === null && s.applies === 'always') {
        flags.push(`${s.label} sin precio`);
      }
    }
  }
  if (content.commitment) {
    flags.push(`Compromiso de ${content.commitment.years} años`);
  }
  if (content.acceptUntil === null) {
    flags.push('Sin fecha límite para aceptar');
  } else if (content.acceptUntil < today) {
    flags.push('Ya ha vencido');
  } else if (content.acceptUntil <= addDays(today, 7)) {
    flags.push('Vence en menos de una semana');
  }
  if (content.serviceMonths === null) {
    flags.push('No dice cuándo puede dar el servicio');
  }
  return [...new Set(flags)];
}
