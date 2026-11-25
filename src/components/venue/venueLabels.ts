/**
 * Shared Spanish labels and small UI helpers for venue (Recinto) and layout
 * (Distribución) views (OX-04). Presentation only: no domain rules here.
 */
import type {PhaseKey} from '../../types';
import type {Layout, LayoutState, Venue} from '../../types/venue';
import type {GateCategory} from '../../engine/workspace/venue-layout';

export const LAYOUT_STATE_LABELS: Record<LayoutState, string> = {
  draft: 'Borrador',
  proposal: 'Propuesta',
  current: 'Vigente',
  archived: 'Archivada',
};

/** Operational phases («fases operativas») a layout may cover, in display order. */
export const LAYOUT_PHASES: Array<{key: PhaseKey; label: string}> = [
  {key: 'pre', label: 'Montaje'},
  {key: 'event', label: 'Evento'},
  {key: 'post', label: 'Recogida'},
];

export const GATE_CATEGORY_LABELS: Record<GateCategory, string> = {
  perimeter: 'Perímetro',
  access: 'Accesos (público y emergencias)',
  subsoil: 'Subsuelo / carga pesada',
  medical: 'Rutas sanitarias A/B/C',
  response: 'Aproximación de bomberos y policía',
};

export const GATE_CATEGORY_ORDER: GateCategory[] = [
  'perimeter',
  'access',
  'subsoil',
  'medical',
  'response',
];

/** Disclaimer shown with every promotion review result. */
export const REVIEW_DISCLAIMER =
  'Revisión orientativa; no certifica la seguridad del evento. Evalúa la configuración de la fase de evento; los elementos exclusivos de montaje o recogida no se comprueban.';

export const STALE_LABEL = 'Recinto modificado: revisar';

/** A layout evaluated against an older venue version (plan D8). */
export function isLayoutStale(layout: Layout, venues: Venue[]): boolean {
  const venue = venues.find((v) => v.id === layout.venueId);
  return !!venue && layout.baseVenueVersion < venue.version;
}
