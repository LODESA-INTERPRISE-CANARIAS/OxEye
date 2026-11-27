/**
 * Input schemas for offer terms, quote requests and proposals (Revisión 1 ·
 * E6–E7). Unknown keys are ignored. Every message is plain Spanish; field
 * paths follow the input (`products.0.price`, `need.days`, `tax.regime`).
 */
import {z} from 'zod';
import {
  localDate,
  oneOf,
  optionalText,
  requiredText,
  uuid,
} from '../http/validate.ts';
import {
  amount,
  email,
  NAME_MAX,
  optionalUuid,
  phone,
  versionField,
} from '../records/schemas.ts';
import {taxField} from '../budget/tax.ts';
import {isValidAmount} from '../../../shared/logistics/rules.ts';
import {
  COMMITMENT_YEARS_MAX,
  COMMITMENT_YEARS_MIN,
  MAX_NEED_DAYS,
  MAX_NEED_QUANTITY,
  MAX_NOT_INCLUDED,
  MAX_SEASON_RATES,
  MAX_SUPPLEMENTS,
  overlappingMonth,
  PRICE_BASES,
  RENEWAL_NOTICE_OPTIONS,
  TERMS_LABEL_MAX,
  TERMS_TEXT_MAX,
} from '../../../shared/logistics/offer-terms.ts';
import {
  PROPOSAL_ANSWER_MAX,
  PROPOSAL_KEY_MAX,
  PROPOSAL_MAX_ANSWERS,
  PROPOSAL_MAX_PRODUCTS,
  PROPOSAL_ORIGIN_MAX,
  PROPOSAL_REASON_MAX,
  PROPOSAL_REASON_MIN,
  QUOTE_LINK_DAYS_MAX,
  QUOTE_MAX_COMPANIES,
  QUOTE_NOTE_MAX,
  QUOTE_TITLE_MAX,
  QUOTE_UNIT_MAX,
} from '../../../shared/logistics/proposals.ts';
import {daysBetween} from '../../../shared/logistics/time.ts';

const AMOUNT_ERROR =
  'Importe no válido: entre 0 y 10.000.000 €, con dos decimales como máximo.';

/** A price that must be given (a seasonal rate without a price makes no sense). */
const requiredAmount = z
  .number({error: 'Escribe el precio en euros (un número).'})
  .refine(isValidAmount, {error: AMOUNT_ERROR});

const count = (max: number, what: string) =>
  z
    .number({error: `Debe ser un número de ${what}.`})
    .int({error: `Debe ser un número entero de ${what}.`})
    .min(1, {error: 'Al menos 1.'})
    .max(max, {error: `Como máximo ${max.toLocaleString('es-ES')}.`});

/** Months 1–12, at least one, without repeats; returned ascending. */
const months = z
  .array(
    z
      .number({error: 'Cada mes es un número del 1 al 12.'})
      .int({error: 'Cada mes es un número del 1 al 12.'})
      .min(1, {error: 'Cada mes es un número del 1 al 12.'})
      .max(12, {error: 'Cada mes es un número del 1 al 12.'}),
    {error: 'Debe ser una lista de meses (1–12).'},
  )
  .min(1, {error: 'Elige al menos un mes.'})
  .max(12, {error: 'Como máximo los 12 meses.'})
  .transform(list => [...new Set(list)].sort((a, b) => a - b));

const seasonRate = z.object({
  label: requiredText(TERMS_LABEL_MAX),
  months,
  price: requiredAmount,
});

const supplement = z
  .object({
    label: requiredText(TERMS_LABEL_MAX),
    kind: oneOf(
      ['transport', 'assembly', 'maintenance', 'other'],
      'Tipo no válido: transporte, montaje, mantenimiento u otro.',
    ).default('other'),
    included: z
      .boolean({error: 'Indica si está incluido en el precio.'})
      .default(false),
    amount: amount.default(null),
    per: oneOf(
      ['order', 'unit', 'unit_day', 'day', 'percent'],
      'Forma de cobro no válida: por pedido, por unidad, por unidad y jornada, por jornada o porcentaje.',
    ).default('order'),
    applies: oneOf(
      ['always', 'on_request'],
      'Indica si se cobra siempre o solo si se pide.',
    ).default('always'),
  })
  .transform(s => ({...s, amount: s.included ? null : (s.amount ?? null)}))
  .refine(s => s.per !== 'percent' || s.amount === null || s.amount <= 1000, {
    error: 'Un porcentaje va de 0 a 1.000.',
    path: ['amount'],
  });

