/**
 * Domain constants shared by the server (validation) and the UI (forms,
 * labels), so both sides accept exactly the same values.
 */
import type {
  CompanyKind,
  EventStatus,
  NoteKind,
  NoteRefType,
  PriceUnit,
  ResourceAvailability,
  ResourceCondition,
  ResourceOwnership,
  TaskKind,
  TaskStatus,
} from './contracts.ts';

/** Display order: the life of an event, from set-up to tear-down. */
export const TASK_KINDS = [
  'assembly',
  'activity',
  'dismantling',
  'transport',
  'delivery',
  'other',
] as const satisfies readonly TaskKind[];

export const TASK_STATUSES = [
  'planned',
  'confirmed',
  'in_progress',
  'done',
  'delayed',
  'cancelled',
] as const satisfies readonly TaskStatus[];

export const TASK_KIND_LABEL: Record<TaskKind, string> = {
  assembly: 'Montaje',
  activity: 'Actividad',
  dismantling: 'Desmontaje',
  transport: 'Transporte',
  delivery: 'Entrega',
  other: 'Otra',
};

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  planned: 'Prevista',
  confirmed: 'Confirmada',
  in_progress: 'En curso',
  done: 'Hecha',
  delayed: 'Con retraso',
  cancelled: 'Cancelada',
};

export const EVENT_STATUSES = [
  'planned',
  'confirmed',
  'delayed',
  'cancelled',
] as const satisfies readonly EventStatus[];

/** Longest multi-day span accepted (a typo in the year would fill the calendar). */
export const MAX_SPAN_DAYS = 366;

// ---------------------------------------------------------------- contacts and catalogue (M3)

export const COMPANY_KINDS = [
  'supplier',
  'public_body',
  'association',
  'other',
] as const satisfies readonly CompanyKind[];

export const COMPANY_KIND_LABEL: Record<CompanyKind, string> = {
  supplier: 'Proveedor',
  public_body: 'Organismo público',
  association: 'Asociación',
  other: 'Otra entidad',
};

export const PRICE_UNITS = [
  'unit',
  'metre',
  'hour',
  'day',
  'km',
  'pack',
  'custom',
] as const satisfies readonly PriceUnit[];

/**
 * Service categories every organization starts with, in display order (the
 * spectrum of the product vision). Users add more; built-ins stay.
 */
export const BUILT_IN_SERVICE_CATEGORIES = [
  'Montaje',
  'Estructuras',
  'Carpas',
  'Vallas',
  'Transporte',
  'Catering',
  'Publicidad',
  'Personal',
  'Seguridad',
  'Sonido',
  'Iluminación',
  'Audiovisuales',
  'Limpieza',
  'Ocio',
  'Otros servicios',
] as const;

export const CATEGORY_NAME_MAX = 60;
/** Highest amount accepted for a price or cost, in euros. */
export const MAX_AMOUNT_EUR = 10_000_000;
export const PHONE_MAX = 50;
export const EMAIL_MAX = 254;
export const WEBSITE_MAX = 500;
export const ROLE_MAX = 120;
export const CUSTOM_UNIT_MAX = 60;
export const MAX_CATEGORIES_PER_COMPANY = 20;
export const MAX_EVENTS_PER_CONTACT = 100;
export const RECENT_SEARCH_MAX_LENGTH = 100;
export const RECENT_SEARCHES_KEPT = 5;

/**
 * A phone as typed on site: digits with spaces, dots, dashes, slashes,
 * brackets and an optional leading +; at least 3 digits (short municipal
 * numbers such as 112 or 010 are valid). Rejects free text («mañana lo paso»).
 */
export function isPlausiblePhone(value: string): boolean {
  const v = value.trim();
  if (v.length > PHONE_MAX) return false;
  if (!/^\+?[0-9 ().\-/]+$/.test(v)) return false;
  return (v.match(/[0-9]/g) ?? []).length >= 3;
}

