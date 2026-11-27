/**
 * Revisión 1 · E5 «Dinero»: a small catalogue with taxes and an event
 * budget, shared by money.spec.ts and money-visual.spec.ts.
 *
 * - «Carpas Demo» charges IGIC 7 % «por verificar»; «Estructuras Norte»
 *   has no tax recorded; «Toldos Sur» charges IVA 21 %, verified.
 * - Three tent offers per day: 120 € (inherits IGIC → ≈ 128,40 €), 115 €
 *   with its own IVA 21 % (≈ 139,15 €) and 95 € with no known tax (apart).
 */
import {categoryId, elvis, makeCompany, makeOffer, today} from './mock-api';

type Json = Record<string, unknown>;

export const IGIC = {
  regime: 'igic',
  name: null,
  ratePercent: 7,
  verification: 'to_verify',
} as const;
export const IVA = {
  regime: 'iva',
  name: null,
  ratePercent: 21,
  verification: 'validated',
} as const;

const CARPAS = categoryId('Carpas');

export function moneyData(): {
  companies: Json[];
  offers: Json[];
  budgets: Json[];
  expenses: Json[];
} {
  const carpas = {id: 'c1', name: 'Carpas Demo'};
  const norte = {id: 'c2', name: 'Estructuras Norte'};
  const sur = {id: 'c3', name: 'Toldos Sur'};
  return {
    companies: [
      makeCompany(carpas.id, carpas.name, {tax: IGIC, categoryIds: [CARPAS]}),
      makeCompany(norte.id, norte.name, {categoryIds: [CARPAS]}),
      makeCompany(sur.id, sur.name, {tax: IVA, categoryIds: [CARPAS]}),
    ],
    offers: [
      makeOffer('o1', 'Carpa 3x3', carpas, {
        categoryId: CARPAS,
        unit: 'day',
        price: 120,
        vatIncluded: false,
      }),
      makeOffer('o2', 'Carpa plegable 3x3', norte, {
        categoryId: CARPAS,
        unit: 'day',
        price: 115,
        vatIncluded: false,
        tax: IVA,
      }),
      makeOffer('o3', 'Carpa básica', norte, {
        categoryId: CARPAS,
        unit: 'day',
        price: 95,
        vatIncluded: false,
      }),
      makeOffer('o4', 'Toldo 4x4', sur, {
        categoryId: CARPAS,
        unit: 'day',
        price: 150,
        vatIncluded: false,
      }),
    ],
    budgets: [],
    expenses: [],
  };
}

/** A budget of 2.000 € for «e1» with two expenses, one copied from «o1». */
export function withBudget(data = moneyData()) {
  const at = `${today}T09:00:00.000Z`;
  data.budgets.push({
    eventId: 'e1',
    amount: 2000,
    version: 1,
    updatedBy: elvis,
    updatedAt: at,
  });
  data.expenses.push(
    {
      id: 'x1',
      version: 1,
      organizationId: 'org',
      eventId: 'e1',
      concept: 'Carpas para el escenario',
      company: {id: 'c1', name: 'Carpas Demo'},
      amount: 720,
      tax: IGIC,
      status: 'confirmed',
      snapshot: {
        offerId: 'o1',
        offerName: 'Carpa 3x3',
        companyName: 'Carpas Demo',
        price: 120,
        unit: 'day',
        customUnit: null,
        vatIncluded: false,
        tax: IGIC,
        taxInherited: true,
        transportCost: null,
        assemblyCost: null,
        maintenanceCost: null,
        at,
      },
      notes: null,
      restricted: false,
      source: null,
      verification: 'draft',
      isDemo: false,
      createdBy: elvis,
      createdAt: at,
      updatedBy: elvis,
      updatedAt: at,
    },
    {
      id: 'x2',
      version: 1,
      organizationId: 'org',
      eventId: 'e1',
      concept: 'Toldos para la zona de comida',
      company: {id: 'c3', name: 'Toldos Sur'},
      amount: 600,
      tax: IVA,
      status: 'planned',
      snapshot: null,
      notes: null,
      restricted: false,
      source: null,
      verification: 'draft',
      isDemo: false,
      createdBy: elvis,
      createdAt: `${today}T09:05:00.000Z`,
      updatedBy: elvis,
      updatedAt: `${today}T09:05:00.000Z`,
    },
    {
      id: 'x3',
      version: 1,
      organizationId: 'org',
      eventId: 'e1',
      concept: 'Vallas de acceso',
      company: null,
      amount: null,
      tax: null,
      status: 'planned',
      snapshot: null,
      notes: null,
      restricted: false,
      source: null,
      verification: 'draft',
      isDemo: false,
      createdBy: elvis,
      createdAt: `${today}T09:10:00.000Z`,
      updatedBy: elvis,
      updatedAt: `${today}T09:10:00.000Z`,
    },
  );
  return data;
}
