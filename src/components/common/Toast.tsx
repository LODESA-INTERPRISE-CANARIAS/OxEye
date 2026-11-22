import React from 'react';
import {useProjectStore} from '../../store/useProjectStore';

/**
 * Floating notification toast with contextual diagnostic details and optional "Localizar en el mapa" action.
 */
export const Toast: React.FC = () => {
  const toastMessage = useProjectStore((s) => s.toastMessage);
  const toastTone = useProjectStore((s) => s.toastTone);
  const toastAction = useProjectStore((s) => s.toastAction);
  const locateOnMap = useProjectStore((s) => s.locateOnMap);
  const clearToast = useProjectStore((s) => s.clearToast);

  const hasLocate = !!(toastAction?.targetId || toastAction?.targetPoint);

  return (
    <div
      id="toast"
      className={`${toastTone === 'error' ? 'is-error' : ''} ${hasLocate ? 'has-action' : ''}`.trim()}
      role={toastTone === 'error' ? 'alert' : 'status'}
      aria-live={toastTone === 'error' ? 'assertive' : 'polite'}
      hidden={!toastMessage}
    >
      <span className="toast-text">{toastMessage || ''}</span>
      {hasLocate && toastAction && (
        <button
          type="button"
          id="toast-locate-btn"
          className="toast-locate-btn"
          onClick={() => {
            locateOnMap({
              id: toastAction.targetId,
              point: toastAction.targetPoint,
              panel: toastAction.panel || 'design',
              enableXray: toastAction.enableXray,
            });
            clearToast();
          }}
        >
          {toastAction.label || 'Localizar en el mapa'}
        </button>
      )}
      {hasLocate && (
        <button
          type="button"
          className="toast-dismiss-btn"
          aria-label="Cerrar aviso"
          onClick={clearToast}
        >
          ×
        </button>
      )}
    </div>
  );
};
