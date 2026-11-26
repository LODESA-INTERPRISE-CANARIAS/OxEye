/**
 * Presentation helpers for logistics events: ordering, local dates, labels and
 * what information is still missing. No React, no store.
 */
import type {
  Company,
  Contact,
  DataSource,
  EventStatus,
  LogisticsEvent,
  Offer,
  Resource,
  Task,
  Verification,
  Warehouse,
} from '../../../shared/logistics/contracts.ts';
import {
  missingForCompany,
  missingForContact,
  missingForOffer,
  missingForResource,
  missingForTask,
  missingForWarehouse,
} from '../../../shared/logistics/quality.ts';
import {recordDays, recordSlot, sortRecords} from './tasks';

/** Server order: date, then startsAt, undated last, then name. */
export function sortEvents(events: LogisticsEvent[]): LogisticsEvent[] {
  return sortRecords(events, e => e.name);
}

export const STATUS_LABEL: Record<EventStatus, string> = {
  planned: 'Previsto',
  confirmed: 'Confirmado',
  delayed: 'Con retraso',
  cancelled: 'Cancelado',
};

export const STATUS_HELP: Record<EventStatus, string> = {
  planned: 'Está en el plan, pero aún no se ha confirmado.',
  confirmed: 'Confirmado con quien lo organiza.',
  delayed: 'Va con retraso respecto a lo previsto.',
  cancelled: 'No se celebrará.',
};

export const VERIFICATION_LABEL: Record<Verification, string> = {
  draft: 'Borrador',
  to_verify: 'Por verificar',
  validated: 'Validado',
};

export const VERIFICATION_HELP: Record<Verification, string> = {
  draft: 'Apunte rápido; puede estar incompleto.',
  to_verify: 'Hay que comprobarlo con la fuente.',
  validated: 'Comprobado con la fuente.',
};

export const SOURCE_LABEL: Record<DataSource, string> = {
  observed: 'Observado',
  reported: 'Comunicado',
  document: 'Documento',
};

export const SOURCE_HELP: Record<DataSource, string> = {
  observed: 'Lo hemos visto en persona.',
  reported: 'Nos lo ha dicho alguien.',
  document: 'Consta en un documento, contrato o correo.',
};

export type MissingKey = 'venue' | 'date' | 'start' | 'end' | 'validation';

export const MISSING_LABEL: Record<MissingKey, string> = {
  venue: 'lugar',
  date: 'fecha',
  start: 'hora de inicio',
  end: 'hora de fin',
  validation: 'validación',
};

/** What an event still lacks, in display order. Cancelled events count too. */
export function missingInfo(event: LogisticsEvent): MissingKey[] {
  const slot = recordSlot(event);
  const missing: MissingKey[] = [];
  if (!event.venue) missing.push('venue');
  if (!slot.date) missing.push('date');
  else {
    if (!slot.startTime) missing.push('start');
    if (!slot.endTime) missing.push('end');
  }
  if (event.verification !== 'validated') missing.push('validation');
  return missing;
}

/** A record that still lacks information, for «Qué falta». */
export type PendingRow =
  | {
      kind: 'event';
      id: string;
      name: string;
      missing: string[];
      event: LogisticsEvent;
    }
  | {kind: 'task'; id: string; name: string; missing: string[]; task: Task}
  | {
      kind: 'contact';
      id: string;
      name: string;
      missing: string[];
      contact: Contact;
    }
  | {
      kind: 'company';
      id: string;
      name: string;
      missing: string[];
      company: Company;
    }
  | {kind: 'offer'; id: string; name: string; missing: string[]; offer: Offer}
  | {
      kind: 'warehouse';
      id: string;
      name: string;
      missing: string[];
      warehouse: Warehouse;
    }
  | {
      kind: 'resource';
      id: string;
      name: string;
      missing: string[];
      resource: Resource;
    };

export interface VerificationSummary {
  total: number;
  validated: number;
  /** 0–100, rounded; null when there is nothing recorded. */
  percent: number | null;
  incomplete: PendingRow[];
}

