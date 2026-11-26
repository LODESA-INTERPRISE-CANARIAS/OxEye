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
  Offer,
  Task,
  Uuid,
} from '../../../shared/logistics/contracts.ts';

/** Values a new task starts with, from where it was added. */
export interface TaskPrefill {
  eventId?: string | null;
  date?: LocalDate | null;
  venueName?: string | null;
  companyName?: string | null;
  contactId?: Uuid | null;
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
}

export const ActionsContext = createContext<LogisticsActions | null>(null);

export function useActions(): LogisticsActions {
  const ctx = useContext(ActionsContext);
  if (!ctx) throw new Error('useActions outside LogisticsApp');
  return ctx;
}
