import React from 'react';
import {VENUES} from '../../data/catalog';
import {useProjectStore} from '../../store/useProjectStore';

/**
 * Top workspace bar showing the active venue title, base layer toggle (`Plano` / `Ortofoto`),
 * and Layers button (`☷ Capas`), matching the original prototype structure.
 */
export const WorkspaceBar: React.FC = () => {
  const activeVenue = useProjectStore((s) => s.activeVenue);
  const currentScene = useProjectStore((s) => s.currentScene);
  const currentMap = useProjectStore((s) => s.currentMap);
  const revision = useProjectStore((s) => s.revision);
  const base = useProjectStore((s) => s.base);
  const layerPanelOpen = useProjectStore((s) => s.layerPanelOpen);
  const lastEvaluationModal = useProjectStore((s) => s.lastEvaluationModal);
  const setBase = useProjectStore((s) => s.setBase);
  const setLayerPanelOpen = useProjectStore((s) => s.setLayerPanelOpen);
  const setActiveModal = useProjectStore((s) => s.setActiveModal);

  void revision;
  const s = currentScene();
  const m = currentMap();
  const customLoc = m.customLocation;
  const returnModal =
    lastEvaluationModal || (s.lastAudit ? 'comparison' : null);

  return (
    <div className="workspace-bar">
      <div>
        <b id="place-title">
          {customLoc ? customLoc.label : VENUES[activeVenue].name}
        </b>
        <span id="place-sub">
          {customLoc
            ? `${customLoc.sizeMeters} × ${customLoc.sizeMeters} m · área cuadrada personalizada`
            : VENUES[activeVenue].tag}
        </span>
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
      {returnModal && (
        <button
          id="return-last-evaluation"
          className="quiet"
          type="button"
          title="Volver a la última evaluación para revisar fallos o adaptar correcciones"
          onClick={() => setActiveModal(returnModal)}
        >
          ↩ Última evaluación
        </button>
      )}
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