const textList = z
  .array(requiredText(TERMS_LABEL_MAX), {
    error: 'Debe ser una lista de textos.',
  })
  .max(MAX_NOT_INCLUDED, {error: `Como máximo ${MAX_NOT_INCLUDED}.`})
  .default([]);

const optionalCount = (max: number, what: string) =>
  count(max, what).nullable().default(null);

const basis = oneOf(
  PRICE_BASES as unknown as readonly [string, ...string[]],
  'Forma de precio no válida.',
) as z.ZodType<(typeof PRICE_BASES)[number]>;

const answerKey = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

const answers = z
  .record(
    z.string(),
    z.union(
      [
        z.string().max(PROPOSAL_ANSWER_MAX),
        z.number().refine(Number.isFinite),
        z.boolean(),
        z.null(),
      ],
      {
        error: `Cada respuesta es un texto de hasta ${PROPOSAL_ANSWER_MAX} caracteres, un número o sí/no.`,
      },
    ),
    {error: 'Las respuestas deben ser una lista de pares pregunta–respuesta.'},
  )
  .refine(r => Object.keys(r).length <= PROPOSAL_MAX_ANSWERS, {
    error: `Como máximo ${PROPOSAL_MAX_ANSWERS} respuestas por producto.`,
  })
  .refine(r => Object.keys(r).every(k => answerKey.test(k)), {
    error: 'Respuesta con un nombre de pregunta no válido.',
  })
  .default({});

const productSchema = z.object({
  key: z
    .string({error: 'Falta la clave del producto.'})
    .regex(/^[A-Za-z0-9_-]{1,40}$/, {
      error: `La clave del producto tiene de 1 a ${PROPOSAL_KEY_MAX} letras, números, «-» o «_».`,
    }),
  categoryKey: z
    .string()
    .regex(/^[a-z][a-z0-9_-]{0,39}$/, {error: 'Actividad no válida.'})
    .nullable()
    .default(null),
  name: requiredText(NAME_MAX),
  description: optionalText(TERMS_TEXT_MAX).transform(v => v ?? null),
  answers,
  available: z
    .number({error: 'Debe ser un número.'})
    .min(0, {error: 'No puede ser negativo.'})
    .max(MAX_NEED_QUANTITY, {error: 'Demasiadas unidades.'})
    .nullable()
    .default(null),
  basis,
  customUnit: optionalText(TERMS_LABEL_MAX).transform(v => v ?? null),
  price: amount.transform(v => v ?? null),
  seasonal: z
    .array(seasonRate, {error: 'Debe ser una lista de tarifas de temporada.'})
    .max(MAX_SEASON_RATES, {
      error: `Como máximo ${MAX_SEASON_RATES} temporadas.`,
    })
    .default([])
    .refine(rates => overlappingMonth(rates) === null, {
      error: 'Un mes no puede estar en dos temporadas.',
    }),
  supplements: z
    .array(supplement, {error: 'Debe ser una lista de suplementos.'})
    .max(MAX_SUPPLEMENTS, {
      error: `Como máximo ${MAX_SUPPLEMENTS} suplementos.`,
    })
    .default([]),
  notIncluded: textList,
  minimumDays: optionalCount(MAX_NEED_DAYS, 'jornadas'),
  minimumQuantity: optionalCount(MAX_NEED_QUANTITY, 'unidades'),
  minimumOrder: amount.transform(v => v ?? null),
  commitmentPrice: amount.transform(v => v ?? null),
  conditions: optionalText(TERMS_TEXT_MAX).transform(v => v ?? null),
});

