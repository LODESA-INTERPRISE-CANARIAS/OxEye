import React from 'react';
import {useProjectStore} from '../../store/useProjectStore';

/**
 * Floating notification toast at the bottom-right of the screen.
 */
export const Toast: React.FC = () => {
  const toastMessage = useProjectStore((s) => s.toastMessage);

  return (
    <div id="toast" role="status" aria-live="polite" hidden={!toastMessage}>
      {toastMessage || ''}
    </div>
  );
};
