/**
 * The supplier form's answers (Revisión 1 · E7) and how they become a
 * `ProposalInput`. Pure: shared by the public form and by «Registrar a mano»
 * in the inbox, and unit tested.
 *
 * Wording rules: prices are written before tax; an extra marked «se cobra
 * aparte» without a price stays «sin precio» (never 0); «no lo hacemos»
 * goes to `notIncluded`.
 */
import type {
  LocalDate,
  PriceBasis,
  ProposalInput,
  ProposalProductInput,
  SeasonRate,
  Supplement,
  SupplementKind,
  SupplementPer,
} from '../../../shared/logistics/contracts.ts';
import {
  COMMITMENT_YEARS_MAX,
  COMMITMENT_YEARS_MIN,
  DEFAULT_SEASONS,
  MAX_NEED_DAYS,
  overlappingMonth,
} from '../../../shared/logistics/offer-terms.ts';
import {
  acceptUntilFor,
  PROPOSAL_MAX_PRODUCTS,
} from '../../../shared/logistics/proposals.ts';
import {isValidAmount} from '../../../shared/logistics/rules.ts';
import {EMPTY_TAX_DRAFT, taxFromDraft, type TaxDraft} from '../budget/tax';
import {parseEuros} from '../lib/directory';

export type ExtraKey = 'transport' | 'assembly' | 'maintenance';
export type ExtraState = 'included' | 'extra' | 'no' | '';

export const EXTRA_LABEL: Record<ExtraKey, string> = {
  transport: 'Transporte',
  assembly: 'Montaje y desmontaje',
  maintenance: 'Mantenimiento durante el evento',
};

export interface ExtraDraft {
  state: ExtraState;
  price: string;
  per: Extract<SupplementPer, 'order' | 'unit' | 'day'>;
}

export interface SeasonDraft {
  label: string;
  months: number[];
  price: string;
}

export interface ProductDraft {
  key: string;
  name: string;
  description: string;
  available: string;
  basis: PriceBasis;
  customUnit: string;
  price: string;
  seasonal: boolean;
  seasons: SeasonDraft[];
  extras: Record<ExtraKey, ExtraDraft>;
  minimumDays: string;
  commitmentPrice: string;
  conditions: string;
}

export type Validity = '30d' | '3m' | '6m' | '1y' | '2y' | 'date';

export interface ProposalDraft {
  intent: 'yes' | 'similar' | 'no' | null;
  declineReason: string;
  company: {name: string; contactName: string; phone: string; email: string};
  products: ProductDraft[];
  tax: TaxDraft;
  pricesIncludeTax: 'no' | 'yes' | 'unknown';
  validity: Validity | null;
  validityDate: string;
  service: 'all' | 'months' | 'unknown' | null;
  serviceMonths: number[];
  serviceNote: string;
  commitment: 'no' | 'yes';
  commitmentYears: string;
  conditions: string;
  privacy: boolean;
  /** «Registrar a mano»: how it reached us («por teléfono»). */
  origin: string;
}

let seq = 0;

export function newProduct(name = ''): ProductDraft {
  seq += 1;
  const extra = (): ExtraDraft => ({state: '', price: '', per: 'order'});
  return {
    key: `p${Date.now().toString(36)}${seq}`,
    name,
    description: '',
    available: '',
    basis: 'unit_day',
    customUnit: '',
    price: '',
    seasonal: false,
    seasons: DEFAULT_SEASONS.map(s => ({
      label: s.label,
      months: [...s.months],
      price: '',
    })),
    extras: {transport: extra(), assembly: extra(), maintenance: extra()},
    minimumDays: '',
    commitmentPrice: '',
    conditions: '',
  };
}

export function emptyDraft(companyName = '', productName = ''): ProposalDraft {
  return {
    intent: null,
    declineReason: '',
    company: {name: companyName, contactName: '', phone: '', email: ''},
    products: [newProduct(productName)],
    tax: EMPTY_TAX_DRAFT,
    pricesIncludeTax: 'no',
    validity: null,
    validityDate: '',
    service: null,
    serviceMonths: [],
    serviceNote: '',
    commitment: 'no',
    commitmentYears: '3',
    conditions: '',
    privacy: false,
    origin: '',
  };
}

// ---------------------------------------------------------------- checks

const MONEY_ERROR = 'Escribe un importe en euros, por ejemplo 120 o 85,50.';

