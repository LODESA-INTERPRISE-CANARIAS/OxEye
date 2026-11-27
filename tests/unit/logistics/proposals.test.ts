/**
 * Revisión 1 · E7: supplier links, the tax a proposal brings in, the points
 * to check before approving, and the terms one product becomes.
 */
import {describe, expect, it} from 'vitest';
import {
  acceptUntilFor,
  LINK_TOKEN_RE,
  openOfferLinkHash,
  parseSupplierLink,
  proposalFlags,
  proposalTax,
  proposalTerms,
  SUPPLIER_PRIVACY_TEXT,
  supplierLinkHash,
} from '../../../shared/logistics/proposals';
import type {
  ProposalContent,
  ProposalProductInput,
  TaxInfo,
} from '../../../shared/logistics/contracts';

const TOKEN = 'A'.repeat(20) + '-_' + 'b9'.repeat(10) + 'z';
const IGIC7: TaxInfo = {
  regime: 'igic',
  name: null,
  ratePercent: 7,
  verification: 'to_verify',
};

function product(
  over: Partial<ProposalProductInput> = {},
): ProposalProductInput {
  return {
    key: 'carpa',
    categoryKey: 'carpas',
    name: 'Carpa 6 × 6',
    basis: 'unit_day',
    price: 195,
    ...over,
  };
}

function content(over: Partial<ProposalContent> = {}): ProposalContent {
  return {
    company: {name: 'Carpas Norte'},
    products: [product()],
    tax: IGIC7,
    pricesIncludeTax: false,
    acceptUntil: '2027-03-31',
    serviceMonths: [6, 7, 8, 9],
    privacyVersion: null,
    ...over,
  };
}

describe('supplier links', () => {
  it('round-trips the personal and the open link; anything else is not a link', () => {
    expect(TOKEN).toHaveLength(43);
    expect(LINK_TOKEN_RE.test(TOKEN)).toBe(true);
    expect(parseSupplierLink(supplierLinkHash(TOKEN))).toEqual({
      kind: 'request',
      token: TOKEN,
    });
    expect(parseSupplierLink(openOfferLinkHash(TOKEN))).toEqual({
      kind: 'open',
      token: TOKEN,
    });
    expect(parseSupplierLink(`#logistica/proveedor/${TOKEN}x`)).toBeNull();
    expect(parseSupplierLink('#logistica/proveedor/corto')).toBeNull();
    expect(parseSupplierLink(`#logistica/otra/${TOKEN}`)).toBeNull();
  });

  it('the privacy text says who receives the data and that it awaits legal review', () => {
    expect(SUPPLIER_PRIVACY_TEXT).toContain(
      'No se publican ni los ve ninguna otra empresa',
    );
    expect(SUPPLIER_PRIVACY_TEXT).toContain('pendiente de revisión jurídica');
  });

  it('acceptUntilFor turns a validity choice into a date', () => {
    expect(acceptUntilFor('30d', '2026-11-27')).toBe('2026-12-27');
    expect(acceptUntilFor('1y', '2026-11-27')).toBe('2027-11-27');
  });
});

describe('proposalTax', () => {
  it('enters «por verificar» unless it is the company’s validated tax', () => {
    expect(proposalTax(null, null)).toBeNull();
    expect(proposalTax(IGIC7, null)).toEqual(IGIC7);
    expect(proposalTax(IGIC7, {...IGIC7, verification: 'validated'})).toEqual({
      ...IGIC7,
      verification: 'validated',
    });
    expect(proposalTax(IGIC7, IGIC7)).toEqual(IGIC7);
    expect(
      proposalTax(IGIC7, {
        regime: 'iva',
        name: null,
        ratePercent: 21,
        verification: 'validated',
      }),
    ).toEqual(IGIC7);
    // A stated tax cannot validate itself.
    expect(proposalTax({...IGIC7, verification: 'validated'}, null)).toEqual(
      IGIC7,
    );
  });
});

describe('proposalFlags', () => {
  const today = '2026-11-27';

  it('lists what to check, in a stable order', () => {
    expect(
      proposalFlags(
        content({
          tax: null,
          pricesIncludeTax: null,
          products: [
            product({
              price: null,
              supplements: [
                {
                  label: 'Transporte',
                  kind: 'transport',
                  included: false,
                  amount: null,
                  per: 'order',
                  applies: 'always',
                },
                {
                  label: 'Extra',
                  kind: 'other',
                  included: false,
                  amount: null,
                  per: 'order',
                  applies: 'on_request',
                },
              ],
            }),
          ],
          commitment: {years: 3},
          acceptUntil: '2026-12-01',
          serviceMonths: null,
        }),
        today,
      ),
    ).toEqual([
      'Falta el impuesto',
      'No dice si el precio incluye impuesto',
      'Carpa 6 × 6: sin precio',
      'Transporte sin precio',
      'Compromiso de 3 años',
      'Vence en menos de una semana',
      'No dice cuándo puede dar el servicio',
    ]);
  });

  it('tax to verify, prices with tax, no deadline, expired; nothing for a clean proposal', () => {
    expect(proposalFlags(content(), today)).toEqual([
      'IGIC 7 % · por verificar',
    ]);
    expect(
      proposalFlags(
        content({tax: {...IGIC7, verification: 'validated'}}),
        today,
      ),
    ).toEqual([]);
    expect(
      proposalFlags(
        content({pricesIncludeTax: true, acceptUntil: null}),
        today,
      ),
    ).toEqual([
      'IGIC 7 % · por verificar',
      'Precios con impuesto incluido',
      'Sin fecha límite para aceptar',
    ]);
    expect(
      proposalFlags(content({acceptUntil: '2026-11-26'}), today),
    ).toContain('Ya ha vencido');
  });
});

describe('proposalTerms', () => {
  it('one product with the proposal-wide terms', () => {
    const t = proposalTerms(
      content({
        commitment: {years: 3, conditions: 'Revisión anual del IPC'},
        conditions: 'Pago a 30 días',
      }),
      product({
        customUnit: 'ignorado',
        commitmentPrice: 180,
        conditions: 'Incluye lastres',
      }),
    );
    expect(t).toMatchObject({
      basis: 'unit_day',
      customUnit: null,
      price: 195,
      pricesIncludeTax: false,
      acceptUntil: '2027-03-31',
      serviceMonths: [6, 7, 8, 9],
      commitment: {years: 3, price: 180, conditions: 'Revisión anual del IPC'},
      conditions: 'Incluye lastres\nPago a 30 días',
      tax: IGIC7,
      seasonal: [],
      supplements: [],
    });
    expect(
      proposalTerms(
        content(),
        product({basis: 'custom', customUnit: 'por metro'}),
      ).customUnit,
    ).toBe('por metro');
  });
});
