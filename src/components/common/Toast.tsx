import React from 'react';
import {useProjectStore} from '../../store/useProjectStore';

/**
 * Floating notification toast at the bottom-right of the screen.
 */
export const Toast: React.FC = () => {
  const toastMessage = useProjectStore((s) => s.toastMessage);
  const toastTone = useProjectStore((s) => s.toastTone);

  return (
    <div
      id="toast"
      className={toastTone === 'error' ? 'is-error' : ''}
      role={toastTone === 'error' ? 'alert' : 'status'}
      aria-live={toastTone === 'error' ? 'assertive' : 'polite'}
      hidden={!toastMessage}
    >
      {toastMessage || ''}
    </div>
  );
};
