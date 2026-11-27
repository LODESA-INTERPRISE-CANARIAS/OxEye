/**
 * Organization card in the sidebar and the account sheet: its name and the
 * acronym that starts the name of every saved PDF («SCLL_…»). Tapping it
 * opens the «Organización» sheet. With several organizations, the Gestor's
 * own select chooses which one is open.
 */
import React from 'react';
import {acronymFor} from '../../../shared/logistics/acronym.ts';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Icon, SelectField} from '../ui';

export const OrgSelector: React.FC<{
  id?: string;
  /** Opens the «Organización» sheet. */
  onOpen?: () => void;
}> = ({id = 'lx-org-select', onOpen}) => {
  const organizations = useLogisticsStore(s => s.organizations);
  const orgId = useLogisticsStore(s => s.orgId);
  const selectOrg = useLogisticsStore(s => s.selectOrg);
  const current = organizations.find(o => o.id === orgId);
  const acronym = current ? acronymFor(current) : '';
  const proposed = !!current && !current.acronym?.trim();

  const acronymLine = acronym && (
    <span className="lx-org__acronym">
      Siglas <strong className="lx-num">{acronym}</strong>
      {proposed && <span className="lx-muted"> · propuesta</span>}
    </span>
  );

  if (organizations.length <= 1) {
    if (!onOpen || !current) {
      return (
        <div className="lx-org" id={id}>
          <span className="lx-org__label">Organización</span>
          <span className="lx-org__name">
            {current?.name ?? 'Sin organización'}
          </span>
          {acronymLine}
        </div>
      );
    }
    return (
      <button
        type="button"
        className="lx-org lx-org--button"
        id={id}
        aria-haspopup="dialog"
        onClick={onOpen}
      >
        <span className="lx-org__label">Organización</span>
        <span className="lx-org__name">{current.name}</span>
        {acronymLine}
        <Icon name="chevronRight" size={16} className="lx-org__chevron" />
      </button>
    );
  }

  return (
    <div className="lx-org lx-org--select">
      <span className="lx-org__label" id={`${id}-label`}>
        Organización
      </span>
      <SelectField
        id={id}
        className="lx-org__selectfield"
        aria-label="Organización"
        value={orgId ?? ''}
        onChange={selectOrg}
        options={organizations.map(o => ({value: o.id, label: o.name}))}
      />
      {onOpen && current && (
        <button
          type="button"
          className="lx-org__more"
          id={`${id}-open`}
          aria-haspopup="dialog"
          onClick={onOpen}
        >
          {acronymLine}
          <Icon name="chevronRight" size={16} />
        </button>
      )}
    </div>
  );
};
