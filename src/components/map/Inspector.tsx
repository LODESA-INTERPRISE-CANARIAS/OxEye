import React, {useEffect, useState} from 'react';
import {cellAt, inside, world} from '../../engine/cartography/geometry';
import {
  fenceChainAnchors,
  fenceMetrics,
  rotateFenceChainByAngle,
  updateFenceGeometry,
} from '../../engine/cartography/fences';
import {
  normalizeAccessFlows,
  snapPointToPerimeter,
} from '../../engine/cartography/spawns';
import {membership, phases} from '../../engine/logistics/phases';
import {
  rotateItemsRigid,
  snapshotGroupTransform,
} from '../../engine/cartography/groups';
import {
  addBallastSubcomponentsToCover,
  coverSubcomponentBallastIds,
  effectiveSupportAreaM2,
  evaluateCoverBallast,
  HEAVY_LOAD_THRESHOLD_KG_M2,
  meetsHeavyLoadThreshold,
  surfaceLoadKgM2,
} from '../../engine/planning/ballast';
import {
  evaluateItemSubsoilHeat,
  isHeavyLoadItem,
} from '../../engine/subsoil/heat';
import {useProjectStore} from '../../store/useProjectStore';
import type {
  Annotation,
  AuthorityAccessUnit,
  Booth,
  Entrance,
  Infrastructure,
  PhaseKey,
  SpawnKind,
  SubsoilColumn,
  SubsoilPolygon,
  SubsoilWall,
} from '../../types';
import {
  deleteItemsFromScene,
  duplicateItemsInScene,
  findItemInScene,
} from './selectionActions';
import {MultiSelectionInspector, SubsoilInspector} from './SubsoilInspector';

const AUTHORITY_UNITS: Array<{key: AuthorityAccessUnit; label: string}> = [
  {key: 'foot', label: 'Unidades a pie'},
  {
    key: 'light_stretchers',
    label: 'Unidades motorizadas ligeras y camillas',
  },
  {key: 'passenger_vehicles', label: 'Vehículos turismo'},
  {key: 'heavy_trucks', label: 'Camiones y vehículos pesados'},
];

export interface InspectorProps {
  onSceneChanged: () => void;
  onClearProposal: () => void;
}

const num = (n: number): string =>
  Number(n).toLocaleString('es-ES', {maximumFractionDigits: 1});

/**
 * Floating right-side inspector panel (`#inspector`) for editing the selected
 * booth, infrastructure, gate, polygon/polyline, or review annotation.
 */
