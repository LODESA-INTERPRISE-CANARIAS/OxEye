/**
 * Organization selector. A static card when the user belongs to a single
 * organization; a native select (keyboard and screen-reader friendly)
 * otherwise.
 */
import React from 'react';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Icon} from '../ui';

export const OrgSelector: React.FC<{id?: string}> = ({
  id = 'lx-org-select',
}) => {
  const organizations = useLogisticsStore(s => s.organizations);
  const orgId = useLogisticsStore(s => s.orgId);
  const selectOrg = useLogisticsStore(s => s.selectOrg);
  const current = organizations.find(o => o.id === orgId);

  if (organizations.length <= 1) {
    return (
      <div className="lx-org" id={id}>
        <span className="lx-org__label">Organización</span>
        <span className="lx-org__name">
          {current?.name ?? 'Sin organización'}
        </span>
      </div>
    );
  }

  return (
    <div className="lx-org lx-org--select">
      <label className="lx-org__label" htmlFor={id}>
        Organización
      </label>
      <select
        id={id}
        className="lx-org__select"
        value={orgId ?? ''}
        onChange={e => selectOrg(e.target.value)}
      >
        {organizations.map(o => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      <Icon name="chevronDown" size={16} className="lx-org__chevron" />
    </div>
  );
};