/** Loose e-mail shape: something@domain.tld, no spaces. */
export function isPlausibleEmail(value: string): boolean {
  const v = value.trim();
  return v.length <= EMAIL_MAX && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

/** An amount in euros: finite, 0 – MAX_AMOUNT_EUR, at most two decimals. */
export function isValidAmount(value: number): boolean {
  return (
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_AMOUNT_EUR &&
    hasAtMostTwoDecimals(value)
  );
}

function hasAtMostTwoDecimals(value: number): boolean {
  return Math.abs(Math.round(value * 100) - value * 100) < 1e-6;
}

// ---------------------------------------------------------------- inventories and notes (M4)

export const RESOURCE_OWNERSHIPS = [
  'owned',
  'contracted',
] as const satisfies readonly ResourceOwnership[];

export const RESOURCE_OWNERSHIP_LABEL: Record<ResourceOwnership, string> = {
  owned: 'Propio',
  contracted: 'Contratado',
};

/** Display order: best first, unknown last. */
export const RESOURCE_CONDITIONS = [
  'good',
  'fair',
  'damaged',
  'unknown',
] as const satisfies readonly ResourceCondition[];

export const RESOURCE_CONDITION_LABEL: Record<ResourceCondition, string> = {
  good: 'Buen estado',
  fair: 'Con desgaste',
  damaged: 'Con daños',
  unknown: 'Estado sin revisar',
};

export const RESOURCE_AVAILABILITIES = [
  'available',
  'in_use',
  'maintenance',
  'unknown',
] as const satisfies readonly ResourceAvailability[];

export const RESOURCE_AVAILABILITY_LABEL: Record<ResourceAvailability, string> =
  {
    available: 'Disponible',
    in_use: 'En uso',
    maintenance: 'En reparación',
    unknown: 'Disponibilidad sin confirmar',
  };

/**
 * Resource categories every organization starts with, in display order
 * (the materials named in the product vision). Users add more; built-ins stay.
 */
export const BUILT_IN_RESOURCE_CATEGORIES = [
  'Carpas',
  'Vallas',
  'Mesas',
  'Sillas y bancos',
  'Escenarios y tarimas',
  'Vehículos',
  'Generadores y electricidad',
  'Sonido e iluminación',
  'Señalización',
  'Otros materiales',
] as const;

/** Default unit of a resource. */
export const DEFAULT_RESOURCE_UNIT = 'unidades';
/** Suggestions for the unit field; any other wording is accepted. */
export const RESOURCE_UNIT_SUGGESTIONS = [
  'unidades',
  'm',
  'm²',
  'juegos',
  'palés',
  'kg',
  'l',
] as const;

export const RESOURCE_UNIT_MAX = 30;
export const DIMENSIONS_MAX = 120;
export const LOCATION_MAX = 200;
export const ADDRESS_MAX = 300;
export const NOTES_MAX = 5000;
export const NOTE_TEXT_MAX = 5000;
export const MAX_RESOURCES_PER_TASK = 50;
/** Highest quantity accepted (a typo would otherwise inflate the inventory). */
export const MAX_RESOURCE_QUANTITY = 1_000_000;

/** A counted quantity: finite, 0 – MAX_RESOURCE_QUANTITY, at most two decimals. */
export function isValidQuantity(value: number): boolean {
  return (
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_RESOURCE_QUANTITY &&
    hasAtMostTwoDecimals(value)
  );
}

export const NOTE_KINDS = [
  'note',
  'incident',
  'decision',
  'open_question',
  'feature_idea',
] as const satisfies readonly NoteKind[];

export const NOTE_KIND_LABEL: Record<NoteKind, string> = {
  note: 'Nota',
  incident: 'Incidencia',
  decision: 'Decisión',
  open_question: 'Pregunta abierta',
  feature_idea: 'Idea para la herramienta',
};

/** Kinds that can be marked resolved (incident) or answered (question). */
export const RESOLVABLE_NOTE_KINDS: ReadonlySet<NoteKind> = new Set([
  'incident',
  'open_question',
]);

export const NOTE_REF_TYPES = [
  'task',
  'venue',
  'company',
  'contact',
  'offer',
  'warehouse',
  'resource',
] as const satisfies readonly NoteRefType[];

/**
 * Shown on every «Incidencia» form and sheet. Invariant 3: this tool never
 * holds Punto Violeta cases or data about people who were attended.
 */
export const INCIDENT_SCOPE_NOTE =
  'Solo incidencias logísticas (un camión que no llega, una valla rota). Aquí no se registran casos de Punto Violeta ni datos de personas atendidas.';

/** Shown on every note form: what not to write in free text. */
export const NOTE_PRIVACY_HINT =
  'No anotes datos de salud, datos de personas atendidas ni casos de Punto Violeta. El equipo ve el texto; Invitado, no.';

// ---------------------------------------------------------------- follow-up and hypotheses (M5)

/** Largest delay a hypothesis accepts (one day). */
export const MAX_DELAY_MINUTES = 24 * 60;
/** One-tap delays in the «¿Y si…?» sheet. */
export const QUICK_DELAYS = [5, 15, 30, 60] as const;
export const HYPOTHESIS_NOTE_MAX = 1000;
/**
 * Minutes after its planned time before a task counts as «Va tarde». Before
 * that it is shown as «Debería empezar» / «Debería terminar».
 */
export const LATE_GRACE_MINUTES = 5;

export function isValidDelay(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= MAX_DELAY_MINUTES;
}

/**
 * «Subsuelo revisado en el simulador» is declared by a person. It is never
 * deduced from quantities, units or dimensions, it never quotes or computes
 * a threshold and it never states that anything complies.
 */
export const SUBSOIL_REVIEW_LABEL = 'Subsuelo revisado en el simulador';
export const SUBSOIL_REVIEW_NOTE =
  'Marca declarada por quien hizo la revisión en el simulador (análisis de rayos X). OxEye no la comprueba y no certifica el suelo. Se borra si cambian el lugar, la carga pesada o los recursos de la tarea.';

// ---------------------------------------------------------------- M6: offline and day close

/**
 * `GET …/changes` also reports types written in the last two minutes, so a
 * transaction that took a lower `seq` but committed after a later one is
 * never skipped by a client that already moved its cursor.
 */
export const CHANGES_OVERLAP_SECONDS = 120;
/** Most activity entries returned for a `from`/`to` range (one day close). */
export const ACTIVITY_RANGE_MAX = 2000;
/** Longest `from`/`to` span the activity route accepts. */
export const ACTIVITY_RANGE_MAX_DAYS = 8;

// ---------------------------------------------------------------- Revisión 1 · E2: moves and accepted conflicts

/** A move (calendar drag, conflict exit) snaps to this many minutes. */
export const MOVE_STEP_MINUTES = 5;

/**
 * A move is a signed, non-zero whole number of minutes, a multiple of
 * MOVE_STEP_MINUTES, at most MAX_DELAY_MINUTES (one day) either way.
 */
export function isValidMove(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value !== 0 &&
    Math.abs(value) <= MAX_DELAY_MINUTES &&
    value % MOVE_STEP_MINUTES === 0
  );
}

