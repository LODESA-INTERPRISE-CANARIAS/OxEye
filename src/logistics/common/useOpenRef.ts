/**
 * Opens the record a note points at, from the loaded lists. Returns null
 * when that record is not loaded (deleted, or lists still loading), so the
 * caller shows the name without a link.
 */
import {useCallback} from 'react';
import type {NoteRefType} from '../../../shared/logistics/contracts.ts';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {useActions} from './actions';

export function useOpenRef(): (ref: {
  type: NoteRefType;
  id: string;
}) => (() => void) | null {
  const tasks = useLogisticsStore(s => s.tasks);
  const venues = useLogisticsStore(s => s.venues);
  const companies = useLogisticsStore(s => s.companies);
  const contacts = useLogisticsStore(s => s.contacts);
  const offers = useLogisticsStore(s => s.offers);
  const warehouses = useLogisticsStore(s => s.warehouses);
  const resources = useLogisticsStore(s => s.resources);
  const a = useActions();
  return useCallback(
    ref => {
      const find = <T extends {id: string}>(list: T[]) =>
        list.find(x => x.id === ref.id);
      switch (ref.type) {
        case 'task': {
          const t = find(tasks);
          return t ? () => a.openTask(t) : null;
        }
        case 'venue':
          return find(venues) ? () => a.openVenue(ref.id) : null;
        case 'company': {
          const c = find(companies);
          return c ? () => a.openCompany(c) : null;
        }
        case 'contact': {
          const c = find(contacts);
          return c ? () => a.openContact(c) : null;
        }
        case 'offer': {
          const o = find(offers);
          return o ? () => a.openOffer(o) : null;
        }
        case 'warehouse': {
          const w = find(warehouses);
          return w ? () => a.openWarehouse(w) : null;
        }
        case 'resource': {
          const r = find(resources);
          return r ? () => a.openResource(r) : null;
        }
      }
    },
    [tasks, venues, companies, contacts, offers, warehouses, resources, a],
  );
}
