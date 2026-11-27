/**
 * Taxes in the Gestor's words (Revisión 1 · E5): labels, the editable draft
 * behind the tax picker, and the sentence under a price. Pure: the rules
 * (default rates, validation, estimates) live in `shared/logistics/money.ts`;
 * this only says them.
 *
 * Honesty: a tax nobody stated reads «Sin indicar», never a guessed rate; an
 * amount with tax is always called «estimación».
 */
import {
  formatEuros,
  perUnitLabel,
} from '../../../shared/logistics/catalogue.ts';
import type {
  Offer,
  TaxInfo,
  TaxInput,
  TaxRegime,
} from '../../../shared/logistics/contracts.ts';
import {
  defaultTax,
  normalizeTax,
  priceEstimate,
  type PriceEstimate,
} from '../../../shared/logistics/money.ts';
import {
  TAX_ESTIMATE_LABEL,
  TAX_REGIME_LABEL,
  TAX_REGIMES,
} from '../../../shared/logistics/rules.ts';

export {TAX_REGIME_LABEL, TAX_REGIMES};

/** The `?` next to every tax picker. */
export const TAX_HELP =
  'IGIC en Canarias, IVA en la Península y Baleares; «Otro» para otro impuesto (por ejemplo IPSI). Los precios se apuntan siempre sin impuestos y la cifra con impuestos es una estimación con este porcentaje. El 7 % y el 21 % se proponen como tipo general: cámbialo si la empresa aplica otro y márcalo como verificado cuando lo confirme.';

// ---------------------------------------------------------------- percentages

const PERCENT = new Intl.NumberFormat('es-ES', {maximumFractionDigits: 2});

/** «7 %», «6,5 %». */
export function formatRate(rate: number): string {
  return `${PERCENT.format(rate)} %`;
}

/** 6.5 → «6,5»; null → ''. */
export function rateForInput(rate: number | null): string {
  return rate === null ? '' : String(rate).replace('.', ',');
}

/** «7», «6,5», «6.5 %» → number; '' → null; anything else → NaN. */
export function parseRate(text: string): number | null {
  const raw = text.replace(/%|\s/g, '');
  if (!raw) return null;
  if (!/^\d+([.,]\d*)?$/.test(raw)) return NaN;
  return Number(raw.replace(',', '.'));
}

// ---------------------------------------------------------------- labels

/** «IGIC 7 %», «IPSI 4 %», «IVA · porcentaje sin saber», «Sin impuesto». */
export function taxLabel(tax: TaxInfo | null): string {
  if (!tax) return 'Impuesto sin indicar';
  if (tax.regime === 'none') return 'Sin impuesto';
  if (tax.regime === 'unknown') return 'Impuesto sin saber';
  const name =
    tax.regime === 'other'
      ? tax.name?.trim() || 'Otro impuesto'
      : TAX_REGIME_LABEL[tax.regime];
  return tax.ratePercent === null
    ? `${name} · porcentaje sin saber`
    : `${name} ${formatRate(tax.ratePercent)}`;
}

/** «IGIC 7 % de la empresa · por verificar». */
export function taxText(
  tax: TaxInfo | null,
  opts: {inherited?: boolean} = {},
): string {
  const parts = [
    taxLabel(tax) + (opts.inherited && tax ? ' de la empresa' : ''),
  ];
  if (tax && tax.verification === 'to_verify' && tax.regime !== 'unknown') {
    parts.push('por verificar');
  }
  return parts.join(' · ');
}

// ---------------------------------------------------------------- draft

/**
 * The tax picker's editable state. `regime` '' = nothing picked: no tax
 * recorded (company) or «como la empresa» (offer).
 */
export interface TaxDraft {
  regime: TaxRegime | '';
  /** «Otro» only. */
  name: string;
  /** As typed («7», «6,5»). */
  rate: string;
  verified: boolean;
}

export const EMPTY_TAX_DRAFT: TaxDraft = {
  regime: '',
  name: '',
  rate: '',
  verified: false,
};

export function taxDraftOf(tax: TaxInfo | null): TaxDraft {
  if (!tax) return EMPTY_TAX_DRAFT;
  return {
    regime: tax.regime,
    name: tax.name ?? '',
    rate: tax.regime === 'none' ? '' : rateForInput(tax.ratePercent),
    verified: tax.verification === 'validated',
  };
}

/** A regime picked: the rate starts from the indicative default (7 % / 21 %). */
export function pickRegime(draft: TaxDraft, regime: TaxRegime | ''): TaxDraft {
  if (regime === draft.regime) return draft;
  if (regime === '') return EMPTY_TAX_DRAFT;
  const base = defaultTax(regime);
  return {
    regime,
    name: regime === 'other' ? draft.name : '',
    rate:
      regime === 'igic' || regime === 'iva'
        ? rateForInput(base.ratePercent)
        : regime === 'other'
          ? draft.rate
          : '',
    // A different regime is a new statement: to be verified again.
    verified: false,
  };
}

export type DraftResult =
  | {ok: true; tax: TaxInput | null}
  | {ok: false; field: 'name' | 'rate' | 'regime'; message: string};

/**
 * The draft as sent (`TaxInput`, null for nothing picked), checked like the
 * server does (`normalizeTax`). An empty rate for IGIC / IVA / otro is «not
 * known yet» (null), never the default.
 */