/** «Mantener ambas»: the short reason the team gives (trimmed length). */
export const ACCEPT_REASON_MIN = 3;
export const ACCEPT_REASON_MAX = 280;

// ---------------------------------------------------------------- Revisión 1 · E3: answers and images

/**
 * Largest image the server stores, in bytes. Images are resized on the
 * device (about 1600 px, under 400 KB); the margin covers PNG screenshots.
 */
export const MEDIA_MAX_BYTES = 600 * 1024;
/** One main image plus up to four more per record. */
export const MEDIA_PER_RECORD = 5;
/** Longest side, in pixels, the server accepts (the device sends ~1600). */
export const MEDIA_MAX_SIDE = 4096;
export const MEDIA_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

// ---------------------------------------------------------------- Revisión 1 · E5: taxes and budget

/** Picker order. */
export const TAX_REGIMES = ['igic', 'iva', 'other', 'none', 'unknown'] as const;

/** Names in pickers and labels. */
export const TAX_REGIME_LABEL: Record<(typeof TAX_REGIMES)[number], string> = {
  igic: 'IGIC',
  iva: 'IVA',
  other: 'Otro',
  none: 'Ninguno',
  unknown: 'Sin saber',
};

/**
 * Rates prefilled when IGIC or IVA is picked without a percentage (general
 * rates as of 2026). Indicative and editable: the tax stays «por verificar»
 * until somebody confirms it, and it is never applied to a record that did
 * not state its tax.
 */
export const DEFAULT_TAX_RATE = {igic: 7, iva: 21} as const;

/** Name of an «otro» tax («IPSI»…). */
export const TAX_NAME_MAX = 40;
/** Largest percentage accepted. */
export const TAX_RATE_MAX = 100;

export const EXPENSE_STATUSES = ['planned', 'confirmed'] as const;
export const EXPENSE_STATUS_LABEL: Record<
  (typeof EXPENSE_STATUSES)[number],
  string
> = {
  planned: 'Previsto',
  confirmed: 'Confirmado',
};
/** Expenses one event can hold (a budget, not a ledger). */
export const MAX_EXPENSES_PER_EVENT = 500;

/** Label every amount with tax carries: it is computed, never stated. */
export const TAX_ESTIMATE_LABEL = 'estimación';
