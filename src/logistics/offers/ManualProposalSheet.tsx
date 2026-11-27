/**
 * «Registrar una recibida» (Revisión 1 · E7): an offer a company gave by
 * phone, by e-mail or in person, recorded with the same guided form the
 * companies use, plus how it reached us. It waits for an administrator like
 * any other proposal.
 */
import React, {useState} from 'react';
import type {Uuid} from '../../../shared/logistics/contracts.ts';
import {errorMessage, isApiError} from '../api/client';
import {offersApi} from '../api/offers';
import {useActions} from '../common/actions';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Icon, Sheet} from '../ui';
import {
  draftKeyOf,
  emptyDraft,
  proposalInputOf,
  type ProposalDraft,
  type Problems,
} from '../supplier/draft';
import {ProposalForm} from '../supplier/ProposalForm';
import {openOrgId, sessionToken, storeProposal} from './data';

export const ManualProposalSheet: React.FC<{
  onClose: () => void;
  /** Renegotiating an offer, or answering a request. */
  offerId?: Uuid | null;
  requestId?: Uuid | null;
  companyName?: string;
  productName?: string;
}> = ({onClose, offerId, requestId, companyName, productName}) => {
  const {today} = useActions();
  const toast = useLogisticsStore(s => s.toast);
  const [draft, setDraft] = useState<ProposalDraft>(() => ({
    ...emptyDraft(companyName ?? '', productName ?? ''),
    origin: 'Por teléfono',
  }));
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<Problems | undefined>();
  const [failure, setFailure] = useState<string | null>(null);

  const send = async () => {
    const token = sessionToken();
    const orgId = openOrgId();
    if (!token || !orgId || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const proposal = await offersApi.recordProposal(token, {
        organizationId: orgId,
        offerId: offerId ?? null,
        requestId: requestId ?? null,
        origin: draft.origin.trim(),
        proposal: proposalInputOf(draft, today, {publicForm: false}),
      });
      storeProposal(proposal);
      toast(
        'Propuesta registrada: queda pendiente de un administrador',
        'success',
      );
      onClose();
    } catch (err) {
      if (isApiError(err) && err.fields) {
        const mapped: Problems = {};
        for (const [k, msg] of Object.entries(err.fields)) {
          mapped[draftKeyOf(k)] = msg;
        }
        setProblems(mapped);
      }
      setFailure(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      id="lx-manual-sheet"
      eyebrow="Propuestas recibidas"
      title="Registrar una recibida"
      size="tall"
    >
      {failure && (
        <p className="lx-notice lx-notice--error" role="alert">
          <Icon name="alert" size={18} />
          <span>{failure}</span>
        </p>
      )}
      <ProposalForm
        mode="manual"
        draft={draft}
        onDraft={setDraft}
        today={today}
        serverProblems={problems}
        busy={busy}
        onSend={() => void send()}
        onCancel={onClose}
        idPrefix="lx-mp"
        headingLevel={2}
      />
    </Sheet>
  );
};
