import React from 'react';
import {VENUES} from '../../data/catalog';
import {useProjectStore} from '../../store/useProjectStore';

/**
 * Top workspace bar showing the active venue title, base layer toggle (`Plano` / `Ortofoto`),
 * and Layers button (`☷ Capas`), matching the original prototype structure.
 */
export const WorkspaceBar: React.FC = () => {
  const activeVenue = useProjectStore((s) => s.activeVenue);
  const base = useProjectStore((s) => s.base);
  const layerPanelOpen = useProjectStore((s) => s.layerPanelOpen);
  const setBase = useProjectStore((s) => s.setBase);
  const setLayerPanelOpen = useProjectStore((s) => s.setLayerPanelOpen);

  return (
    <div className="workspace-bar">
      <div>
        <b id="place-title">{VENUES[activeVenue].name}</b>
        <span id="place-sub">{VENUES[activeVenue].tag}</span>
      </div>
      <div className="segmented" aria-label="Base cartográfica">
        <button
          type="button"
          className={base === 'plan' ? 'active' : ''}
          data-base="plan"
          onClick={() => setBase('plan')}
        >
          Plano
        </button>
        <button
          type="button"
          className={base === 'ortho' ? 'active' : ''}
          data-base="ortho"
          onClick={() => setBase('ortho')}
        >
          Ortofoto
        </button>
      </div>
      <button
        id="layers"
        className="quiet"
        type="button"
        aria-expanded={layerPanelOpen}
        onClick={() => setLayerPanelOpen(!layerPanelOpen)}
      >
        ☷ Capas
      </button>
    </div>
  );
};
