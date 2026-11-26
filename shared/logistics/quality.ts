/**
 * Information quality: what each record is still missing and how much of the
 * captured data is validated. Drives «Pendiente de verificar», the
 * «Información verificada» gauge and the day-close report.
 */
import {LOAD_BEARING_KINDS} from './conflicts.ts';
import type {
  Company,
  Contact,
  LogisticsEvent,
  Offer,
  Resource,
  Task,
  Verification,
} from './contracts.ts';

/** Spanish labels of the missing pieces, in display order. */
export function missingForEvent(
  e: Pick<LogisticsEvent, 'venue' | 'startsAt' | 'endsAt'>,
): string[] {
  const out: string[] = [];
  if (!e.venue) out.push('lugar');
  if (!e.startsAt) out.push('fecha y hora de inicio');
  if (!e.endsAt) out.push('hora de fin');
  return out;
}

export function missingForTask(
  t: Pick<
    Task,
    'startsAt' | 'endsAt' | 'company' | 'venue' | 'kind' | 'heavyLoad'
  >,
): string[] {
  const out: string[] = [];
  if (!t.startsAt) out.push('hora de inicio');
  if (!t.endsAt) out.push('hora de fin');
  if (!t.company) out.push('empresa responsable');
  if (!t.venue) out.push('lugar');
  // Unknown is not "light": it must be answered before the subsoil review.
  if (t.heavyLoad === null && LOAD_BEARING_KINDS.has(t.kind)) {
    out.push('carga pesada');
  }
  return out;
}

export function missingForContact(
  c: Pick<Contact, 'phone' | 'email' | 'role'>,
): string[] {
  const out: string[] = [];
  if (!c.phone && !c.email) out.push('teléfono o correo');
  if (!c.role) out.push('cargo');
  return out;
}

export function missingForCompany(
  c: Pick<Company, 'phone' | 'email' | 'mainContactId' | 'categoryIds'>,
): string[] {
  const out: string[] = [];
  if (!c.phone && !c.email) out.push('teléfono o correo');
  if (!c.mainContactId) out.push('persona responsable');
  if (!c.categoryIds.length) out.push('categoría');
  return out;
}

export function missingForOffer(
  o: Pick<Offer, 'price' | 'unit' | 'customUnit'>,
): string[] {
  const out: string[] = [];
  if (o.price === null) out.push('precio');
  if (o.unit === 'custom' && !o.customUnit) out.push('unidad de contratación');
  return out;
}

export function missingForResource(
  r: Pick<
    Resource,
    'quantity' | 'dimensions' | 'warehouse' | 'condition' | 'toAssess'
  >,
): string[] {
  const out: string[] = [];
  if (r.quantity === null || r.toAssess) out.push('cantidad');
  if (!r.dimensions) out.push('dimensiones');
  if (!r.warehouse) out.push('ubicación');
  if (r.condition === 'unknown') out.push('estado');
  return out;
}

/** Percentage (0–100, rounded) of records with verification = validated. Empty → 0. */
export function verifiedPercent(
  records: {verification: Verification}[],
): number {
  if (!records.length) return 0;
  const ok = records.filter(r => r.verification === 'validated').length;
  return Math.round((ok / records.length) * 100);
}

export const VERIFICATION_LABEL: Record<Verification, string> = {
  draft: 'Borrador',
  to_verify: 'Por verificar',
  validated: 'Validado',
};