/**
 * ProposalInput. `acceptUntil` is checked against today by the service
 * (it needs the clock and the organization's time zone).
 */
export const proposalSchema = z.object({
  intent: oneOf(['yes', 'similar'], 'Respuesta no válida.').default('yes'),
  company: z.object(
    {
      name: requiredText(NAME_MAX),
      contactName: optionalText(120).transform(v => v ?? null),
      phone: phone.transform(v => v ?? null),
      email: email.transform(v => v ?? null),
    },
    {error: 'Faltan los datos de la empresa.'},
  ),
  products: z
    .array(productSchema, {error: 'Debe ser una lista de productos.'})
    .min(1, {error: 'Añade al menos un producto o servicio.'})
    .max(PROPOSAL_MAX_PRODUCTS, {
      error: `Como máximo ${PROPOSAL_MAX_PRODUCTS} productos por propuesta.`,
    })
    .refine(list => new Set(list.map(p => p.key)).size === list.length, {
      error: 'Dos productos tienen la misma clave.',
    }),
  tax: taxField.transform(v => v ?? null),
  pricesIncludeTax: z
    .boolean({
      error: 'Indica si el precio incluye el impuesto, o déjalo sin saber.',
    })
    .nullable()
    .default(null),
  acceptUntil: localDate.transform(v => v ?? null),
  serviceMonths: months.nullable().default(null),
  serviceNote: optionalText(TERMS_TEXT_MAX).transform(v => v ?? null),
  commitment: z
    .object({
      years: z
        .number({error: 'Indica los años del compromiso.'})
        .int({error: 'Los años son un número entero.'})
        .min(COMMITMENT_YEARS_MIN, {
          error: `Un compromiso es de ${COMMITMENT_YEARS_MIN} a ${COMMITMENT_YEARS_MAX} años.`,
        })
        .max(COMMITMENT_YEARS_MAX, {
          error: `Un compromiso es de ${COMMITMENT_YEARS_MIN} a ${COMMITMENT_YEARS_MAX} años.`,
        }),
      conditions: optionalText(TERMS_TEXT_MAX).transform(v => v ?? null),
    })
    .nullable()
    .default(null),
  conditions: optionalText(TERMS_TEXT_MAX).transform(v => v ?? null),
  privacyAccepted: z.boolean({error: 'Debe ser sí o no.'}).optional(),
});

export type ProposalBody = z.output<typeof proposalSchema>;

/** The public form must accept the privacy text. */
export const publicProposalSchema = proposalSchema.refine(
  p => p.privacyAccepted === true,
  {
    error: 'Para enviar la propuesta hay que aceptar el tratamiento de datos.',
    path: ['privacyAccepted'],
  },
);

export const declineSchema = z.object({
  reason: optionalText(PROPOSAL_REASON_MAX).transform(v => v ?? null),
});

export const manualProposalSchema = z.object({
  organizationId: uuid,
  offerId: optionalUuid,
  requestId: optionalUuid,
  origin: requiredText(PROPOSAL_ORIGIN_MAX),
  proposal: proposalSchema,
});

export const approveSchema = z.object({
  version: versionField('la propuesta'),
  products: z
    .array(
      z.object({
        key: z
          .string({error: 'Falta la clave del producto.'})
          .max(PROPOSAL_KEY_MAX),
        offerId: optionalUuid,
        categoryId: optionalUuid,
        skip: z.boolean().optional(),
      }),
      {error: 'Debe ser una lista de productos.'},
    )
    .max(PROPOSAL_MAX_PRODUCTS)
    .optional(),
});

export const rejectSchema = z.object({
  version: versionField('la propuesta'),
  reason: requiredText(PROPOSAL_REASON_MAX).refine(
    v => v.length >= PROPOSAL_REASON_MIN,
    {error: `Escribe el motivo (al menos ${PROPOSAL_REASON_MIN} caracteres).`},
  ),
});

// ---------------------------------------------------------------- quote requests