/** null = empty, NaN = not a valid amount. */
function money(text: string): number | null {
  const v = parseEuros(text);
  if (v === null) return null;
  return Number.isNaN(v) || !isValidAmount(v) ? NaN : v;
}

function whole(text: string, min: number, max: number): number | null {
  if (!text.trim()) return null;
  if (!/^\d+$/.test(text.trim())) return NaN;
  const n = Number(text.trim());
  return n >= min && n <= max ? n : NaN;
}

export type Problems = Record<string, string>;

/** Problems of the company step. */
export function companyProblems(d: ProposalDraft): Problems {
  const p: Problems = {};
  if (!d.company.name.trim())
    {p['company.name'] = 'Escribe el nombre de tu empresa.';}
  if (
    d.company.email.trim() &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.company.email.trim())
  ) {
    p['company.email'] = 'Revisa el correo: debe ser como nombre@empresa.es.';
  }
  return p;
}

/** Problems of one product (keys `products.<i>.<field>`). */
export function productProblems(d: ProposalDraft, i: number): Problems {
  const p: Problems = {};
  const product = d.products[i];
  if (!product) return p;
  const at = (k: string) => `products.${i}.${k}`;
  if (!product.name.trim())
    {p[at('name')] = 'Di qué ofreces, en pocas palabras.';}
  if (product.basis === 'custom' && !product.customUnit.trim()) {
    p[at('customUnit')] = 'Escribe la unidad, por ejemplo «por escenario».';
  }
  if (Number.isNaN(money(product.price))) p[at('price')] = MONEY_ERROR;
  if (Number.isNaN(whole(product.available, 0, 100_000))) {
    p[at('available')] = 'Un número entero de unidades.';
  }
  if (Number.isNaN(whole(product.minimumDays, 1, MAX_NEED_DAYS))) {
    p[at('minimumDays')] = `Un número de jornadas entre 1 y ${MAX_NEED_DAYS}.`;
  }
  if (Number.isNaN(money(product.commitmentPrice))) {
    p[at('commitmentPrice')] = MONEY_ERROR;
  }
  if (product.seasonal) {
    const used = product.seasons.filter(s => s.months.length);
    used.forEach((s, j) => {
      const v = money(s.price);
      if (v === null || Number.isNaN(v)) {
        p[at(`seasons.${j}.price`)] = 'Escribe el precio de esta temporada.';
      }
    });
    if (overlappingMonth(used.map(s => ({...s, price: 0}))) !== null) {
      p[at('seasons')] = 'Un mes no puede estar en dos temporadas.';
    }
  }
  (Object.keys(product.extras) as ExtraKey[]).forEach(k => {
    const e = product.extras[k];
    if (e.state === 'extra' && Number.isNaN(money(e.price))) {
      p[at(`extras.${k}.price`)] = MONEY_ERROR;
    }
  });
  return p;
}

export function taxProblems(d: ProposalDraft): Problems {
  const t = taxFromDraft(d.tax);
  if ('field' in t) return {[`tax.${t.field}`]: t.message};
  return {};
}

export function validityProblems(d: ProposalDraft, today: LocalDate): Problems {
  const p: Problems = {};
  if (d.validity === 'date') {
    if (!d.validityDate) p.validityDate = 'Elige la fecha.';
    else if (d.validityDate < today) {
      p.validityDate = 'Tiene que ser hoy o una fecha posterior.';
    }
  }
  if (d.service === 'months' && d.serviceMonths.length === 0) {
    p.serviceMonths = 'Marca al menos un mes, o elige «Todo el año».';
  }
  if (d.commitment === 'yes') {
    const years = whole(
      d.commitmentYears,
      COMMITMENT_YEARS_MIN,
      COMMITMENT_YEARS_MAX,
    );
    if (years === null || Number.isNaN(years)) {
      p.commitmentYears = `De ${COMMITMENT_YEARS_MIN} a ${COMMITMENT_YEARS_MAX} años.`;
    }
  }
  return p;
}

/** Every problem, for the review step. */
export function allProblems(d: ProposalDraft, today: LocalDate): Problems {
  return Object.assign(
    {},
    companyProblems(d),
    ...d.products.map((_, i) => productProblems(d, i)),
    taxProblems(d),
    validityProblems(d, today),
    d.products.length > PROPOSAL_MAX_PRODUCTS
      ? {products: `Como mucho ${PROPOSAL_MAX_PRODUCTS} productos.`}
      : {},
  );
}

