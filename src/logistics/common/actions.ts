/**
 * App-wide actions every screen and sheet may trigger (open a record, add
 * one, go to a calendar day), provided by `LogisticsApp`.
 */
import {createContext, useContext} from 'react';
import type {
  Company,
  Contact,
  LocalDate,
  LogisticsEvent,
  Note,
  NoteKind,
  NoteRefType,
  Offer,
  Resource,
  ResourceOwnership,
  Task,
  Uuid,
  Warehouse,
} from '../../../shared/logistics/contracts.ts';

/** Values a new task starts with, from where it was added. */
export interface TaskPrefill {
  eventId?: string | null;
  date?: LocalDate | null;
  venueName?: string | null;
  companyName?: string | null;
  contactId?: Uuid | null;
  /** Resources it uses (e.g. «Añadir tarea» from a resource). */
  resourceIds?: Uuid[];
}

/** Values a new resource starts with (e.g. «Añadir recurso aquí»). */
export interface ResourcePrefill {
  name?: string;
  ownership?: ResourceOwnership;
  warehouseName?: string | null;
  companyName?: string | null;
  categoryId?: Uuid | null;
}

export interface WarehousePrefill {
  name?: string;
}

/** A note starts linked to where it was added from. */
export interface NotePrefill {
  kind?: NoteKind;
  eventId?: Uuid | null;
  ref?: {type: NoteRefType; id: Uuid; label: string} | null;
}

/** Values a new person starts with (e.g. from a company or a search). */
export interface ContactPrefill {
  name?: string;
  companyName?: string | null;
}

export interface CompanyPrefill {
  name?: string;
}

export interface OfferPrefill {
  companyName?: string | null;
  categoryId?: Uuid | null;
  name?: string;
}

export interface LogisticsActions {
  canWrite: boolean;
  /** Local today in the organization's time zone. */
  today: LocalDate;
  timeZone: string;
  openEvent: (event: LogisticsEvent) => void;
  addEvent: () => void;
  openTask: (task: Task) => void;
  addTask: (prefill?: TaskPrefill) => void;
  /** Goes to the calendar's day view. */
  openDay: (date: LocalDate) => void;
  // Milestone 3: people, companies, offers and search.
  openContact: (contact: Contact) => void;
  addContact: (prefill?: ContactPrefill) => void;
  openCompany: (company: Company) => void;
  addCompany: (prefill?: CompanyPrefill) => void;
  openOffer: (offer: Offer) => void;
  addOffer: (prefill?: OfferPrefill) => void;
  /** A small card with a venue's events and tasks. */
  openVenue: (venueId: Uuid) => void;
  openSearch: () => void;
  // Milestone 4: inventories and notes.
  openWarehouse: (warehouse: Warehouse) => void;
  addWarehouse: (prefill?: WarehousePrefill) => void;
  openResource: (resource: Resource) => void;
  addResource: (prefill?: ResourcePrefill) => void;
  openNote: (note: Note) => void;
  addNote: (prefill?: NotePrefill) => void;
  // Milestone 6: changes saved only on this device.
  /** «Cambios pendientes». */
  openOutbox: () => void;
}

export const ActionsContext = createContext<LogisticsActions | null>(null);

export function useActions(): LogisticsActions {
  const ctx = useContext(ActionsContext);
  if (!ctx) throw new Error('useActions outside LogisticsApp');
  return ctx;
}
