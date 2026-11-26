/**
 * App-wide actions every screen and sheet may trigger (open a record, add
 * one, go to a calendar day), provided by `LogisticsApp`.
 */
import {createContext, useContext} from 'react';
import type {
  LocalDate,
  LogisticsEvent,
  Task,
} from '../../../shared/logistics/contracts.ts';

/** Values a new task starts with, from where it was added. */
export interface TaskPrefill {
  eventId?: string | null;
  date?: LocalDate | null;
  venueName?: string | null;
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
}

export const ActionsContext = createContext<LogisticsActions | null>(null);

export function useActions(): LogisticsActions {
  const ctx = useContext(ActionsContext);
  if (!ctx) throw new Error('useActions outside LogisticsApp');
  return ctx;
}