// ---------------------------------------------------------------- to the API

const EXTRA_KIND: Record<ExtraKey, SupplementKind> = {
  transport: 'transport',
  assembly: 'assembly',
  maintenance: 'maintenance',
};

const nullIfEmpty = (s: string) => (s.trim() ? s.trim() : null);

function productInput(
  p: ProductDraft,
  commitment: boolean,
): ProposalProductInput {
  const supplements: Supplement[] = [];
  const notIncluded: string[] = [];
  (Object.keys(p.extras) as ExtraKey[]).forEach(k => {
    const e = p.extras[k];
    if (e.state === 'included' || e.state === 'extra') {
      const amount = e.state === 'extra' ? money(e.price) : null;
      supplements.push({
        label: EXTRA_LABEL[k],
        kind: EXTRA_KIND[k],
        included: e.state === 'included',
        amount: amount === null || Number.isNaN(amount) ? null : amount,
        per: e.per,
        applies: 'always',
      });
    } else if (e.state === 'no') {
      notIncluded.push(EXTRA_LABEL[k]);
    }
  });
  const seasonal: SeasonRate[] = p.seasonal
    ? p.seasons
        .filter(s => s.months.length && money(s.price) !== null)
        .map(s => ({
          label: s.label.trim() || 'Temporada',
          months: [...s.months].sort((a, b) => a - b),
          price: money(s.price) as number,
        }))
    : [];
  const available = whole(p.available, 0, 100_000);
  const minimumDays = whole(p.minimumDays, 1, MAX_NEED_DAYS);
  const price = money(p.price);
  const commitmentPrice = money(p.commitmentPrice);
  return {
    key: p.key,
    categoryKey: null,
    name: p.name.trim(),
    description: nullIfEmpty(p.description),
    available: available === null || Number.isNaN(available) ? null : available,
    basis: p.basis,
    customUnit: p.basis === 'custom' ? nullIfEmpty(p.customUnit) : null,
    price: price === null || Number.isNaN(price) ? null : price,
    seasonal,
    supplements,
    notIncluded,
    minimumDays:
      minimumDays === null || Number.isNaN(minimumDays) ? null : minimumDays,
    commitmentPrice:
      commitment && commitmentPrice !== null && !Number.isNaN(commitmentPrice)
        ? commitmentPrice
        : null,
    conditions: nullIfEmpty(p.conditions),
  };
}

/** The draft as sent. `today` turns «3 meses» into a date. */
export function proposalInputOf(
  d: ProposalDraft,
  today: LocalDate,
  opts: {publicForm: boolean},
): ProposalInput {
  const tax = taxFromDraft(d.tax);
  const commitment = d.commitment === 'yes';
  return {
    intent: d.intent === 'similar' ? 'similar' : 'yes',
    company: {
      name: d.company.name.trim(),
      contactName: nullIfEmpty(d.company.contactName),
      phone: nullIfEmpty(d.company.phone),
      email: nullIfEmpty(d.company.email),
    },
    products: d.products.map(p => productInput(p, commitment)),
    tax: tax.ok ? tax.tax : null,
    pricesIncludeTax:
      d.pricesIncludeTax === 'unknown' ? null : d.pricesIncludeTax === 'yes',
    acceptUntil:
      d.validity === 'date'
        ? d.validityDate || null
        : d.validity
          ? acceptUntilFor(d.validity, today)
          : null,
    serviceMonths:
      d.service === 'all'
        ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
        : d.service === 'months'
          ? [...d.serviceMonths].sort((a, b) => a - b)
          : null,
    serviceNote: nullIfEmpty(d.serviceNote),
    commitment: commitment
      ? {years: Number(d.commitmentYears), conditions: null}
      : null,
    conditions: nullIfEmpty(d.conditions),
    ...(opts.publicForm ? {privacyAccepted: d.privacy} : {}),
  };
}

/** A server field path (`products.0.price`) as the form's own key. */
export function draftKeyOf(path: string): string {
  return path
    .replace(/^proposal\./, '')
    .replace(/^products\.(\d+)\.seasonal\./, 'products.$1.seasons.')
    .replace(/^tax\.ratePercent$/, 'tax.rate')
    .replace(/^tax$/, 'tax.regime')
    .replace(/^acceptUntil$/, 'validityDate');
}
