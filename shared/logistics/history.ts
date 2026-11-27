/**
 * Change history in plain Spanish, from the activity log: who did what to a
 * record and which fields changed (names only, never values). Also the one
 * label of a note that may appear anywhere outside the note itself: its kind
 * and what it points at, never its text.
 */
import type {
  ActivityEntry,
  DelayHypothesis,
  Note,
  NoteRefType,
} from './contracts.ts';
import {minutesLabel} from './conflicts.ts';
import {NOTE_KIND_LABEL} from './rules.ts';

/** Contract field names (as logged in `changedFields`) → Spanish label. */
export const FIELD_LABEL: Readonly<Record<string, string>> = {
  name: 'nombre',
  title: 'título',
  kind: 'tipo',
  status: 'estado',
  venue: 'lugar',
  date: 'fecha',
  endDate: 'último día',
  startsAt: 'hora de inicio',
  endsAt: 'hora de fin',
  timezone: 'zona horaria',
  eventId: 'evento',
  event: 'evento',
  company: 'empresa',
  contact: 'persona de contacto',
  dependsOn: 'dependencias',
  heavyLoad: 'carga pesada',
  resourceIds: 'recursos',
  subsoilReview: 'revisión del subsuelo declarada',
  delayMinutes: 'minutos de retraso',
  appliedAt: 'aplicada al plan',
  // The free-text field is shown as «Observaciones»; «Notas» are linked notes.
  notes: 'observaciones',
  phone: 'teléfono',
  email: 'correo',
  website: 'web',
  role: 'cargo',
  description: 'descripción',
  categoryIds: 'categorías',
  categoryId: 'categoría',
  mainContactId: 'persona responsable',
  eventIds: 'eventos',
  price: 'precio',
  unit: 'unidad',
  customUnit: 'unidad de contratación',
  transportCost: 'transporte',
  assemblyCost: 'montaje',
  maintenanceCost: 'mantenimiento',
  conditions: 'condiciones',
  vatIncluded: 'impuestos',
  address: 'dirección',
  ownership: 'propio o contratado',
  warehouse: 'almacén',
  offerId: 'oferta',
  quantity: 'cantidad',
  dimensions: 'dimensiones',
  condition: 'estado',
  availability: 'disponibilidad',
  location: 'ubicación en el almacén',
  toAssess: 'aún por evaluar',
  text: 'texto',
  ref: 'vínculo',
  resolved: 'resuelta',
  source: 'origen',
  verification: 'verificación',
  // Revisión 1 · E2–E3.
  acronym: 'siglas',
  openingHours: 'horario',
  answer: 'respuesta',
  media: 'fotos',
  // Revisión 1 · E5 (names only: amounts never reach the history).
  tax: 'impuesto',
  concept: 'concepto',
  amount: 'importe',
};

/** «hora de inicio, empresa y estado»; unknown names are left out. */
export function changedFieldsLabel(fields: string[]): string {
  const labels = [...new Set(fields.map(f => FIELD_LABEL[f]).filter(Boolean))];
  if (labels.length <= 1) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')} y ${labels[labels.length - 1]}`;
}

/** One history line without the author or time: «Creó el registro», «Cambió hora de inicio y empresa». */
export function describeChange(
  entry: Pick<ActivityEntry, 'action' | 'changedFields'>,
): string {
  if (entry.action === 'create') return 'Creó el registro';
  if (entry.action === 'delete') return 'Lo borró';
  const what = changedFieldsLabel(entry.changedFields);
  return what ? `Cambió ${what}` : 'Lo guardó sin cambios visibles';
}

/**
 * Safety audit: who signed a change, «Dailos (soporte: Elvis)» when an
 * administrator made it in a support session on Dailos's account, or just
 * «Dailos». For `ActivityEntry` (`user`, `supportBy`) and accepted conflicts
 * (`acceptedBy`, `acceptedBySupport`).
 */
export function signatureLabel(
  user: {displayName: string},
  supportBy?: {displayName: string} | null,
): string {
  return supportBy
    ? `${user.displayName} (soporte: ${supportBy.displayName})`
    : user.displayName;
}

/**
 * The label of a delay hypothesis in activity and lists: «Retraso ≈ 15 min ·
 * Camión del escenario». Never its note.
 */
export function hypothesisLabel(
  h: Pick<DelayHypothesis, 'delayMinutes' | 'mode' | 'estimated' | 'taskTitle'>,
): string {
  const amount = `${h.estimated ? '≈ ' : ''}${minutesLabel(h.delayMinutes)}`;
  const what = h.mode === 'extend' ? 'Se alarga' : 'Retraso';
  return `${what} ${amount} · ${h.taskTitle}`;
}

/**
 * The label of a note in activity, links and lists that are not the note
 * itself: «Incidencia · Montaje del escenario». Never the text, and never a
 * person's name: «Incidencia · <name>» in a feed the guest can read would tie
 * a named person to an incident, so a note about a person is labelled by its
 * event, or by its kind alone.
 */
export function noteLabel(
  note: Pick<Note, 'kind'> & {
    ref?: {label: string; type?: NoteRefType} | null;
    event?: {name: string} | null;
  },
): string {
  const ref = note.ref && note.ref.type !== 'contact' ? note.ref.label : null;
  const about = ref ?? note.event?.name ?? null;
  const kind = NOTE_KIND_LABEL[note.kind];
  return about ? `${kind} · ${about}` : kind;
}
