/**
 * Who signed a change (safety audit, Revisión 1 · E4/E5): «Dailos», or
 * «Dailos (soporte: Elvis)» when an administrator made it in a support
 * session on Dailos's account. The text is `signatureLabel` (history.ts), so
 * screens, exports and tests read the same words; the support part is set
 * apart visually and explained on hover.
 */
import React from 'react';
import {signatureLabel} from '../../../shared/logistics/history.ts';

export interface SignatureProps {
  user: {displayName: string};
  supportBy?: {displayName: string} | null;
  /** The name in bold, as in feeds; plain inside a muted line. */
  strong?: boolean;
}

export const Signature: React.FC<SignatureProps> = ({
  user,
  supportBy,
  strong = true,
}) => {
  const name = strong ? (
    <strong>{user.displayName}</strong>
  ) : (
    <span>{user.displayName}</span>
  );
  if (!supportBy) return name;
  return (
    <span
      className="lx-signature"
      data-support="true"
      title={`${signatureLabel(user, supportBy)}: ${supportBy.displayName} lo hizo en una sesión de soporte en la cuenta de ${user.displayName}.`}
    >
      {name}{' '}
      <span className="lx-signature__support">
        (soporte: {supportBy.displayName})
      </span>
    </span>
  );
};
