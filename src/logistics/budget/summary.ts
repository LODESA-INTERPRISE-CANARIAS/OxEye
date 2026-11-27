/**
 * An event's budget in words and proportions (Revisión 1 · E5). Pure: the
 * sums come from `budgetSummary` (shared/logistics/money.ts); this decides
 * what the budget sheet says and how wide each part of its ribbon is.
 *
 * Honesty: every figure with tax is an estimate («estimación»); expenses
 * missing from it (no amount, or no known tax) are counted and said, so the
 * remaining figure is never presented as more certain than it is.
 */
import {
  formatEuros,
  perUnitLabel,
} from '../../../shared/logistics/catalogue.ts';
import type {
  BudgetSummary,
  Expense,
  OfferSnapshot,
} from '../../../shared/logistics/contracts.ts';
import {withTax} from '../../../shared/logistics/money.ts';
import {TAX_ESTIMATE_LABEL} from '../../../shared/logistics/rules.ts';
import {instantShort, plural} from '../lib/format';
import {taxText} from './tax';

/** The `?` of the budget sheet. */
export const BUDGET_HELP =
  'El presupuesto es lo que el evento puede gastar, con impuestos. Cada gasto se apunta sin impuestos y se le suma su propio impuesto para estimar lo gastado: es una estimación, no contabilidad ni facturas. Confirmado: está cerrado con la empresa. Previsto: está en el plan, aún sin cerrar.';

// ---------------------------------------------------------------- ribbon

export interface Ribbon {
  /** Widths in % of the ribbon (they add up to 100 or less). */
  confirmed: number;
  planned: number;
  /** What is left of the budget. */
  free: number;
  /** Beyond the budget. */
  over: number;
  /** Where the budget ends, in % (null without a budget or when not over). */
  mark: number | null;
}

const pct = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;

/**
 * The ribbon: confirmed, then planned, then what is left of the budget.
 * When the estimate passes the budget the scale is the estimate, the part
 * beyond the budget is `over` and `mark` says where the budget ends.
 */
export function ribbonOf(s: BudgetSummary): Ribbon {
  const confirmed = s.confirmed.withTax;
  const planned = s.planned.withTax;
  const spent = confirmed + planned;
  const budget = s.amount ?? 0;
  const scale = Math.max(budget, spent);
  if (scale <= 0) {
    return {confirmed: 0, planned: 0, free: 0, over: 0, mark: null};
  }
  if (s.amount !== null && spent > budget) {
    // Over: confirmed first, then planned up to the budget, then the excess.
    const inBudgetConfirmed = Math.min(confirmed, budget);
    const inBudgetPlanned = Math.max(0, budget - inBudgetConfirmed);
    return {
      confirmed: pct(inBudgetConfirmed, scale),
      planned: pct(Math.min(planned, inBudgetPlanned), scale),
      free: 0,
      over: pct(spent - budget, scale),
      mark: pct(budget, scale),
    };
  }
  return {
    confirmed: pct(confirmed, scale),
    planned: pct(planned, scale),
    free: s.amount === null ? 0 : pct(budget - spent, scale),
    over: 0,
    mark: null,
  };
}

// ---------------------------------------------------------------- words

export interface Headline {
  /** `left`: something remains; `over`: passed; `none`: no budget set. */
  kind: 'left' | 'over' | 'exact' | 'none';
  label: string;
  amount: string | null;
}

/** «Quedan ≈ 1.240 €», «Por encima ≈ 300 €», or nothing to compare with. */
export function headlineOf(s: BudgetSummary): Headline {
  if (s.remaining === null) {
    return {
      kind: 'none',
      label: 'Sin presupuesto fijado',
      amount: s.total.count ? formatEuros(s.total.withTax) : null,
    };
  }
  if (s.remaining > 0) {
    return {kind: 'left', label: 'Quedan', amount: formatEuros(s.remaining)};
  }
  if (s.remaining < 0) {
    return {
      kind: 'over',
      label: 'Por encima del presupuesto',
      amount: formatEuros(-s.remaining),
    };
  }
  return {kind: 'exact', label: 'Justo en el presupuesto', amount: null};
}

/**
 * What the estimate leaves out or still has to check, one sentence each
 * (empty when everything is known and verified).
 */
export function caveatsOf(s: BudgetSummary): string[] {
  const out: string[] = [];
  const {unknownAmount, unknownTax, taxToVerify} = s.total;
  if (unknownAmount) {
    out.push(
      `${plural(unknownAmount, 'gasto', 'gastos')} sin importe: ${
        unknownAmount === 1 ? 'no está' : 'no están'
      } en la estimación.`,
    );
  }
  if (unknownTax) {
    out.push(
      `${plural(unknownTax, 'gasto', 'gastos')} sin impuesto conocido: ${
        unknownTax === 1 ? 'no entra' : 'no entran'
      } en la estimación con impuestos.`,
    );
  }
  if (s.incomplete && s.remaining !== null) {
    out.push('Lo que queda puede ser menos de lo que se ve.');
  }
  if (taxToVerify) {
    out.push(
      `${plural(taxToVerify, 'gasto', 'gastos')} con el impuesto por verificar.`,
    );
  }
  return out;
}

// ---------------------------------------------------------------- one expense

/** «≈ 1.284 € con impuestos · estimación», or why there is none. */
export function expenseEstimate(e: Pick<Expense, 'amount' | 'tax'>): {
  amount: string | null;
  text: string;
} {
  if (e.amount === null) return {amount: null, text: 'Importe sin indicar'};
  const w = withTax(e.amount, e.tax);
  if (w === null) {
    return {
      amount: null,
      text: !e.tax
        ? 'Sin impuesto indicado: no se estima con impuestos'
        : 'Impuesto sin porcentaje: no se estima con impuestos',
    };
  }
  return {
    amount: formatEuros(w),
    text: `con impuestos · ${TAX_ESTIMATE_LABEL}`,
  };
}

/**
 * «Precio copiado el 27 nov, 10:30 de «Carpa 3x3» · Carpas Demo · 120 € /
 * día sin impuestos · IGIC 7 % de la empresa».
 */
export function snapshotText(
  s: OfferSnapshot,
  timeZone?: string,
): {when: string; what: string} {
  const per = perUnitLabel(s);
  const price =
    s.price === null
      ? 'sin precio'
      : `${formatEuros(s.price)}${per ? ` / ${per}` : ''} ${
          s.vatIncluded === true
            ? 'con impuestos incluidos'
            : s.vatIncluded === null
              ? '(no constaba si incluía impuestos)'
              : 'sin impuestos'
        }`;
  return {
    when: `Precio copiado el ${instantShort(s.at, timeZone)}`,
    what: [
      `«${s.offerName}»`,
      s.companyName,
      price,
      taxText(s.tax, {inherited: s.taxInherited}),
    ].join(' · '),
  };
}

/** «3 gastos · 1 confirmado». */
export function countText(s: BudgetSummary): string {
  if (!s.total.count) return 'Sin gastos';
  return `${plural(s.total.count, 'gasto', 'gastos')} · ${plural(
    s.confirmed.count,
    'confirmado',
    'confirmados',
  )}`;
}
