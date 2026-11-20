import React from 'react';
import {useProjectStore} from '../../store/useProjectStore';

/**
 * Bottom attribution bar displaying OpenStreetMap and PNOA–IGN credits and opening the info modal.
 */
export const SourceBar: React.FC = () => {
  const setActiveModal = useProjectStore((s) => s.setActiveModal);

  return (
    <footer className="source-bar">
      <span>
        Cartografía: © OpenStreetMap contributors · ODbL / Ortofoto: PNOA–IGN · CC
        BY 4.0
      </span>
      <button
        id="sources"
        type="button"
        onClick={() => setActiveModal('info')}
      >
        Fuentes y precisión ↗
      </button>
    </footer>
  );
};
