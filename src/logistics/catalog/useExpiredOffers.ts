/**
 * Offers whose current terms can no longer be accepted (Revisión 1 · E6),
 * from the session's current versions (`expiredOfferIds` in compare.ts).
 * «Comparar» never ranks them and the budget's offer picker marks them.
 * While the versions load, or when they cannot be read, nothing is marked.
 */
import {useMemo} from 'react';
import {useActions} from '../common/actions';
import {useCurrentVersions} from '../offers/data';
import {expiredOfferIds} from './compare';

export function useExpiredOffers(enabled = true): ReadonlySet<string> {
  const {today} = useActions();
  const current = useCurrentVersions(enabled);
  return useMemo(
    () => expiredOfferIds(enabled ? current.data : null, today),
    [enabled, current.data, today],
  );
}
