/**
 * @module engine/planning/contacts
 * Utilidades puras compartidas para contactos de proveedores, tipos de actividad
 * personalizables, mensajes de consulta (correo/WhatsApp) y migración de proyectos antiguos.
 */
import type {
  ActivityNeed,
  ContactItem,
  CustomActivityItem,
  Scene,
} from '../../types';
import {activities} from './programme';

/** Opciones base del selector «Actividad» en Contactos. */
export const DEFAULT_CONTACT_KINDS = [
  'Foodtruck',
  'Ventorrillo',
  'Taller',
  'Comercio',
  'Montaje',
] as const;

/** Etiquetas comprensibles para los recursos técnicos requeridos por cada actividad. */
export const ACTIVITY_NEED_LABELS: Record<ActivityNeed, string> = {
  roof: 'Zona cubierta / carpa',
  stage: 'Escenario',
  tables: 'Mesas (mín. 2 picnic)',
  power: 'Punto eléctrico',
  open: 'Espacio abierto (sin requisito)',
};

/**
 * Combina listas de opciones evitando duplicados sin distinguir mayúsculas ni espacios extremos.
 */
export function mergeUniqueOptions(
  base: readonly string[],
  extra: readonly string[]
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of [...base, ...extra]) {
    const trimmed = String(raw || '').trim();
    if (!trimmed) continue;
    const key = trimmed.toLocaleLowerCase('es');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

/**
 * Valida una nueva opción escrita mediante «Otra…» comprobando que no esté vacía ni duplicada.
 */
export function validateCustomOption(
  raw: string,
  existing: readonly string[]
): {ok: true; value: string} | {ok: false; error: string} {
  const value = raw.trim();
  if (!value) {
    return {ok: false, error: 'Escribe un nombre antes de añadir.'};
  }
  const key = value.toLocaleLowerCase('es');
  if (existing.some((opt) => opt.trim().toLocaleLowerCase('es') === key)) {
    return {ok: false, error: 'Esa opción ya existe en la lista.'};
  }
  return {ok: true, value};
}

/**
 * Devuelve todos los tipos de actividad disponibles en Contactos (base + personalizados + existentes).
 */
export function getContactKinds(
  scene: Pick<Scene, 'contacts' | 'contactKinds'>
): string[] {
  return mergeUniqueOptions(DEFAULT_CONTACT_KINDS, [
    ...(scene.contactKinds || []),
    ...(scene.contacts || []).map((c) => c.kind),
  ]);
}

/**
 * Devuelve todas las categorías disponibles para actividades del programa (catálogo + propias).
 */
export function getActivityCategories(
  customActivities?: CustomActivityItem[]
): string[] {
  return mergeUniqueOptions(
    activities.map((a) => a.category),
    (customActivities || []).map((a) => a.category)
  );
}

/**
 * Genera el texto pre-redactado de consulta para correo o WhatsApp, compartido entre
 * el diálogo de Contactos y la sección «Proveedores para consultar» de Programa.
 */
export function buildContactInquiryMessage(
  contact: Pick<ContactItem, 'name' | 'kind'>,
  eventTitle: string,
  venueName: string,
  activityNames: string[] = []
): string {
  const activitiesClause = activityNames.length
    ? ` En concreto, estamos valorando las actividades: ${activityNames.join(', ')}.`
    : '';
  return (
    `Buenos días. Estamos estudiando la organización de ${eventTitle} en ${venueName}. ` +
    `Nos gustaría consultar su disponibilidad como ${contact.kind}, presupuesto, necesidades de espacio y electricidad, ` +
    `capacidad de atención y horarios de montaje y retirada.${activitiesClause} ` +
    'Fechas y condiciones pendientes de concretar. Muchas gracias.'
  );
}

/** Construye un enlace `mailto:` con asunto y cuerpo codificados. */
export function buildMailtoHref(email: string, message: string): string {
  return `mailto:${encodeURIComponent(email.trim())}?subject=${encodeURIComponent('Consulta de disponibilidad para evento')}&body=${encodeURIComponent(message)}`;
}

/** Construye un enlace `https://wa.me/...` con el mensaje codificado. */
export function buildWhatsAppHref(phone: string, message: string): string {
  return `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`;
}

/**
 * Migra de forma idempotente los contactos sin `id` estable y limpia referencias huérfanas
 * en `activityContacts` o `programme.schedule` (proyectos heredados o contactos borrados).
 */
export function migrateSceneContactsAndProgramme(scene: Scene): Scene {
  if (Array.isArray(scene.contacts)) {
    const usedIds = new Set<string>();
    scene.contacts = scene.contacts.map((c) => {
      let id = typeof c.id === 'string' && c.id.trim() ? c.id.trim() : '';
      if (!id || usedIds.has(id)) {
        id = crypto.randomUUID();
      }
      usedIds.add(id);
      return {...c, id};
    });
  }

  const validContactIds = new Set((scene.contacts || []).map((c) => c.id));

  if (scene.activityContacts && typeof scene.activityContacts === 'object') {
    for (const [actId, contactId] of Object.entries(scene.activityContacts)) {
      if (!contactId || !validContactIds.has(contactId)) {
        delete scene.activityContacts[actId];
      }
    }
  }

  const prog = scene.programme as
    | {schedule?: Array<{contactId?: string}>}
    | undefined;
  if (prog && Array.isArray(prog.schedule)) {
    for (const session of prog.schedule) {
      if (session.contactId && !validContactIds.has(session.contactId)) {
        delete session.contactId;
      }
    }
  }

  return scene;
}

/**
 * Elimina un contacto de la escena por su `id` estable y desvincula limpiamente
 * cualquier actividad o sesión guardada que apuntara a él (dejándolas «sin empresa»).
 */
export function removeContactFromScene(scene: Scene, contactId: string): void {
  scene.contacts = (scene.contacts || []).filter((c) => c.id !== contactId);
  if (scene.activityContacts) {
    for (const [actId, cid] of Object.entries(scene.activityContacts)) {
      if (cid === contactId) {
        delete scene.activityContacts[actId];
      }
    }
  }
  const prog = scene.programme as
    | {schedule?: Array<{contactId?: string}>}
    | undefined;
  if (prog && Array.isArray(prog.schedule)) {
    for (const session of prog.schedule) {
      if (session.contactId === contactId) {
        delete session.contactId;
      }
    }
  }
}
