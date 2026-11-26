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
  Warehouse,
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

/**
 * Fields withheld from a guest (`restricted`) are not «missing»: the UI shows
 * «Visible para el equipo» for them instead.
 */
export function missingForContact(
  c: Pick<Contact, 'phone' | 'email' | 'role' | 'company'> &
    Partial<Pick<Contact, 'restricted'>>,
): string[] {
  const out: string[] = [];
  if (!c.restricted && !c.phone && !c.email) out.push('teléfono o correo');
  if (!c.role) out.push('cargo');
  if (!c.company) out.push('empresa o entidad');
  return out;
}

export function missingForCompany(
  c: Pick<Company, 'phone' | 'email' | 'mainContactId' | 'categoryIds'> &
    Partial<Pick<Company, 'restricted'>>,
): string[] {
  const out: string[] = [];
  if (!c.restricted && !c.phone && !c.email) out.push('teléfono o correo');
  if (!c.mainContactId) out.push('persona responsable');
  if (!c.categoryIds.length) out.push('categoría');
  return out;
}

export function missingForOffer(
  o: Pick<Offer, 'price' | 'unit' | 'customUnit' | 'categoryId'> &
    Partial<Pick<Offer, 'restricted'>>,
): string[] {
  const out: string[] = [];
  if (!o.restricted && o.price === null) out.push('precio');
  if (o.unit === 'custom' && !o.customUnit) out.push('unidad de contratación');
  if (!o.categoryId) out.push('categoría');
  return out;
}

/**
 * Owned material needs a warehouse; a contracted service needs its company
 * (it may never sit in a warehouse). «Aún por evaluar» keeps quantity and
 * condition pending even when a provisional figure was typed.
 */
export function missingForResource(
  r: Pick<
    Resource,
    | 'quantity'
    | 'dimensions'
    | 'warehouse'
    | 'condition'
    | 'toAssess'
    | 'ownership'
    | 'company'
    | 'categoryId'
  >,
): string[] {
  const out: string[] = [];
  if (r.quantity === null || r.toAssess) out.push('cantidad');
  if (r.condition === 'unknown' || r.toAssess) out.push('estado');
  if (r.ownership === 'owned' && !r.warehouse) out.push('almacén');
  if (r.ownership === 'contracted' && !r.company) out.push('empresa');
  if (!r.dimensions) out.push('dimensiones');
  if (!r.categoryId) out.push('categoría');
  return out;
}

export function missingForWarehouse(
  w: Pick<Warehouse, 'address'> & Partial<Pick<Warehouse, 'restricted'>>,
): string[] {
  return !w.restricted && !w.address ? ['dirección'] : [];
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
