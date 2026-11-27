/**
 * Input schemas for an event's budget and its expenses (EventBudgetInput and
 * ExpenseInput in the shared contract). Unknown keys are ignored, so a newer
 * client can talk to this server.
 */
import {z} from 'zod';
import {oneOf, optionalText, requiredText, uuid} from '../http/validate.ts';
import {deviceIdField} from '../records/device-id.ts';
import {
  amount,
  NAME_MAX,
  NOTES_MAX,
  optionalUuid,
  source,
  verification,
  versionField,
} from '../records/schemas.ts';
import {taxField} from './tax.ts';
import {EXPENSE_STATUSES} from '../../../shared/logistics/rules.ts';

const status = oneOf(
  EXPENSE_STATUSES,
  'Estado no válido: usa previsto o confirmado.',
);

const common = {
  companyId: optionalUuid,
  amount,
  tax: taxField,
  status: status.optional(),
  notes: optionalText(NOTES_MAX),
  source,
  verification,
};

export const createExpenseSchema = z.object({
  id: deviceIdField,
  eventId: uuid,
  offerId: optionalUuid,
  // Required unless it comes from an offer (the service checks it).
  concept: requiredText(NAME_MAX).optional(),
  ...common,
});

/** An expense never moves to another event; `eventId` and `offerId` are ignored. */
export const updateExpenseSchema = z.object({
  version: versionField('el gasto'),
  concept: requiredText(NAME_MAX).optional(),
  ...common,
});

const BUDGET_VERSION =
  'Falta la versión del presupuesto: recarga el evento y vuelve a intentarlo.';

export const BUDGET_AMOUNT_REQUIRED =
  'Indica el presupuesto en euros, o vacío para quitarlo.';

/** `amount` must be sent (null clears it): the service answers a missing one. */
export const budgetSchema = z.object({
  amount,
  // 0 = the event has no budget yet.
  version: z
    .number({error: BUDGET_VERSION})
    .int({error: 'La versión debe ser un número entero.'})
    .min(0, {error: 'La versión no puede ser negativa.'}),
});

export type CreateExpenseBody = z.output<typeof createExpenseSchema>;
export type UpdateExpenseBody = z.output<typeof updateExpenseSchema>;
export type BudgetBody = z.output<typeof budgetSchema>;