const needSchema = z
  .object({
    title: requiredText(QUOTE_TITLE_MAX),
    categoryId: optionalUuid.transform(v => v ?? null),
    quantity: z
      .number({error: 'Indica la cantidad (un número).'})
      .gt(0, {error: 'La cantidad debe ser mayor que 0.'})
      .max(MAX_NEED_QUANTITY, {error: 'Cantidad demasiado grande.'})
      .refine(v => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, {
        error: 'Como máximo dos decimales.',
      }),
    unitLabel: optionalText(QUOTE_UNIT_MAX).transform(v => v ?? null),
    days: count(MAX_NEED_DAYS, 'jornadas'),
    hoursPerDay: z
      .number({error: 'Indica las horas por jornada (un número).'})
      .gt(0, {error: 'Las horas deben ser más de 0.'})
      .max(24, {error: 'Una jornada tiene como mucho 24 horas.'})
      .nullable()
      .default(null),
    dateFrom: localDate.transform(v => v ?? null),
    dateTo: localDate.transform(v => v ?? null),
    note: optionalText(QUOTE_NOTE_MAX).transform(v => v ?? null),
  })
  .superRefine((n, ctx) => {
    if (n.dateTo && !n.dateFrom) {
      ctx.addIssue({
        code: 'custom',
        path: ['dateFrom'],
        message: 'Indica también desde cuándo.',
      });
    }
    if (n.dateFrom && n.dateTo && n.dateTo < n.dateFrom) {
      ctx.addIssue({
        code: 'custom',
        path: ['dateTo'],
        message: 'La fecha final es anterior a la inicial.',
      });
    }
    if (n.dateFrom) {
      const span = daysBetween(n.dateFrom, n.dateTo ?? n.dateFrom) + 1;
      if (n.days > span) {
        ctx.addIssue({
          code: 'custom',
          path: ['days'],
          message: `Hay más jornadas (${n.days}) que días entre las fechas (${span}).`,
        });
      }
    }
  });

const companyIds = z
  .array(uuid, {error: 'Elige las empresas.'})
  .min(1, {error: 'Elige al menos una empresa.'})
  .max(QUOTE_MAX_COMPANIES, {
    error: `Como máximo ${QUOTE_MAX_COMPANIES} empresas por solicitud.`,
  })
  .transform(list => [...new Set(list.map(v => v.toLowerCase()))]);

const linkDays = z
  .number({error: 'Indica los días que vale el enlace.'})
  .int({error: 'Los días son un número entero.'})
  .min(1, {error: 'El enlace vale al menos 1 día.'})
  .max(QUOTE_LINK_DAYS_MAX, {
    error: `El enlace vale como mucho ${QUOTE_LINK_DAYS_MAX} días.`,
  })
  .optional();

export const createRequestSchema = z.object({
  organizationId: uuid,
  need: needSchema,
  eventId: optionalUuid.transform(v => v ?? null),
  offerId: optionalUuid.transform(v => v ?? null),
  companyIds,
  linkDays,
});

export const addLinksSchema = z.object({companyIds, linkDays});
export const renewLinkSchema = z.object({linkDays});
export const closeRequestSchema = z.object({
  version: versionField('la solicitud'),
});

export type NeedBody = z.output<typeof needSchema>;
export type CreateRequestBody = z.output<typeof createRequestSchema>;

// ---------------------------------------------------------------- settings and renewals

export const settingsSchema = z.object({
  version: z
    .number({error: 'Falta la versión: recarga los ajustes.'})
    .int()
    .min(0, {error: 'La versión no es válida.'}),
  renewalNoticeDays: z
    .number({error: 'Elige 15, 30, 60 o 90 días.'})
    .refine(v => (RENEWAL_NOTICE_OPTIONS as readonly number[]).includes(v), {
      error: 'Elige 15, 30, 60 o 90 días.',
    })
    .optional(),
  openLinkEnabled: z.boolean({error: 'Debe ser sí o no.'}).optional(),
  rotateOpenLink: z.boolean({error: 'Debe ser sí o no.'}).optional(),
});

export const renewalSchema = z.object({
  version: versionField('la renegociación'),
  assigneeId: optionalUuid.transform(v => v ?? null),
});