export const Inspector: React.FC<InspectorProps> = ({
  onSceneChanged,
  onClearProposal,
}) => {
  const selectedIds = useProjectStore((s) => s.selectedIds);
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null;
  const panel = useProjectStore((s) => s.panel);
  const phase = useProjectStore((s) => s.phase);
  const grid = useProjectStore((s) => s.grid);
  const currentScene = useProjectStore((s) => s.currentScene);
  const currentMap = useProjectStore((s) => s.currentMap);
  const revision = useProjectStore((s) => s.revision);
  const setSelectedId = useProjectStore((s) => s.setSelectedId);
  const setSelectedIds = useProjectStore((s) => s.setSelectedIds);
  const updateScene = useProjectStore((s) => s.updateScene);
  const showToast = useProjectStore((s) => s.showToast);

  void revision;
  const s = currentScene();
  const m = currentMap();

  const subsoilHit =
    selectedId !== null ? findItemInScene(s, selectedId) : null;
  const isSubsoilSingle =
    subsoilHit !== null &&
    (subsoilHit.collection === 'subsoilColumns' ||
      subsoilHit.collection === 'subsoilWalls' ||
      subsoilHit.collection === 'subsoilPolygons');

  const allObjects = [
    ...s.base.booths,
    ...s.infrastructure,
    ...s.entrances,
  ];
  const found = isSubsoilSingle
    ? null
    : allObjects.find((o) => o.id === selectedId) ||
      s.annotations.find((o) => o.id === selectedId) ||
      s.roadPlans.find((o) => o.id === selectedId) ||
      s.measurements.find((o) => o.id === selectedId) ||
      (s.flows || []).find((o) => o.id === selectedId) ||
      s.reserves.find((o) => o.id === selectedId) ||
      (s.fences || []).find((o) => o.id === selectedId) ||
      (s.passages || []).find((o) => o.id === selectedId) ||
      null;

  const isNote = found
    ? s.annotations.some((a) => a.id === found.id)
    : false;
  const isArea = found ? s.reserves.some((r) => r.id === found.id) : false;
  const isLine = found ? 'points' in found && Array.isArray(found.points) : false;
  const isBooth = found
    ? s.base.booths.some((b) => b.id === found.id)
    : false;
  const isEntrance = found
    ? s.entrances.some((e) => e.id === found.id)
    : false;
  const isFence = found
    ? (s.fences || []).some((f) => f.id === found.id)
    : false;

  const [noteText, setNoteText] = useState('');

  useEffect(() => {
    if (found && isNote) {
      setNoteText((found as Annotation).text || '');
    }
  }, [found, isNote, selectedId]);

  if (panel === 'simulate' || !selectedIds.length) {
    return <aside id="inspector" className="float-panel inspector" hidden />;
  }

  if (selectedIds.length > 1) {
    return (
      <aside
        id="inspector"
        className="float-panel inspector"
        onKeyDown={(e) => {
          if (e.key === 'Escape') setSelectedIds([]);
        }}
      >
        <button
          type="button"
          className="close"
          id="close-inspector"
          aria-label="Cerrar selección"
          onClick={() => setSelectedIds([])}
        >
          ×
        </button>
        <MultiSelectionInspector
          selectedIds={selectedIds}
          onSceneChanged={onSceneChanged}
        />
      </aside>
    );
  }

  if (isSubsoilSingle && subsoilHit) {
    return (
      <aside
        id="inspector"
        className="float-panel inspector"
        onKeyDown={(e) => {
          if (e.key === 'Escape') setSelectedIds([]);
        }}
      >
        <button
          type="button"
          className="close"
          id="close-inspector"
          aria-label="Cerrar selección"
          onClick={() => setSelectedIds([])}
        >
          ×
        </button>
        <SubsoilInspector
          collection={
            subsoilHit.collection as
              | 'subsoilColumns'
              | 'subsoilWalls'
              | 'subsoilPolygons'
          }
          item={
            subsoilHit.item as SubsoilColumn | SubsoilWall | SubsoilPolygon
          }
          onSceneChanged={onSceneChanged}
        />
      </aside>
    );
  }

  if (!found) {
    return <aside id="inspector" className="float-panel inspector" hidden />;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const item = found as any;
  const isLocked = !!item.locked;
  const currentTags = membership(
    item,
    isArea ? (Object.keys(phases) as PhaseKey[]) : ['event']
  );
  const coords = !isLine && !isNote ? world([item.x, item.y], m) : [0, 0];

  const handleToggleLock = (checked: boolean) => {
    updateScene((scene) => {
      const target = [
        ...scene.base.booths,
        ...scene.infrastructure,
        ...scene.entrances,
        ...scene.annotations,
        ...scene.roadPlans,
        ...scene.measurements,
        ...(scene.flows || []),
        ...scene.reserves,
        ...(scene.fences || []),
        ...(scene.passages || []),
      ].find((o) => o.id === item.id) as unknown as
        | Record<string, unknown>
        | undefined;
      if (target) target.locked = checked;
    }, true);
    if (isBooth) onClearProposal();
    onSceneChanged();
  };

  const handlePropertyChange = (prop: string, rawValue: string) => {
    const val = prop === 'name' ? rawValue : Number(rawValue);
    if (
      prop !== 'name' &&
      (!Number.isFinite(val) ||
        (['width', 'depth'].includes(prop) &&
          (Number(val) < 0.2 || Number(val) > 100)) ||
        (prop === 'x' && (Number(val) < 0 || Number(val) > m.widthMeters)) ||
        (prop === 'y' && (Number(val) < 0 || Number(val) > m.heightMeters)))
    ) {
      showToast('Valor fuera del intervalo del plano');
      return;
    }
    updateScene((scene) => {
      const target = [
        ...scene.base.booths,
        ...scene.infrastructure,
        ...scene.entrances,
        ...scene.annotations,
        ...scene.roadPlans,
        ...scene.measurements,
        ...(scene.flows || []),
        ...scene.reserves,
        ...(scene.fences || []),
        ...(scene.passages || []),
      ].find((o) => o.id === item.id) as unknown as
        | Record<string, unknown>
        | undefined;
      if (!target) return;
      let v: string | number = val;
      if (prop === 'x') v = (Number(val) / m.widthMeters) * 100;
      if (prop === 'y') v = (Number(val) / m.heightMeters) * 100;
      const prevArea =
        typeof target.width === 'number' && typeof target.depth === 'number'
          ? target.width * target.depth
          : 0;
      const prevRotation = Number(target.rotation) || 0;
      target[prop] = v;
      if (prop === 'rotation' && target.role === 'cover') {
        const subIds = coverSubcomponentBallastIds(scene, String(target.id));
        if (subIds.length) {
          const snaps = snapshotGroupTransform(scene, subIds);
          const deltaDeg = (Number(v) || 0) - prevRotation;
          rotateItemsRigid(
            scene,
            subIds,
            snaps,
            world([Number(target.x), Number(target.y)], m),
            deltaDeg,
            m
          );
        }
      }
      if (
        isEntrance &&
        (prop === 'x' || prop === 'y') &&
        scene.boundary.length >= 3
      ) {
        const entX = Number(target.x);
        const entY = Number(target.y);
        const snap = snapPointToPerimeter(world([entX, entY], m), scene, m);
        if (snap) {
          target.x = snap.percentPoint[0];
          target.y = snap.percentPoint[1];
          target.gateAngle = snap.gateAngle;
        }
      }
      if (typeof target.width === 'number' && typeof target.depth === 'number') {
        const nextArea = target.width * target.depth;
        target.area = nextArea;
        if (
          target.kind === 'ballast' &&
          (prop === 'width' || prop === 'depth')
        ) {
          const curSupport = Number(target.supportAreaM2);
          if (
            !Number.isFinite(curSupport) ||
            curSupport <= 0 ||
            Math.abs(curSupport - prevArea) < 0.01
          ) {
            target.supportAreaM2 = Math.round(nextArea * 100) / 100;
          }
          target.heavyLoad = meetsHeavyLoadThreshold(target);
        }
      }
    }, true);
    onSceneChanged();
  };

  const handlePhaseTagToggle = (tagKey: PhaseKey, checked: boolean) => {
    const nextTags = checked
      ? [...new Set([...currentTags, tagKey])]
      : currentTags.filter((t) => t !== tagKey);
    if (!nextTags.length) {
      showToast('Selecciona al menos una fase.');
      return;
    }
    updateScene((scene) => {
      const target = [
        ...scene.base.booths,
        ...scene.infrastructure,
        ...scene.entrances,
        ...scene.annotations,
        ...scene.roadPlans,
        ...scene.measurements,
        ...(scene.flows || []),
        ...scene.reserves,
        ...(scene.fences || []),
        ...(scene.passages || []),
      ].find((o) => o.id === item.id);
      if (target) target.phaseTags = nextTags;
    }, true);
    if (phase !== 'all' && !nextTags.includes(phase)) {
      setSelectedId(null);
    }
    onSceneChanged();
  };

  const handleDuplicate = () => {
    let newIds: string[] = [];
    let skippedLimit = 0;
    updateScene((scene) => {
      const res = duplicateItemsInScene(scene, [item.id], m, grid, panel);
      newIds = res.newIds;
      skippedLimit = res.skippedCatalogLimit;
    }, true);
    if (skippedLimit > 0) {
      showToast('Límite del prototipo: 150 elementos por espacio');
      return;
    }
    if (newIds.length) {
      setSelectedIds(newIds);
      onSceneChanged();
      showToast(isNote ? 'Observación duplicada' : 'Elemento duplicado');
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
    if (deleted > 0) {
      setSelectedIds([]);
      onSceneChanged();
    } else if (locked > 0) {
      showToast('Elemento bloqueado: desactiva el bloqueo antes de eliminarlo');
    }
  };

  const commitOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    }
  };

  return (
    <aside
      id="inspector"
      className="float-panel inspector"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          setSelectedId(null);
        }
      }}
    >
      <button
        type="button"
        className="close"
        id="close-inspector"
        aria-label="Cerrar selección"
        onClick={() => setSelectedId(null)}
      >
        ×
      </button>
      <span className="eyebrow">
        {isNote ? 'OBSERVACIÓN' : 'ELEMENTO SELECCIONADO'}
      </span>
      <h3>{isNote ? 'Revisión del plano' : item.name}</h3>

      {isNote ? (
        <>
          <span className="cell-tag">
            {(item as Annotation).cell} · malla {(item as Annotation).grid} m
          </span>
          <label>
            Observación
            <textarea
              id="note-text"
              rows={5}
              maxLength={2000}
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
            />
          </label>
          <button
            type="button"
            id="save-note"
            className="dark wide"
            onClick={() => {
              updateScene((scene) => {
                const target = scene.annotations.find((a) => a.id === item.id);
                if (target) target.text = noteText.trim();
              }, true);
              showToast('Observación guardada en ' + (item as Annotation).cell);
            }}
          >
            Guardar observación
          </button>
        </>
      ) : (
        <>
          <label>
            Nombre
            <input
              id="edit-name"
              maxLength={100}
              key={`name-${item.id}-${item.name}`}
              defaultValue={item.name}
              onKeyDown={commitOnEnter}
              onBlur={(e) => {
                if (e.target.value !== item.name) {
                  handlePropertyChange('name', e.target.value);
                }
              }}
            />
          </label>

          {!isLine ? (
            <>
              <span className="cell-tag">
                CELDA {cellAt([coords[0], coords[1]], grid)}
              </span>
              <details className="coordinate-details">
                <summary>Ajustar la posición con medidas</summary>
                <div className="two">
                  <label>
                    Este local (m)
                    <input
                      id="edit-x"
                      type="number"
                      step="0.1"
                      disabled={isLocked}
                      key={`x-${item.id}-${coords[0].toFixed(2)}`}
                      defaultValue={coords[0].toFixed(2)}
                      onKeyDown={commitOnEnter}
                      onBlur={(e) => handlePropertyChange('x', e.target.value)}
                    />
                  </label>
                  <label>
                    Sur local (m)
                    <input
                      id="edit-y"
                      type="number"
                      step="0.1"
                      disabled={isLocked}
                      key={`y-${item.id}-${coords[1].toFixed(2)}`}
                      defaultValue={coords[1].toFixed(2)}
                      onKeyDown={commitOnEnter}
                      onBlur={(e) => handlePropertyChange('y', e.target.value)}
                    />
                  </label>
                </div>
                <p>
                  UTM E {num(m.bbox[0] + coords[0])}
                  <br />
                  UTM N {num(m.bbox[3] - coords[1])}
                </p>
              </details>

              {!isEntrance ? (
                (item as Infrastructure).kind === 'security' ? (
                  <p className="small-note" id="security-particle-size-note">
                    Escala de persona a pie (mismo diámetro que el resto de
                    partículas: {num(s.diameter || 0.5)} m).
                  </p>
                ) : (
                  <>
                    <div className="two">
                      <label>
                        Anchura (m)
                        <input
                          id="edit-width"
                          type="number"
                          min="0.2"
                          max="100"
                          step="0.1"
                          key={`w-${item.id}-${item.width}`}
                          defaultValue={
                            item.width || Math.sqrt(item.area || 24)
                          }
                          onKeyDown={commitOnEnter}
                          onBlur={(e) =>
                            handlePropertyChange('width', e.target.value)
                          }
                        />
                      </label>
                      <label>
                        Fondo (m)
                        <input
                          id="edit-depth"
                          type="number"
                          min="0.2"
                          max="100"
                          step="0.1"
                          key={`d-${item.id}-${item.depth}`}
                          defaultValue={
                            item.depth || Math.sqrt(item.area || 24)
                          }
                          onKeyDown={commitOnEnter}
                          onBlur={(e) =>
                            handlePropertyChange('depth', e.target.value)
                          }
                        />
                      </label>
                    </div>
                    <label>
                      Giro (°)
                      <input
                        id="edit-rotation"
                        type="number"
                        step="1"
                        min="-360"
                        max="360"
                        key={`rot-${item.id}-${item.rotation || 0}`}
                        defaultValue={item.rotation || 0}
                        onKeyDown={commitOnEnter}
                        onBlur={(e) =>
                          handlePropertyChange('rotation', e.target.value)
                        }
                      />
                    </label>
                  </>
                )
              ) : (
                <>
                  <label>
                    Anchura libre del acceso (m)
                    <input
                      id="edit-clearWidth"
                      type="number"
                      min="0.5"
                      max="100"
                      step="0.1"
                      key={`cw-${item.id}-${(item as Entrance).clearWidth || 4}`}
                      defaultValue={(item as Entrance).clearWidth || 4}
                      onKeyDown={commitOnEnter}
                      onBlur={(e) =>
                        handlePropertyChange('clearWidth', e.target.value)
                      }
                    />
                  </label>
                  <label>
                    Orientación de la línea (grados)
                    <input
                      id="edit-gateAngle"
                      type="number"
                      min="-360"
                      max="360"
                      key={`ga-${item.id}-${(item as Entrance).gateAngle || 0}`}
                      defaultValue={(item as Entrance).gateAngle || 0}
                      onKeyDown={commitOnEnter}
                      onBlur={(e) =>
                        handlePropertyChange('gateAngle', e.target.value)
                      }
                    />
                  </label>
                  <p className="small-note" style={{margin: '4px 0 8px'}}>
                    Acceso acoplado al borde del perímetro: la dirección de las
                    flechas de entrada y salida se orienta automáticamente según
                    el interior y exterior del recinto.
                  </p>
                  <label>
                    Uso del acceso
                    <select
                      id="edit-gate"
                      value={(() => {
                        const raw =
                          (item as Entrance).phases?.event ||
                          (item as Entrance).role ||
                          'both';
                        return raw === 'emergency' ? 'free' : raw;
                      })()}
                      onChange={(e) => {
                        const val = e.target.value as Entrance['role'];
                        updateScene((scene) => {
                          const g = scene.entrances.find(
                            (en) => en.id === item.id
                          );
                          if (g) {
                            g.phases = {...g.phases, event: val || 'both'};
                            g.role = val;
                          }
                        }, true);
                        onSceneChanged();
                      }}
                    >
                      <option value="out">Solo salida</option>
                      <option value="in">Solo entrada</option>
                      <option value="both">Entrada y salida</option>
                      <option value="free">Acceso libre</option>
                    </select>
                  </label>
                  {(() => {
                    const ent = item as Entrance;
                    const flowList = normalizeAccessFlows(
                      s.entrances,
                      s.base.arrivals
                    );
                    const fm = flowList.find((x) => x.id === ent.id);
                    const spawnType: SpawnKind = ent.spawnType || 'pedestrian';
                    const entryW = Number.isFinite(ent.entryWeight)
                      ? Number(ent.entryWeight)
                      : Math.round(fm?.entrySharePct ?? 25);
                    const exitW = Number.isFinite(ent.exitWeight)
                      ? Number(ent.exitWeight)
                      : Math.round(fm?.exitSharePct ?? 25);
                    const maxRate = Math.max(
                      0,
                      Number(ent.maxRatePerHour) || 0
                    );
                    const updateEntrance = (patch: Partial<Entrance>) => {
                      updateScene((scene) => {
                        const g = scene.entrances.find(
                          (en) => en.id === ent.id
                        );
                        if (g) Object.assign(g, patch);
                      }, true);
                      onSceneChanged();
                    };
                    return (
                      <div className="spawn-flow-card" id="spawn-flow-card">
                        <div className="spawn-flow-head">
                          <b>Flujo de entrada y salida (Spawn)</b>
                          {ent.streetName && (
                            <span className="spawn-street-chip">
                              {ent.streetName}
                            </span>
                          )}
                        </div>
                        <label>
                          Tipo de infraestructura / tráfico
                          <select
                            id="edit-spawnType"
                            value={spawnType}
                            onChange={(e) =>
                              updateEntrance({
                                spawnType: e.target.value as SpawnKind,
                              })
                            }
                          >
                            <option value="pedestrian">
                              Peatonal (acceso a pie)
                            </option>
                            <option value="vehicle">
                              Vehicular (calle / vía de circulación)
                            </option>
                            <option value="mixed">
                              Mixto (peatones y vehículos)
                            </option>
                          </select>
                        </label>
                        <div className="spawn-flow-slider-group">
                          <div className="spawn-flow-slider-head">
                            <span>Flujo de entrada</span>
                            <b id="readout-entry-share">
                              {fm ? Math.round(fm.entrySharePct) : 0} % del
                              total
                            </b>
                          </div>
                          <input
                            id="edit-entryWeight"
                            type="range"
                            min="0"
                            max="100"
                            step="1"
                            value={entryW}
                            disabled={!fm?.canEnter}
                            onChange={(e) =>
                              updateEntrance({
                                entryWeight: Number(e.target.value),
                              })
                            }
                          />
                          <div className="spawn-flow-bar">
                            <span
                              style={{
                                width: `${Math.min(100, fm?.entrySharePct || 0)}%`,
                              }}
                            />
                          </div>
                        </div>
                        <div className="spawn-flow-slider-group">
                          <div className="spawn-flow-slider-head">
                            <span>Flujo de salida</span>
                            <b id="readout-exit-share">
                              {fm ? Math.round(fm.exitSharePct) : 0} % del total
                            </b>
                          </div>
                          <input
                            id="edit-exitWeight"
                            type="range"
                            min="0"
                            max="100"
                            step="1"
                            value={exitW}
                            disabled={!fm?.canExit}
                            onChange={(e) =>
                              updateEntrance({
                                exitWeight: Number(e.target.value),
                              })
                            }
                          />
                          <div className="spawn-flow-bar is-exit">
                            <span
                              style={{
                                width: `${Math.min(100, fm?.exitSharePct || 0)}%`,
                              }}
                            />
                          </div>
                        </div>
                        <label>
                          Volumen máximo de tránsito (pers/h · 0 = sin tope)
                          <input
                            id="edit-maxRatePerHour"
                            type="number"
                            min="0"
                            max="10000"
                            step="10"
                            key={`mrh-${ent.id}-${maxRate}`}
                            defaultValue={maxRate}
                            onKeyDown={commitOnEnter}
                            onBlur={(e) => {
                              const v = Math.max(
                                0,
                                Math.min(10000, Number(e.target.value) || 0)
                              );
                              updateEntrance({maxRatePerHour: v});
                            }}
                          />
                        </label>
                        {fm && (
                          <div className="spawn-flow-stats">
                            <div>
                              <span>Volumen estimado</span>
                              <b id="readout-entry-volume">
                                {Math.round(fm.effectiveArrivalsPerHour)} pers/h
                              </b>
                            </div>
                            <div>
                              <span>Frecuencia media</span>
                              <b id="readout-entry-freq">
                                {Number.isFinite(fm.frequencySec)
                                  ? fm.frequencySec >= 60
                                    ? `1 cada ${(fm.frequencySec / 60).toFixed(1)} min`
                                    : `1 cada ${Math.max(1, Math.round(fm.frequencySec))} s`
                                  : 'Sin entradas'}
                              </b>
                            </div>
                          </div>
                        )}
                        {fm?.isCapped && (
                          <p className="warning">
                            Tope activo: la demanda ({Math.round(fm.rawArrivalsPerHour)}{' '}
                            pers/h) supera el máximo configurado (
                            {fm.maxRatePerHour} pers/h).
                          </p>
                        )}
                      </div>
                    );
                  })()}
                  <div className="authority-group">
                    <span className="authority-title">
                      ¿Están las autoridades recomendadas a usar este acceso?
                    </span>
                    <details className="authority-dropdown">
                      <summary>
                        <span className="authority-summary-text">
                          {(() => {
                            const selected =
                              (item as Entrance).recommendedAuthorities || [];
                            if (!selected.length) {
                              return 'Seleccionar unidades...';
                            }
                            if (selected.length === 1) {
                              return (
                                AUTHORITY_UNITS.find(
                                  (u) => u.key === selected[0]
                                )?.label || '1 seleccionada'
                              );
                            }
                            return `${selected.length} unidades seleccionadas`;
                          })()}
                        </span>
                        <span className="authority-chevron" aria-hidden="true">
                          ▾
                        </span>
                      </summary>
                      <div className="authority-menu">
                        {AUTHORITY_UNITS.map((unit) => {
                          const selected =
                            (item as Entrance).recommendedAuthorities || [];
                          const checked = selected.includes(unit.key);
                          return (
                            <label
                              key={unit.key}
                              className={`authority-option ${checked ? 'is-checked' : ''}`}
                            >
                              <input
                                type="checkbox"
                                data-authority-unit={unit.key}
                                checked={checked}
                                onChange={(e) => {
                                  const isChecked = e.target.checked;
                                  updateScene((scene) => {
                                    const g = scene.entrances.find(
                                      (en) => en.id === item.id
                                    );
                                    if (!g) return;
                                    const prev = g.recommendedAuthorities || [];
                                    g.recommendedAuthorities = isChecked
                                      ? [...new Set([...prev, unit.key])]
                                      : prev.filter((k) => k !== unit.key);
                                  }, true);
                                  onSceneChanged();
                                }}
                              />
                              <span>{unit.label}</span>
                            </label>
                          );
                        })}
                      </div>
                    </details>
                  </div>
                </>
              )}

              {['food', 'commerce'].includes((item as Booth).type) && (
                <label>
                  Precio (€)
                  <input
                    id="edit-price"
                    type="number"
                    min="0"
                    step="0.5"
                    key={`price-${item.id}-${item.price}`}
                    defaultValue={Number(item.price || 0)}
                    onBlur={(e) =>
                      handlePropertyChange('price', e.target.value)
                    }
                  />
                </label>
              )}

              {isBooth && (
                <label>
                  Plazas simultáneas
                  <input
                    id="edit-labCapacity"
                    type="number"
                    min="1"
                    key={`cap-${item.id}-${item.labCapacity}`}
                    defaultValue={Number(
                      item.labCapacity || item.simultaneous || 1
                    )}
                    onBlur={(e) =>
                      handlePropertyChange('labCapacity', e.target.value)
                    }
                  />
                </label>
              )}

              {(item as Booth).type === 'stage' && (
                <label>
                  Nivel de referencia a 5 m (dB, supuesto)
                  <input
                    id="sound-level"
                    type="number"
                    min="0"
                    max="130"
                    key={`spl-${item.id}-${item.sound?.spl || 0}`}
                    defaultValue={Number(item.sound?.spl || 0)}
                    onBlur={(e) => {
                      const spl = Number(e.target.value);
                      if (!Number.isFinite(spl) || spl < 0 || spl > 130) return;
                      updateScene((scene) => {
                        const b = scene.base.booths.find(
                          (st) => st.id === item.id
                        );
                        if (b) {
                          b.sound = {
                            ...b.sound,
                            spl,
                            reference: 5,
                            enabled: spl > 0,
                          };
                        }
                      }, true);
                      onSceneChanged();
                    }}
                  />
                </label>
              )}

              {(item as Entrance).referenceAccess && (
                <p>Acceso de referencia: {(item as Entrance).description}</p>
              )}

              {(item as Infrastructure).kind === 'picnic' && (
                <label>
                  Plazas de esta mesa
                  <input
                    id="edit-capacity"
                    type="number"
                    min="0"
                    max="6"
                    key={`picnic-cap-${item.id}-${item.capacity ?? 6}`}
                    defaultValue={Number(item.capacity ?? 6)}
                    onBlur={(e) =>
                      handlePropertyChange('capacity', e.target.value)
                    }
                  />
                </label>
              )}

              {(item as Booth).type === 'food' && (
                <label>
                  Tiempo de servicio (min)
                  <input
                    id="edit-labTime"
                    type="number"
                    min="0.5"
                    max="120"
                    step="0.5"
                    key={`time-${item.id}-${item.labTime}`}
                    defaultValue={Number(item.labTime || 5)}
                    onBlur={(e) =>
                      handlePropertyChange('labTime', e.target.value)
                    }
                  />
                </label>
              )}

              {(item as Infrastructure).role === 'emergency' && (
                <>
                  <label className="check">
                    <input
                      type="checkbox"
                      id="reserve-resource"
                      checked={!!(item as Infrastructure).reserve}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        updateScene((scene) => {
                          const inf = scene.infrastructure.find(
                            (st) => st.id === item.id
                          );
                          if (inf) {
                            inf.reserve = checked;
                            inf.active = !checked;
                          }
                        }, true);
                        onSceneChanged();
                      }}
                    />{' '}
                    Recurso de reserva: llegará después de solicitar refuerzos
                  </label>
                  <div className="two">
                    <label>
                      Personal supuesto
                      <input
                        id="edit-staff"
                        type="number"
                        min="1"
                        max="20"
                        key={`staff-${item.id}-${item.staff}`}
                        defaultValue={item.staff || 2}
                        onBlur={(e) =>
                          handlePropertyChange('staff', e.target.value)
                        }
                      />
                    </label>
                    <label>
                      Equipos simultáneos
                      <input
                        id="edit-capacity"
                        type="number"
                        min="1"
                        max="10"
                        key={`emcap-${item.id}-${item.capacity}`}
                        defaultValue={item.capacity || 1}
                        onBlur={(e) =>
                          handlePropertyChange('capacity', e.target.value)
                        }
                      />
                    </label>
                  </div>
                  <div className="two">
                    <label>
                      Demora (s)
                      <input
                        id="edit-delay"
                        type="number"
                        min="0"
                        max="3600"
                        key={`delay-${item.id}-${item.delay}`}
                        defaultValue={item.delay ?? 60}
                        onBlur={(e) =>
                          handlePropertyChange('delay', e.target.value)
                        }
                      />
                    </label>
                    <label>
                      Atención (s)
                      <input
                        id="edit-handling"
                        type="number"
                        min="1"
                        max="7200"
                        key={`handling-${item.id}-${item.handling}`}
                        defaultValue={item.handling ?? 240}
                        onBlur={(e) =>
                          handlePropertyChange('handling', e.target.value)
                        }
                      />
                    </label>
                  </div>
                  <p>Parámetros de ensayo, sin validación local.</p>
                </>
              )}

              {!inside([item.x, item.y], s.boundary) && (
                <p className="warning">
                  Fuera del ámbito de ensayo. Puedes mantenerlo para planificar
                  el entorno.
                </p>
              )}
            </>
          ) : isFence ? (
            (() => {
              const fm = fenceMetrics(item, m);
              const anchors = fenceChainAnchors(item, s.fences || [], m);
              const bothAnchored = anchors.anchorA && anchors.anchorB;
              const oneAnchored = anchors.anchorA !== anchors.anchorB;
              const handleFenceGeom = (patch: {
                length?: number;
                angleDeg?: number;
              }) => {
                if (
                  patch.length !== undefined &&
                  (!Number.isFinite(patch.length) ||
                    patch.length < 0.5 ||
                    patch.length > 10)
                ) {
                  showToast('El largo de la valla debe estar entre 0,5 y 10 m');
                  return;
                }
                if (
                  patch.angleDeg !== undefined &&
                  (!Number.isFinite(patch.angleDeg) ||
                    patch.angleDeg < -360 ||
                    patch.angleDeg > 360)
                ) {
                  showToast('Ángulo válido: entre -360° y 360°');
                  return;
                }
                updateScene((scene) => {
                  const fences = scene.fences || [];
                  const target = fences.find((f) => f.id === item.id);
                  if (!target) return;
                  if (
                    patch.angleDeg !== undefined &&
                    (anchors.anchorA || anchors.anchorB)
                  ) {
                    const updates = rotateFenceChainByAngle(
                      structuredClone(fences),
                      item.id,
                      m,
                      patch.angleDeg
                    );
                    for (const f of fences) {
                      const nextPts = f.id ? updates.get(f.id) : undefined;
                      if (nextPts) f.points = nextPts;
                    }
                    return;
                  }
                  target.points = updateFenceGeometry(
                    target,
                    m,
                    patch,
                    anchors
                  );
                }, true);
                onSceneChanged();
              };
              return (
                <>
                  <span className="cell-tag">
                    {item.fenceKind === 'chain'
                      ? 'Valla encadenada'
                      : item.fenceKind === 'loose'
                        ? 'Valla suelta'
                        : 'Valla'}
                    {' · '}CELDA {cellAt(fm.mid, grid)}
                  </span>
                  <div className="two">
                    <label>
                      Largo (m)
                      <input
                        id="edit-fence-length"
                        type="number"
                        min="0.5"
                        max="10"
                        step="0.1"
                        disabled={isLocked || bothAnchored}
                        key={`flen-${item.id}-${fm.length.toFixed(2)}`}
                        defaultValue={fm.length.toFixed(2)}
                        onKeyDown={commitOnEnter}
                        onBlur={(e) =>
                          handleFenceGeom({length: Number(e.target.value)})
                        }
                      />
                    </label>
                    <label>
                      Ángulo (°)
                      <input
                        id="edit-fence-angle"
                        type="number"
                        min="-360"
                        max="360"
                        step="1"
                        disabled={isLocked}
                        key={`fang-${item.id}-${Math.round(fm.angleDeg)}`}
                        defaultValue={Math.round(fm.angleDeg)}
                        onKeyDown={commitOnEnter}
                        onBlur={(e) =>
                          handleFenceGeom({angleDeg: Number(e.target.value)})
                        }
                      />
                    </label>
                  </div>
                  <p className="small-note">
                    {bothAnchored || oneAnchored
                      ? 'Arrastra el cuerpo para mover toda la cadena junta, o arrastra un extremo blanco para rotar desde ese anclaje junto con los tramos conectados.'
                      : 'Las vallas que se tocan o solapan forman una barrera continua en la simulación.'}
                  </p>
                </>
              );
            })()
          ) : (item as {origin?: string}).origin === 'interest-zone' ? (
            <>
              <p>
                Perímetro transitable por el público en el que no se pueden
                colocar elementos de la escena.
              </p>
              <label className="check">
                <input
                  type="checkbox"
                  id="edit-interest-zone"
                  checked={(item as {interestZone?: boolean}).interestZone !== false}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    updateScene((scene) => {
                      const target = (scene.passages || []).find(
                        (r) => r.id === item.id
                      );
                      if (target) target.interestZone = checked;
                    }, true);
                    onSceneChanged();
                  }}
                />{' '}
                Considerar como zona de interés (atrae público)
              </label>
            </>
          ) : (
            isArea && (
              <p>
                {(item as {origin?: string}).origin === 'turning'
                  ? 'Zona de maniobra de vehículos trazada en polígono libre (excluida del tránsito peatonal durante las fases activas).'
                  : (item as {origin?: string}).origin === 'loading'
                    ? 'Zona de carga y descarga / aparcamiento para servicios públicos trazada en polígono libre (excluida del tránsito peatonal durante las fases activas).'
                    : 'Esta superficie queda excluida del tránsito de personas en el modelo.'}
              </p>
            )
          )}
        </>
      )}

      {!isNote && !isLine && !isEntrance && (item as Infrastructure).kind === 'ballast' && (
        (() => {
          const ballast = item as Infrastructure;
          const parentCover = ballast.attachedCoverId
            ? s.infrastructure.find((r) => r.id === ballast.attachedCoverId)
            : undefined;
          const supportArea = effectiveSupportAreaM2(ballast);
          const loadKgM2 = surfaceLoadKgM2(ballast);
          const updateBallast = (
            patch: Partial<
              Pick<Infrastructure, 'massKg' | 'supportAreaM2' | 'attachedCoverId'>
            >
          ) => {
            updateScene((scene) => {
              const target = scene.infrastructure.find((r) => r.id === ballast.id);
              if (!target) return;
              Object.assign(target, patch);
              if ('massKg' in patch || 'supportAreaM2' in patch) {
                target.heavyLoad = meetsHeavyLoadThreshold(target);
              }
            }, true);
            onSceneChanged();
          };
          return (
            <fieldset className="ballast-fieldset" id="ballast-properties">
              <legend>Lastre / contrapeso</legend>
              {parentCover && (
                <div className="small-note" id="ballast-parent-cover" style={{marginBottom: '8px'}}>
                  <p>
                    Subcomponente de <b>{parentCover.name}</b> (se mueve con la
                    carpa; editable aquí de forma independiente).
                  </p>
                  <div className="two" style={{marginTop: '4px'}}>
                    <button
                      type="button"
                      id="select-parent-cover"
                      className="quiet"
                      onClick={() => setSelectedIds([parentCover.id])}
                    >
                      Ir a la carpa
                    </button>
                    <button
                      type="button"
                      id="detach-ballast"
                      className="quiet"
                      onClick={() => {
                        updateBallast({attachedCoverId: undefined});
                        showToast('Lastre desvinculado de la carpa');
                      }}
                    >
                      Desvincular
                    </button>
                  </div>
                </div>
              )}
              <div className="two">
                <label>
                  Masa (kg)
                  <input
                    id="edit-ballast-mass"
                    type="number"
                    min="1"
                    max="50000"
                    step="10"
                    disabled={isLocked}
                    key={`bmass-${ballast.id}-${ballast.massKg ?? 500}`}
                    defaultValue={ballast.massKg ?? 500}
                    onKeyDown={commitOnEnter}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (!Number.isFinite(v) || v <= 0 || v > 50000) {
                        showToast('Masa válida: entre 1 y 50.000 kg');
                        return;
                      }
                      if (v !== ballast.massKg) updateBallast({massKg: v});
                    }}
                  />
                </label>
                <label>
                  Superficie apoyo (m²)
                  <input
                    id="edit-ballast-area"
                    type="number"
                    min="0.05"
                    max="100"
                    step="0.05"
                    disabled={isLocked}
                    key={`barea-${ballast.id}-${supportArea.toFixed(2)}`}
                    defaultValue={Number(supportArea.toFixed(2))}
                    onKeyDown={commitOnEnter}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (!Number.isFinite(v) || v < 0.05 || v > 100) {
                        showToast('Superficie válida: entre 0,05 y 100 m²');
                        return;
                      }
                      updateBallast({supportAreaM2: v});
                    }}
                  />
                </label>
              </div>
              <p className="small-note" id="ballast-surface-load">
                Carga superficial transmitida al suelo:{' '}
                <b>
                  {loadKgM2 !== null
                    ? `${Math.round(loadKgM2).toLocaleString('es-ES')} kg/m²`
                    : '—'}
                </b>
                {loadKgM2 !== null && loadKgM2 >= HEAVY_LOAD_THRESHOLD_KG_M2
                  ? ` (≥ ${HEAVY_LOAD_THRESHOLD_KG_M2} kg/m²)`
                  : ''}
              </p>
            </fieldset>
          );
        })()
      )}

      {!isNote && !isLine && !isEntrance && (item as Infrastructure).role === 'cover' && (
        (() => {
          const cover = item as Infrastructure;
          const st = evaluateCoverBallast(cover, s, m);
          const updateCover = (
            patch: Partial<
              Pick<
                Infrastructure,
                | 'tentMassKg'
                | 'ballastSpanMeters'
                | 'ballastsPerSpan'
                | 'ballastRequiredMassKg'
              >
            >
          ) => {
            updateScene((scene) => {
              const target = scene.infrastructure.find((r) => r.id === cover.id);
              if (target) Object.assign(target, patch);
            }, true);
            onSceneChanged();
          };
          return (
            <fieldset className="ballast-fieldset" id="cover-ballast-config">
              <legend>Dotación de lastres (carpa)</legend>
              <label>
                Peso propio de la carpa (kg, separado)
                <input
                  id="edit-tent-mass"
                  type="number"
                  min="0"
                  max="50000"
                  step="10"
                  disabled={isLocked}
                  key={`tmass-${cover.id}-${cover.tentMassKg ?? ''}`}
                  defaultValue={cover.tentMassKg ?? ''}
                  placeholder="Opcional"
                  onKeyDown={commitOnEnter}
                  onBlur={(e) => {
                    const raw = e.target.value.trim();
                    if (!raw) {
                      updateCover({tentMassKg: undefined});
                      return;
                    }
                    const v = Number(raw);
                    if (!Number.isFinite(v) || v < 0 || v > 50000) return;
                    updateCover({tentMassKg: v});
                  }}
                />
              </label>
              <div className="two">
                <label>
                  Cada tramo X (m)
                  <input
                    id="edit-ballast-span"
                    type="number"
                    min="0.5"
                    max="100"
                    step="0.5"
                    disabled={isLocked}
                    key={`bspan-${cover.id}-${cover.ballastSpanMeters ?? ''}`}
                    defaultValue={cover.ballastSpanMeters ?? ''}
                    placeholder="Según ficha"
                    onKeyDown={commitOnEnter}
                    onBlur={(e) => {
                      const raw = e.target.value.trim();
                      if (!raw) {
                        updateCover({ballastSpanMeters: undefined});
                        return;
                      }
                      const v = Number(raw);
                      if (!Number.isFinite(v) || v < 0.5 || v > 100) {
                        showToast('Tramo válido: entre 0,5 y 100 m');
                        return;
                      }
                      updateCover({ballastSpanMeters: v});
                    }}
                  />
                </label>
                <label>
                  Lastres / tramo
                  <input
                    id="edit-ballasts-per-span"
                    type="number"
                    min="0"
                    max="50"
                    step="1"
                    disabled={isLocked}
                    key={`bper-${cover.id}-${cover.ballastsPerSpan ?? ''}`}
                    defaultValue={cover.ballastsPerSpan ?? ''}
                    placeholder="Ej. 2"
                    onKeyDown={commitOnEnter}
                    onBlur={(e) => {
                      const raw = e.target.value.trim();
                      if (!raw) {
                        updateCover({ballastsPerSpan: undefined});
                        return;
                      }
                      const v = Math.round(Number(raw));
                      if (!Number.isFinite(v) || v < 0 || v > 50) return;
                      updateCover({ballastsPerSpan: v});
                    }}
                  />
                </label>
              </div>
              <label>
                Masa mínima por lastre (kg, ficha técnica)
                <input
                  id="edit-ballast-req-mass"
                  type="number"
                  min="0"
                  max="50000"
                  step="10"
                  disabled={isLocked}
                  key={`breq-${cover.id}-${cover.ballastRequiredMassKg ?? ''}`}
                  defaultValue={cover.ballastRequiredMassKg ?? ''}
                  placeholder="Opcional"
                  onKeyDown={commitOnEnter}
                  onBlur={(e) => {
                    const raw = e.target.value.trim();
                    if (!raw) {
                      updateCover({ballastRequiredMassKg: undefined});
                      return;
                    }
                    const v = Number(raw);
                    if (!Number.isFinite(v) || v < 0 || v > 50000) return;
                    updateCover({ballastRequiredMassKg: v});
                  }}
                />
              </label>
              <div className="two" style={{marginTop: '8px'}}>
                <button
                  type="button"
                  id="add-cover-ballast"
                  className="quiet"
                  disabled={isLocked}
                  onClick={() => {
                    let created: string[] = [];
                    updateScene((scene) => {
                      const target = scene.infrastructure.find(
                        (r) => r.id === cover.id
                      );
                      if (!target) return;
                      created = addBallastSubcomponentsToCover(target, scene, m, 1);
                    }, true);
                    if (created.length) {
                      onSceneChanged();
                      showToast('Lastre añadido como subcomponente de la carpa');
                    }
                  }}
                >
                  + Añadir lastre
                </button>
                {st.configured && st.missingCount > 0 && (
                  <button
                    type="button"
                    id="generate-missing-ballasts"
                    className="quiet"
                    disabled={isLocked}
                    onClick={() => {
                      let created: string[] = [];
                      updateScene((scene) => {
                        const target = scene.infrastructure.find(
                          (r) => r.id === cover.id
                        );
                        if (!target) return;
                        created = addBallastSubcomponentsToCover(
                          target,
                          scene,
                          m,
                          st.missingCount
                        );
                      }, true);
                      if (created.length) {
                        onSceneChanged();
                        showToast(
                          `${created.length} lastre(s) generados en la carpa`
                        );
                      }
                    }}
                  >
                    Generar {st.missingCount} faltantes
                  </button>
                )}
              </div>
              {st.linkedBallasts.length > 0 && (
                <ul
                  id="cover-ballast-list"
                  className="multi-select-summary"
                  style={{marginTop: '8px'}}
                >
                  {st.linkedBallasts.map((b) => {
                    const load = surfaceLoadKgM2(b);
                    return (
                      <li key={b.id}>
                        <button
                          type="button"
                          className="quiet"
                          style={{
                            padding: '2px 6px',
                            fontSize: '0.78rem',
                            textAlign: 'left',
                          }}
                          onClick={() => setSelectedIds([b.id])}
                        >
                          {b.name} · {b.massKg ?? 500} kg
                          {load !== null ? ` (${Math.round(load)} kg/m²)` : ''}
                        </button>
                        <button
                          type="button"
                          className="danger quiet"
                          aria-label={`Eliminar ${b.name}`}
                          style={{padding: '2px 6px', fontSize: '0.75rem'}}
                          onClick={() => {
                            updateScene((scene) => {
                              deleteItemsFromScene(scene, [b.id], panel);
                            }, true);
                            onSceneChanged();
                          }}
                        >
                          ×
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <div id="cover-ballast-summary" className="small-note" style={{marginTop: '8px'}}>
                {st.configured ? (
                  <p>
                    Necesarios: <b>{st.requiredCount}</b> ({st.spansCount}{' '}
                    {st.spansCount === 1 ? 'tramo' : 'tramos'} de {num(st.spanMeters)} m
                    {' × '}
                    {st.ballastsPerSpan}) · Vinculados: <b>{st.linkedCount}</b>
                  </p>
                ) : (
                  <p>
                    Configura tramo y lastres/tramo según la ficha del fabricante
                    (vinculados ahora: <b>{st.linkedCount}</b>).
                  </p>
                )}
                <p>
                  Peso carpa: <b>{st.tentMassKg > 0 ? `${st.tentMassKg} kg` : '—'}</b> ·
                  Lastres: <b>{st.totalBallastMassKg} kg</b> · Máx. al suelo:{' '}
                  <b>
                    {st.maxBallastSurfaceLoadKgM2 > 0
                      ? `${Math.round(st.maxBallastSurfaceLoadKgM2)} kg/m²`
                      : '—'}
                  </b>
                </p>
              </div>
              {st.configured && !st.complete && (
                <p className="warning" id="cover-ballast-warning">
                  {st.missingCount > 0
                    ? `⚠ Faltan ${st.missingCount} lastre(s) (${st.linkedCount}/${st.requiredCount} vinculados).`
                    : ''}
                  {st.underMassBallasts.length > 0
                    ? ` ⚠ ${st.underMassBallasts.length} lastre(s) por debajo de ${st.requiredMassPerUnitKg} kg.`
                    : ''}
                </p>
              )}
              <p className="small-note">
                La separación y la masa deben proceder de la ficha del fabricante
                o del cálculo técnico. El umbral de 500 kg/m² no valida la
                seguridad del montaje.
              </p>
            </fieldset>
          );
        })()
      )}

      {!isNote && !isLine && !isEntrance && (
        <>
          <label className="check">
            <input
              type="checkbox"
              id="heavy-load-toggle"
              checked={isHeavyLoadItem(item)}
              onChange={(e) => {
                const checked = e.target.checked;
                updateScene((scene) => {
                  const target = [
                    ...scene.base.booths,
                    ...scene.infrastructure,
                  ].find((st) => st.id === item.id);
                  if (target) target.heavyLoad = checked;
                }, true);
                onSceneChanged();
              }}
            />{' '}
            Elemento pesado (umbral revisión ≥ {HEAVY_LOAD_THRESHOLD_KG_M2} kg/m²)
          </label>
          {(item as Infrastructure).kind === 'ballast' && (
            <p className="small-note">
              Umbral orientativo de revisión del proyecto (no es un límite
              estructural certificado).
            </p>
          )}
          {(() => {
            if (!isHeavyLoadItem(item) || !s.subsoil) return null;
            const conflict = evaluateItemSubsoilHeat(item, s.subsoil, m);
            if (!conflict) return null;
            const areaNames =
              conflict.sources
                .slice(0, 2)
                .map((src) => `«${src.name}»`)
                .join(', ') || 'el subsuelo';
            return (
              <p className="warning" id="subsoil-load-warning">
                ⚠ Carga pesada sobre forjado sin apoyo suficiente en {areaNames}{' '}
                (apoyo mínimo {Math.round(conflict.support * 100)} %). Acércala
                a un pilar, muro interior o muro perimetral, o sácala del
                garaje.
              </p>
            );
          })()}
        </>
      )}

      <fieldset>
        <legend>Visible durante</legend>
        {(Object.entries(phases) as Array<[PhaseKey, string]>).map(
          ([k, label]) => (
            <label key={k}>
              <input
                type="checkbox"
                data-phase-tag={k}
                checked={currentTags.includes(k)}
                onChange={(e) => handlePhaseTagToggle(k, e.target.checked)}
              />{' '}
              {label}
            </label>
          )
        )}
      </fieldset>

      <button
        type="button"
        id="lock-piece"
        aria-pressed={isLocked}
        className={`lock-btn wide ${isLocked ? 'is-locked' : ''}`}
        style={{marginTop: '12px'}}
        onClick={() => handleToggleLock(!isLocked)}
      >
        {isLocked ? (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.3"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="4" y="11" width="16" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        ) : (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.3"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="4" y="11" width="16" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 7.6-1.7" />
          </svg>
        )}
        {isLocked ? 'Elemento bloqueado' : 'Bloquear elemento'}
      </button>

      <button
        type="button"
        id="duplicate-object"
        className="duplicate quiet wide"
        style={{marginTop: '8px'}}
        onClick={handleDuplicate}
      >
        Duplicar {isNote ? 'observación' : 'elemento'}
      </button>

      <button
        type="button"
        id="delete-object"
        className="danger quiet wide"
        style={{marginTop: '8px'}}
        onClick={handleDelete}
      >
        Eliminar {isNote ? 'observación' : 'elemento'}
      </button>
    </aside>
  );
};