/**
 * People, companies and offers (milestone 3), warehouses and resources
 * (milestone 4) also count as information. Notes do not: they are remarks,
 * not data to verify.
 */
export interface DirectoryRecords {
  contacts?: Contact[];
  companies?: Company[];
  offers?: Offer[];
  warehouses?: Warehouse[];
  resources?: Resource[];
}

const withValidation = (missing: string[], v: Verification) =>
  v === 'validated' ? missing : [...missing, 'validación'];

/**
 * Validated share and missing data over everything recorded. In «Qué falta»
 * events and tasks come before the directory: they are what the day depends
 * on; then the records missing most go first.
 */
export function verificationSummary(
  events: LogisticsEvent[],
  tasks: Task[] = [],
  directory: DirectoryRecords = {},
): VerificationSummary {
  const {
    contacts = [],
    companies = [],
    offers = [],
    warehouses = [],
    resources = [],
  } = directory;
  const records = [
    ...events,
    ...tasks,
    ...contacts,
    ...companies,
    ...offers,
    ...warehouses,
    ...resources,
  ];
  const total = records.length;
  const validated = records.filter(r => r.verification === 'validated').length;
  const rows: PendingRow[] = [
    ...events.map((event): PendingRow => ({
      kind: 'event',
      id: event.id,
      name: event.name,
      missing: missingInfo(event).map(m => MISSING_LABEL[m]),
      event,
    })),
    ...tasks.map((task): PendingRow => ({
      kind: 'task',
      id: task.id,
      name: task.title,
      missing: [
        ...missingForTask(task),
        ...(task.verification === 'validated' ? [] : ['validación']),
      ],
      task,
    })),
    ...contacts.map((contact): PendingRow => ({
      kind: 'contact',
      id: contact.id,
      name: contact.name,
      missing: withValidation(missingForContact(contact), contact.verification),
      contact,
    })),
    ...companies.map((company): PendingRow => ({
      kind: 'company',
      id: company.id,
      name: company.name,
      missing: withValidation(missingForCompany(company), company.verification),
      company,
    })),
    ...offers.map((offer): PendingRow => ({
      kind: 'offer',
      id: offer.id,
      name: offer.company
        ? `${offer.name} · ${offer.company.name}`
        : offer.name,
      missing: withValidation(missingForOffer(offer), offer.verification),
      offer,
    })),
    ...warehouses.map((warehouse): PendingRow => ({
      kind: 'warehouse',
      id: warehouse.id,
      name: warehouse.name,
      missing: withValidation(
        missingForWarehouse(warehouse),
        warehouse.verification,
      ),
      warehouse,
    })),
    ...resources.map((resource): PendingRow => ({
      kind: 'resource',
      id: resource.id,
      name: resource.warehouse
        ? `${resource.name} · ${resource.warehouse.name}`
        : resource.name,
      missing: withValidation(
        missingForResource(resource),
        resource.verification,
      ),
      resource,
    })),
  ];
  const planFirst = (row: PendingRow) =>
    row.kind === 'event' || row.kind === 'task' ? 0 : 1;
  const incomplete = rows
    .filter(row => row.missing.length > 0)
    .sort(
      (a, b) =>
        planFirst(a) - planFirst(b) || b.missing.length - a.missing.length,
    );
  return {
    total,
    validated,
    percent: total ? Math.round((validated / total) * 100) : null,
    incomplete,
  };
}

/**
 * Groups events into today, upcoming and undated, relative to `today`. A
 * multi-day event that is on today counts as today.
 */
export function groupForToday(events: LogisticsEvent[], today: string) {
  const todayEvents: LogisticsEvent[] = [];
  const upcoming: LogisticsEvent[] = [];
  const undated: LogisticsEvent[] = [];
  for (const event of events) {
    const days = recordDays(event);
    if (!days.length) undated.push(event);
    else if (days.includes(today)) todayEvents.push(event);
    else if (days[0] > today) upcoming.push(event);
  }
  return {todayEvents, upcoming, undated};
}