export function taxFromDraft(draft: TaxDraft): DraftResult {
  if (draft.regime === '') return {ok: true, tax: null};
  const input: TaxInput = {
    regime: draft.regime,
    verification: draft.verified ? 'validated' : 'to_verify',
  };
  if (draft.regime === 'other') input.name = draft.name;
  if (
    draft.regime === 'igic' ||
    draft.regime === 'iva' ||
    draft.regime === 'other'
  ) {
    const rate = parseRate(draft.rate);
    if (Number.isNaN(rate)) {
      return {
        ok: false,
        field: 'rate',
        message: 'Escribe el porcentaje con cifras, por ejemplo 7 o 6,5.',
      };
    }
    input.ratePercent = rate;
  }
  const result = normalizeTax(input);
  if ('fields' in result) {
    const [key, message] = Object.entries(result.fields)[0] as [string, string];
    return {
      ok: false,
      field:
        key === 'name' ? 'name' : key === 'ratePercent' ? 'rate' : 'regime',
      message,
    };
  }
  return {ok: true, tax: input};
}

/** The problem of a draft, or null when it can be sent. */
export function taxProblem(
  draft: TaxDraft,
): {field: 'name' | 'rate' | 'regime'; message: string} | null {
  const r = taxFromDraft(draft);
  return 'field' in r ? {field: r.field, message: r.message} : null;
}

/** The TaxInput to send (null for nothing picked or a draft with a problem). */
export function taxToSend(draft: TaxDraft): TaxInput | null {
  const r = taxFromDraft(draft);
  return 'tax' in r ? r.tax : null;
}

/** A draft kept by a rescued form, or null when it does not look like one. */
export function rescuedTaxDraft(raw: unknown): TaxDraft | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const regime = r.regime;
  if (regime !== '' && !(TAX_REGIMES as readonly unknown[]).includes(regime)) {
    return null;
  }
  return {
    regime: regime as TaxDraft['regime'],
    name: typeof r.name === 'string' ? r.name : '',
    rate: typeof r.rate === 'string' ? r.rate : '',
    verified: r.verified === true,
  };
}

/**
 * The form's one tax message, pinned to the part of the picker it is about
 * (a server message has no part: it goes under the regime).
 */
export function taxFieldError(
  draft: TaxDraft,
  message: string | undefined,
): {field: 'name' | 'rate' | 'regime'; message: string} | null {
  if (!message) return null;
  return {field: taxProblem(draft)?.field ?? 'regime', message};
}

/** The draft as a stored tax (for previews); null when nothing or invalid. */
export function taxInfoOfDraft(draft: TaxDraft): TaxInfo | null {
  const sent = taxToSend(draft);
  if (!sent) return null;
  const stored = normalizeTax(sent);
  return 'tax' in stored ? stored.tax : null;
}

// ---------------------------------------------------------------- price lines

export interface EstimateLine {
  /** `estimate`: a figure with tax; `included`: written with tax; `none`: nothing derivable. */
  kind: 'estimate' | 'included' | 'none';
  /** The figure («128,40 € / día»), or null. */
  amount: string | null;
  /** What the figure is, in words. */
  text: string;
  /** The tax behind it, with where it comes from. */
  tax: string | null;
}

function perUnit(
  amount: number,
  offer: Pick<Offer, 'unit' | 'customUnit'>,
): string {
  const per = perUnitLabel(offer);
  return per ? `${formatEuros(amount)} / ${per}` : formatEuros(amount);
}

/**
 * The line under an offer's price: its estimate with tax, or why there is
 * none. Null when the price itself is unknown (the price says so already).
 */
export function estimateLine(
  offer: Pick<
    Offer,
    'price' | 'vatIncluded' | 'tax' | 'companyTax' | 'unit' | 'customUnit'
  >,
  estimate: PriceEstimate = priceEstimate(offer),
): EstimateLine | null {
  if (offer.price === null) return null;
  const tax = estimate.tax
    ? taxText(estimate.tax, {inherited: estimate.inherited})
    : null;
  if (offer.vatIncluded === true) {
    return {
      kind: 'included',
      amount:
        estimate.beforeTax === null ? null : perUnit(estimate.beforeTax, offer),
      text:
        estimate.beforeTax === null
          ? 'Precio apuntado con impuestos incluidos; sin el porcentaje no se puede saber sin impuestos.'
          : `sin impuestos · ${TAX_ESTIMATE_LABEL} (el precio se apuntó con impuestos incluidos)`,
      tax,
    };
  }
  if (estimate.withTax !== null) {
    return {
      kind: 'estimate',
      amount: perUnit(estimate.withTax, offer),
      text: `con impuestos · ${TAX_ESTIMATE_LABEL}`,
      tax,
    };
  }
  return {
    kind: 'none',
    amount: null,
    text:
      estimate.missing === 'treatment'
        ? 'No consta si este precio incluye impuestos: no se estima con impuestos.'
        : !estimate.tax
          ? 'Sin estimación con impuestos: nadie ha indicado el impuesto de la empresa.'
          : estimate.tax.regime === 'unknown'
            ? 'Sin estimación con impuestos: el impuesto está como «sin saber».'
            : 'Sin estimación con impuestos: falta el porcentaje.',
    tax,
  };
}

/** How the written price is to be read, for the big price. */
export function priceBasis(vatIncluded: boolean | null): string {
  if (vatIncluded === true) {
    return 'con impuestos incluidos, tal como se apuntó';
  }
  if (vatIncluded === null) return 'no consta si incluye impuestos';
  return 'sin impuestos';
}
