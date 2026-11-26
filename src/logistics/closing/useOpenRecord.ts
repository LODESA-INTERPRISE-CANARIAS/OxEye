/**
 * Opens what a report line points at, from the records in the store: the
 * report carries only ids and names. A hypothesis opens its task (where
 * «¿Y si…?» lives). Returns false when the record is no longer there.
 */
import {useCallback} from 'react';
import type {Uuid} from '../../../shared/logistics/contracts.ts';
import type {DayRecordType} from '../../../shared/logistics/day-report.ts';
import {useActions} from '../common/actions';
import {useLogisticsStore} from '../store/useLogisticsStore';

export type OpenTarget = DayRecordType | 'hypothesis';

export function useOpenRecord(): (type: OpenTarget, id: Uuid) => boolean {
  const actions = useActions();
  return useCallback(
    (type: OpenTarget, id: Uuid) => {
      const s = useLogisticsStore.getState();
      const find = <T extends {id: Uuid}>(list: readonly T[]) =>
        list.find(r => r.id === id) ?? null;
      switch (type) {
        case 'event': {
          const r = find(s.events);
          if (r) actions.openEvent(r);
          return !!r;
        }
        case 'task': {
          const r = find(s.tasks);
          if (r) actions.openTask(r);
          return !!r;
        }
        case 'contact': {
          const r = find(s.contacts);
          if (r) actions.openContact(r);
          return !!r;
        }
        case 'company': {
          const r = find(s.companies);
          if (r) actions.openCompany(r);
          return !!r;
        }
        case 'offer': {
          const r = find(s.offers);
          if (r) actions.openOffer(r);
          return !!r;
        }
        case 'warehouse': {
          const r = find(s.warehouses);
          if (r) actions.openWarehouse(r);
          return !!r;
        }
        case 'resource': {
          const r = find(s.resources);
          if (r) actions.openResource(r);
          return !!r;
        }
        case 'note': {
          const r = find(s.notes);
          if (r) actions.openNote(r);
          return !!r;
        }
        case 'hypothesis': {
          const h = find(s.hypotheses);
          const task = h ? s.tasks.find(t => t.id === h.taskId) : undefined;
          if (task) actions.openTask(task);
          return !!task;
        }
      }
    },
    [actions],
  );
}
