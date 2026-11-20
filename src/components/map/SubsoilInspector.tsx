import React from 'react';
import {cellAt, world} from '../../engine/cartography/geometry';
import {rotateWall, wallMetrics} from '../../engine/subsoil/heat';
import {useProjectStore} from '../../store/useProjectStore';
import type {
  SubsoilColumn,
  SubsoilPolygon,
  SubsoilWall,
} from '../../types';
import {
  type CollectionKey,
  copyItemsFromScene,
  deleteItemsFromScene,
  duplicateItemsInScene,
  findItemInScene,
} from './selectionActions';

export interface SubsoilInspectorProps {
  collection: 'subsoilColumns' | 'subsoilWalls' | 'subsoilPolygons';
  item: SubsoilColumn | SubsoilWall | SubsoilPolygon;
  onSceneChanged: () => void;
}

const num = (n: number): string =>
  Number(n).toLocaleString('es-ES', {maximumFractionDigits: 2});

const commitOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
  if (e.key === 'Enter') e.currentTarget.blur();
};

/**
 * Inspector especializado para columnas, muros de carga y polígonos del subsuelo.
 */
export const SubsoilInspector: React.FC<SubsoilInspectorProps> = ({
  collection,
  item,
  onSceneChanged,
}) => {
  const panel = useProjectStore((s) => s.panel);
  const grid = useProjectStore((s) => s.grid);
  const currentMap = useProjectStore((s) => s.currentMap);
  const setSelectedIds = useProjectStore((s) => s.setSelectedIds);
  const updateScene = useProjectStore((s) => s.updateScene);
  const showToast = useProjectStore((s) => s.showToast);

  const m = currentMap();

  const handleDuplicate = () => {
    let newIds: string[] = [];
    updateScene((scene) => {
      const res = duplicateItemsInScene(scene, [item.id], m, grid, panel);
      newIds = res.newIds;
    }, true);
    if (newIds.length) {
      setSelectedIds(newIds);
      onSceneChanged();
      showToast('Elemento de subsuelo duplicado');
    }
  };

  const handleDelete = () => {
    let deleted = 0;
    let locked = 0;
    updateScene((scene) => {
      const res = deleteItemsFromScene(scene, [item.id], panel);
      deleted = res.deletedIds.length;
      locked = res.lockedIds.length;
    }, true);
    if (deleted) {
      setSelectedIds([]);
      onSceneChanged();
    } else if (locked) {
      showToast('Elemento bloqueado: desactiva el bloqueo antes de eliminarlo');
    }
  };

  if (collection === 'subsoilColumns') {
    const col = item as SubsoilColumn;
    const coords = world([col.x, col.y], m);
    const updateCol = (patch: Partial<SubsoilColumn>) => {
      updateScene((sc) => {
        const target = sc.subsoil?.columns.find((c) => c.id === col.id);
        if (target) Object.assign(target, patch);
      }, true);
      onSceneChanged();
    };
    return (
      <>
        <span className="eyebrow">SUBSUELO · COLUMNA</span>
        <h3>{col.name}</h3>
        <label>
          Nombre
          <input
            id="edit-name"
            maxLength={100}
            key={`name-${col.id}-${col.name}`}
            defaultValue={col.name}
            onKeyDown={commitOnEnter}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== col.name) updateCol({name: v});
            }}
          />
        </label>
        <span className="cell-tag">CELDA {cellAt(coords, grid)}</span>
        <div className="two">
          <label>
            Diámetro (m)
            <input
              id="edit-col-diameter"
              type="number"
              min="0.2"
              max="20"
              step="0.1"
              key={`diam-${col.id}-${col.diameter}`}
              defaultValue={col.diameter}
              onKeyDown={commitOnEnter}
              onBlur={(e) => {
                const v = Number(e.target.value);
                if (!Number.isFinite(v) || v < 0.2 || v > 20) {
                  showToast('Diámetro válido: entre 0,2 y 20 m');
                  return;
                }
                if (v !== col.diameter) updateCol({diameter: v});
              }}
            />
          </label>
          <label>
            Radio de influencia (m)
            <input
              id="edit-col-influence"
              type="number"
              min="0.5"
              max="50"
              step="0.5"
              key={`inf-${col.id}-${col.influenceRadius}`}
              defaultValue={col.influenceRadius}
              onKeyDown={commitOnEnter}
              onBlur={(e) => {
                const v = Number(e.target.value);
                if (!Number.isFinite(v) || v < 0.5 || v > 50) {
                  showToast('Radio de influencia válido: entre 0,5 y 50 m');
                  return;
                }
                if (v !== col.influenceRadius) updateCol({influenceRadius: v});
              }}
            />
          </label>
        </div>
        <label className="check">
          <input
            type="checkbox"
            id="lock-subsoil"
            checked={!!col.locked}
            onChange={(e) => updateCol({locked: e.target.checked})}
          />{' '}
          Bloquear elemento
        </label>
        <button
          type="button"
          id="duplicate-object"
          className="duplicate quiet wide"
          style={{marginTop: '12px'}}
          onClick={handleDuplicate}
        >
          Duplicar columna
        </button>
        <button
          type="button"
          id="delete-object"
          className="danger quiet wide"
          style={{marginTop: '8px'}}
          onClick={handleDelete}
        >
          Eliminar columna
        </button>
      </>
    );
  }

  if (collection === 'subsoilWalls') {
    const wall = item as SubsoilWall;
    const metrics = wallMetrics(wall, m);
    const roundedAngle = Math.round(metrics.angleDeg);
    const updateWall = (patch: Partial<SubsoilWall>) => {
      updateScene((sc) => {
        const target = sc.subsoil?.walls.find((w) => w.id === wall.id);
        if (target) Object.assign(target, patch);
      }, true);
      onSceneChanged();
    };
    return (
      <>
        <span className="eyebrow">SUBSUELO · MURO DE CARGA</span>
        <h3>{wall.name}</h3>
        <label>
          Nombre
          <input
            id="edit-name"
            maxLength={100}
            key={`name-${wall.id}-${wall.name}`}
            defaultValue={wall.name}
            onKeyDown={commitOnEnter}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== wall.name) updateWall({name: v});
            }}
          />
        </label>
        <span className="cell-tag">
          Longitud {num(metrics.length)} m · CELDA{' '}
          {cellAt(metrics.midMeters, grid)}
        </span>
        <div className="two">
          <label>
            Grosor (m)
            <input
              id="edit-wall-thickness"
              type="number"
              min="0.1"
              max="10"
              step="0.05"
              key={`thk-${wall.id}-${wall.thickness}`}
              defaultValue={wall.thickness}
              onKeyDown={commitOnEnter}
              onBlur={(e) => {
                const v = Number(e.target.value);
                if (!Number.isFinite(v) || v < 0.1 || v > 10) {
                  showToast('Grosor válido: entre 0,1 y 10 m');
                  return;
                }
                if (v !== wall.thickness) updateWall({thickness: v});
              }}
            />
          </label>
          <label>
            Profundidad calor (m)
            <input
              id="edit-wall-influence"
              type="number"
              min="0.5"
              max="50"
              step="0.5"
              key={`winf-${wall.id}-${wall.influenceDepth}`}
              defaultValue={wall.influenceDepth}
              onKeyDown={commitOnEnter}
              onBlur={(e) => {
                const v = Number(e.target.value);
                if (!Number.isFinite(v) || v < 0.5 || v > 50) {
                  showToast('Profundidad válida: entre 0,5 y 50 m');
                  return;
                }
                if (v !== wall.influenceDepth) updateWall({influenceDepth: v});
              }}
            />
          </label>
        </div>
        <label>
          Rotación (°)
          <input
            id="edit-wall-rotation"
            type="number"
            min="-360"
            max="360"
            step="1"
            key={`wrot-${wall.id}-${roundedAngle}`}
            defaultValue={roundedAngle}
            onKeyDown={commitOnEnter}
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (!Number.isFinite(v) || v < -360 || v > 360) {
                showToast('Rotación válida: entre -360° y 360°');
                return;
              }
              const nextEndpoints = rotateWall(wall, v, m);
              updateWall(nextEndpoints);
            }}
          />
        </label>
        <p className="small-note">
          También puedes arrastrar los dos extremos del muro sobre el plano.
        </p>
        <label className="check">
          <input
            type="checkbox"
            id="lock-subsoil"
            checked={!!wall.locked}
            onChange={(e) => updateWall({locked: e.target.checked})}
          />{' '}
          Bloquear elemento
        </label>
        <button
          type="button"
          id="duplicate-object"
          className="duplicate quiet wide"
          style={{marginTop: '12px'}}
          onClick={handleDuplicate}
        >
          Duplicar muro
        </button>
        <button
          type="button"
          id="delete-object"
          className="danger quiet wide"
          style={{marginTop: '8px'}}
          onClick={handleDelete}
        >
          Eliminar muro
        </button>
      </>
    );
  }

  // SubsoilPolygon
  const poly = item as SubsoilPolygon;
  return (
    <>
      <span className="eyebrow">
        SUBSUELO · {poly.op === 'add' ? 'ÁREA (+)' : 'RESTA (−)'}
      </span>
      <h3>{poly.name || 'Polígono del subsuelo'}</h3>
      <span className="cell-tag">{poly.points.length} vértices</span>
      <label className="check">
        <input
          type="checkbox"
          id="lock-subsoil"
          checked={!!poly.locked}
          onChange={(e) => {
            const checked = e.target.checked;
            updateScene((sc) => {
              const p = sc.subsoil?.polygons.find((x) => x.id === poly.id);
              if (p) p.locked = checked;
            }, true);
            onSceneChanged();
          }}
        />{' '}
        Bloquear polígono
      </label>
      <button
        type="button"
        id="delete-object"
        className="danger quiet wide"
        style={{marginTop: '10px'}}
        onClick={handleDelete}
      >
        Eliminar polígono
      </button>
    </>
  );
};

