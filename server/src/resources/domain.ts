/**
 * Inventory resource rules as pure functions: owned material never has a
 * company or an offer, and a contracted resource's offer always belongs to
 * its company. No database, no HTTP.
 *
 * Quantity, unit (even «kg») and dimensions describe what was observed. They
 * never combine into a load per square metre and never answer a task's
 * heavy-load question: that is the simulator's X-ray check.
 */
import type {ResourceOwnership} from '../../../shared/logistics/contracts.ts';

export const OWNED_WITHOUT_COMPANY =
  'Un recurso propio no tiene empresa: márcalo como contratado para indicar quién lo presta.';
export const OWNED_WITHOUT_OFFER =
  'Un recurso propio no viene de una oferta: márcalo como contratado para vincularla.';
export const OFFER_OF_OTHER_COMPANY =
  'Esa oferta es de otra empresa: elige una oferta de la empresa del recurso o cambia antes la empresa.';

/**
 * Field problems of an input whose resulting ownership is `ownership`:
 * sending a company or an offer for owned material is an error (clearing
 * them with null is fine).
 */
export function ownershipProblems(
  ownership: ResourceOwnership,
  input: {
    companyId?: string | null;
    companyName?: string | null;
    offerId?: string | null;
  },
): Record<string, string> {
  if (ownership !== 'owned') return {};
  const fields: Record<string, string> = {};
  if (input.companyId) fields.companyId = OWNED_WITHOUT_COMPANY;
  if (input.companyName) fields.companyName = OWNED_WITHOUT_COMPANY;
  if (input.offerId) fields.offerId = OWNED_WITHOUT_OFFER;
  return fields;
}

export type OfferResolution =
  | {ok: true; companyId: string | null; offerId: string | null}
  | {ok: false; message: string};

/**
 * Company and offer of a contracted resource after an edit.
 *
 * - `offer` undefined: the offer is unchanged, unless the company changed (an
 *   offer of the old company no longer applies and is cleared).
 * - `offer` null: cleared.
 * - An offer when the input also names a company: it must be that company's.
 * - An offer without a company in the input: a resource with no company takes
 *   the offer's; one with a company keeps it, and the offer must be its.
 */
export function resolveOffer(args: {
  before: {companyId: string | null; offerId: string | null};
  /** Company after resolving the input's companyId / companyName. */
  companyId: string | null;
  /** Whether the input named a company (companyId or companyName sent). */
  companyGiven: boolean;
  offer: {id: string; companyId: string} | null | undefined;
}): OfferResolution {
  const {before, companyId, companyGiven, offer} = args;
  if (offer === undefined) {
    const keeps = companyId !== null && companyId === before.companyId;
    return {ok: true, companyId, offerId: keeps ? before.offerId : null};
  }
  if (offer === null) return {ok: true, companyId, offerId: null};
  if (companyGiven || companyId !== null) {
    return offer.companyId === companyId
      ? {ok: true, companyId, offerId: offer.id}
      : {ok: false, message: OFFER_OF_OTHER_COMPANY};
  }
  return {ok: true, companyId: offer.companyId, offerId: offer.id};
}
