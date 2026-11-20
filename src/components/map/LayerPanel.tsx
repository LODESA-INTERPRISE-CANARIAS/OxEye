import React from 'react';
import {useProjectStore} from '../../store/useProjectStore';

/**
 * Floating layer visibility and grid step panel (`#layer-panel`).
 */
export const LayerPanel: React.FC = () => {
  const layerPanelOpen = useProjectStore((s) => s.layerPanelOpen);
  const gridVisible = useProjectStore((s) => s.gridVisible);
  const grid = useProjectStore((s) => s.grid);
  const labelsVisible = useProjectStore((s) => s.labelsVisible);
  const routesVisible = useProjectStore((s) => s.routesVisible);
  const setGridVisible = useProjectStore((s) => s.setGridVisible);
  const setGrid = useProjectStore((s) => s.setGrid);
  const setLabelsVisible = useProjectStore((s) => s.setLabelsVisible);
  const setRoutesVisible = useProjectStore((s) => s.setRoutesVisible);

  return (
    <div id="layer-panel" className="layer-panel" hidden={!layerPanelOpen}>
      <span className="eyebrow">CAPAS</span>
      <label className="check">
        <input
          id="grid-visible"
          type="checkbox"
          checked={gridVisible}
          onChange={(e) => setGridVisible(e.target.checked)}
        />{' '}
        Cuadrícula de referencia
      </label>
      <label className="form-label">
        Paso de cuadrícula
        <select
          id="grid-step"
          value={grid}
          onChange={(e) => setGrid(Number(e.target.value))}
        >
          <option value="5">5 × 5 m</option>
          <option value="10">10 × 10 m</option>
          <option value="20">20 × 20 m</option>
        </select>
      </label>
      <label className="check">
        <input
          id="labels-visible"
          type="checkbox"
          checked={labelsVisible}
          onChange={(e) => setLabelsVisible(e.target.checked)}
        />{' '}
        Nombres de calles
      </label>
      <label className="check">
        <input
          id="routes-visible"
          type="checkbox"
          checked={routesVisible}
          onChange={(e) => setRoutesVisible(e.target.checked)}
        />{' '}
        Recorridos orientativos
      </label>
    </div>
  );
};