const COLLECTION_LABELS: Record<CollectionKey, string> = {
  booths: 'Puestos',
  infrastructure: 'Infraestructura',
  entrances: 'Accesos',
  annotations: 'Observaciones',
  roadPlans: 'Propuestas viales',
  measurements: 'Mediciones',
  reserves: 'Zonas excluidas',
  flows: 'Recorridos',
  fences: 'Vallas',
  passages: 'Pasillos',
  subsoilColumns: 'Columnas (subsuelo)',
  subsoilWalls: 'Muros de carga (subsuelo)',
  subsoilPolygons: 'Perímetro (subsuelo)',
};

export interface MultiSelectionInspectorProps {
  selectedIds: string[];
  onSceneChanged: () => void;
}

/**
 * Vista de resumen y acciones comunes cuando hay varios elementos seleccionados.
 */
export const MultiSelectionInspector: React.FC<
  MultiSelectionInspectorProps
> = ({selectedIds, onSceneChanged}) => {
  const panel = useProjectStore((s) => s.panel);
  const grid = useProjectStore((s) => s.grid);
  const currentScene = useProjectStore((s) => s.currentScene);
  const currentMap = useProjectStore((s) => s.currentMap);
  const setSelectedIds = useProjectStore((s) => s.setSelectedIds);
  const setClipboard = useProjectStore((s) => s.setClipboard);
  const updateScene = useProjectStore((s) => s.updateScene);
  const showToast = useProjectStore((s) => s.showToast);

  const scene = currentScene();
  const map = currentMap();

  const counts = new Map<CollectionKey, number>();
  let lockedCount = 0;
  for (const id of selectedIds) {
    const found = findItemInScene(scene, id);
    if (!found) continue;
    counts.set(found.collection, (counts.get(found.collection) || 0) + 1);
    if (found.item.locked) lockedCount++;
  }

  const handleCopy = () => {
    const payload = copyItemsFromScene(scene, selectedIds);
    if (!payload.entries.length) return;
    setClipboard(payload);
    showToast(`${payload.entries.length} elementos copiados`);
  };

  const handleDuplicate = () => {
    let newIds: string[] = [];
    let skipped = 0;
    updateScene((sc) => {
      const res = duplicateItemsInScene(sc, selectedIds, map, grid, panel);
      newIds = res.newIds;
      skipped = res.skippedCatalogLimit;
    }, true);
    if (newIds.length) {
      setSelectedIds(newIds);
      onSceneChanged();
      showToast(
        skipped > 0
          ? `${newIds.length} duplicados · límite de 150 piezas alcanzado`
          : `${newIds.length} elementos duplicados`
      );
    } else if (skipped > 0) {
      showToast('Límite del prototipo: 150 elementos por espacio');
    }
  };

  const handleDelete = () => {
    let deleted = 0;
    let remainingLocked: string[] = [];
    updateScene((sc) => {
      const res = deleteItemsFromScene(sc, selectedIds, panel);
      deleted = res.deletedIds.length;
      remainingLocked = res.lockedIds;
    }, true);
    if (deleted > 0) {
      setSelectedIds(remainingLocked);
      onSceneChanged();
      showToast(
        remainingLocked.length
          ? `${deleted} eliminados · ${remainingLocked.length} bloqueados conservados`
          : `${deleted} elementos eliminados`
      );
    } else if (remainingLocked.length) {
      showToast('Todos los elementos seleccionados están bloqueados');
    }
  };

  return (
    <>
      <span className="eyebrow">SELECCIÓN MÚLTIPLE</span>
      <h3 id="multi-select-title">{selectedIds.length} elementos seleccionados</h3>
      <ul className="multi-select-summary">
        {[...counts.entries()].map(([col, n]) => (
          <li key={col}>
            <span>{COLLECTION_LABELS[col]}</span>
            <b>{n}</b>
          </li>
        ))}
      </ul>
      {lockedCount > 0 && (
        <p className="warning">
          {lockedCount}{' '}
          {lockedCount === 1
            ? 'elemento bloqueado (protegido al eliminar).'
            : 'elementos bloqueados (protegidos al eliminar).'}
        </p>
      )}
      <button
        type="button"
        id="copy-selection"
        className="quiet wide"
        style={{marginTop: '10px'}}
        onClick={handleCopy}
      >
        Copiar selección (Ctrl+C)
      </button>
      <button
        type="button"
        id="duplicate-object"
        className="duplicate quiet wide"
        style={{marginTop: '8px'}}
        onClick={handleDuplicate}
      >
        Duplicar selección
      </button>
      <button
        type="button"
        id="delete-object"
        className="danger quiet wide"
        style={{marginTop: '8px'}}
        onClick={handleDelete}
      >
        Eliminar selección (Supr)
      </button>
    </>
  );
};
