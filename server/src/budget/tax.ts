/**
 * Revisión 1 · E5: the tax columns shared by companies, offers and expenses
 * (`tax_regime`, `tax_name`, `tax_rate`, `tax_verification`; migration 0010)
 * and the `tax` input field. The rules live in shared/logistics/money.ts
 * (`normalizeTax`), so the forms and the server accept exactly the same.
 */
import {z} from 'zod';
import {normalizeTax} from '../../../shared/logistics/money.ts';
import type {
  TaxInfo,
  TaxRegime,
  TaxVerification,
} from '../../../shared/logistics/contracts.ts';

export interface TaxRow {
  tax_regime: TaxRegime | null;
  tax_name: string | null;
  /** Selected as text so both drivers agree. */
  tax_rate: unknown;
  tax_verification: TaxVerification | null;
}

/** The tax columns of table alias `t`. */
export function taxColumns(t: string): string {
  return `${t}.tax_regime, ${t}.tax_name, ${t}.tax_rate::text AS tax_rate,
    ${t}.tax_verification`;
}

/** The tax columns of table alias `t` as `<prefix>tax_regime`… (joined rows). */
export function prefixedTaxColumns(t: string, prefix: string): string {
  return `${t}.tax_regime AS ${prefix}tax_regime, ${t}.tax_name AS ${prefix}tax_name,
    ${t}.tax_rate::text AS ${prefix}tax_rate,
    ${t}.tax_verification AS ${prefix}tax_verification`;
}

/** The tax of a joined company selected with `prefixedTaxColumns(…, 'company_')`. */
export interface CompanyTaxRow {
  company_tax_regime: TaxRegime | null;
  company_tax_name: string | null;
  company_tax_rate: unknown;
  company_tax_verification: TaxVerification | null;
}

export function toCompanyTax(row: CompanyTaxRow): TaxInfo | null {
  return toTax({
    tax_regime: row.company_tax_regime,
    tax_name: row.company_tax_name,
    tax_rate: row.company_tax_rate,
    tax_verification: row.company_tax_verification,
  });
}

export function toTax(row: TaxRow): TaxInfo | null {
  if (!row.tax_regime) return null;
  const rate =
    row.tax_rate === null || row.tax_rate === undefined
      ? null
      : Number(row.tax_rate);
  return {
    regime: row.tax_regime,
    name: row.tax_name,
    ratePercent: rate !== null && Number.isFinite(rate) ? rate : null,
    verification: row.tax_verification ?? 'to_verify',
  };
}

/** The four column values, in column order (regime, name, rate, verification). */
export function taxParams(
  tax: TaxInfo | null,
): [string | null, string | null, number | null, string | null] {
  return tax
    ? [tax.regime, tax.name, tax.ratePercent, tax.verification]
    : [null, null, null, null];
}

/**
 * The optional `tax` of a body: undefined = unchanged, null = cleared, an
 * object = read by `normalizeTax` (problems reported as `tax.<key>`).
 */
export const taxField = z
  .unknown()
  .transform((value, ctx): TaxInfo | null | undefined => {
    if (value === undefined) return undefined;
    const result = normalizeTax(value);
    if (result.ok) return result.tax;
    for (const [key, message] of Object.entries(result.fields)) {
      ctx.addIssue({code: 'custom', message, path: [key]});
    }
    return z.NEVER;
  })
  .optional();
