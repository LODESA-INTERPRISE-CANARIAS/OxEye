/**
 * «Generada por Ox Eye · renegociación de …» (Revisión 1 · E6): the mark of a
 * task that Ox Eye created because an offer is about to expire, with a link
 * to that offer. Only members who read the directory have renewals (guests
 * get 403), so for anyone else it renders nothing and asks for nothing.
 */
import React from 'react';
import {useAccess} from '../account/useAccess';
import {useActions} from '../common/actions';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {EyeMark} from '../ui';
import {useRenewals} from './data';
import {dayYear} from './format';

export const RenewalMark: React.FC<{taskId: string}> = ({taskId}) => {
  const access = useAccess();
  const member = useLogisticsStore(s => s.session?.user.role === 'member');
  const enabled = member && access.can('directory.read');
  const renewals = useRenewals(enabled);
  const offers = useLogisticsStore(s => s.offers);
  const {openOffer} = useActions();
  const renewal = enabled
    ? renewals.data?.find(r => r.taskId === taskId)
    : undefined;
  if (!renewal) return null;
  const offer = offers.find(o => o.id === renewal.offer.id);
  return (
    <p className="lx-signed lx-renewalmark" id="lx-task-renewal">
      <EyeMark size={18} />
      <span>
        Generada por Ox Eye · renegociación de{' '}
        {offer ? (
          <button
            type="button"
            className="lx-link"
            id="lx-task-renewal-offer"
            onClick={() => openOffer(offer)}
          >
            {renewal.offer.name}
          </button>
        ) : (
          <strong>{renewal.offer.name}</strong>
        )}{' '}
        ({renewal.company.name}) ·{' '}
        {renewal.resolvedAt ? (
          `renovada con la versión ${renewal.resolvedByVersion ?? ''}`.trim()
        ) : (
          <span className="lx-num">
            se puede aceptar hasta el {dayYear(renewal.acceptUntil)}
          </span>
        )}
      </span>
    </p>
  );
};
