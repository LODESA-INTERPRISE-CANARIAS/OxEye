import React, {useEffect, useState} from 'react';
import {cellAt, inside, world} from '../../engine/cartography/geometry';
import {membership, phases} from '../../engine/logistics/phases';
import {useProjectStore} from '../../store/useProjectStore';
import type {
  Annotation,
  AuthorityAccessUnit,
  Booth,
  Entrance,
  Infrastructure,
  PhaseKey,
} from '../../types';

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
  const selectedId = useProjectStore((s) => s.selectedId);
  const panel = useProjectStore((s) => s.panel);
  const phase = useProjectStore((s) => s.phase);
  const grid = useProjectStore((s) => s.grid);
  const currentScene = useProjectStore((s) => s.currentScene);
  const currentMap = useProjectStore((s) => s.currentMap);
  const revision = useProjectStore((s) => s.revision);
  const setSelectedId = useProjectStore((s) => s.setSelectedId);
  const updateScene = useProjectStore((s) => s.updateScene);
  const showToast = useProjectStore((s) => s.showToast);

  void revision;
  const s = currentScene();
  const m = currentMap();

  const allObjects = [
    ...s.base.booths,
    ...s.infrastructure,
    ...s.entrances,
  ];
  const found =
    allObjects.find((o) => o.id === selectedId) ||
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

  const [noteText, setNoteText] = useState('');

  useEffect(() => {
    if (found && isNote) {
      setNoteText((found as Annotation).text || '');
    }
  }, [found, isNote, selectedId]);

  if (!found || panel === 'simulate') {
    return <aside id="inspector" className="float-panel inspector" hidden />;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const item = found as any;
  const currentTags = membership(
    item,
    isArea ? (Object.keys(phases) as PhaseKey[]) : ['event']
  );
  const coords = !isLine && !isNote ? world([item.x, item.y], m) : [0, 0];

  const handlePropertyChange = (prop: string, rawValue: string) => {
    const val = prop === 'name' ? rawValue : Number(rawValue);
    if (
      prop !== 'name' &&
      (!Number.isFinite(val) ||
        (['width', 'depth'].includes(prop) &&
          (Number(val) < 0.5 || Number(val) > 100)) ||
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
      target[prop] = v;
      if (typeof target.width === 'number' && typeof target.depth === 'number') {
        target.area = target.width * target.depth;
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
    const isPlaceableObject =
      isBooth || isEntrance || s.infrastructure.some((i) => i.id === item.id);
    if (
      isPlaceableObject &&
      s.base.booths.length + s.infrastructure.length + s.entrances.length >= 150
    ) {
      showToast('Límite del prototipo: 150 elementos por espacio');
      return;
    }
    const newId = crypto.randomUUID();
    updateScene((scene) => {
      const lists = [
        scene.base.booths,
        scene.infrastructure,
        scene.entrances,
        scene.annotations,
        scene.roadPlans,
        scene.measurements,
        scene.reserves,
        scene.flows || [],
        scene.fences || [],
        scene.passages || [],
      ];
      for (const arr of lists) {
        const idx = arr.findIndex((o) => o.id === item.id);
        if (idx >= 0) {
          const clone = structuredClone(arr[idx]) as unknown as Record<
            string,
            unknown
          >;
          clone.id = newId;
          if (Array.isArray(clone.points)) {
            const dx = (2 / m.widthMeters) * 100;
            const dy = (2 / m.heightMeters) * 100;
            clone.points = (clone.points as Array<[number, number]>).map(
              ([px, py]) => [
                Math.max(0, Math.min(100, px + dx)),
                Math.max(0, Math.min(100, py + dy)),
              ]
            );
          } else if (
            typeof clone.x === 'number' &&
            typeof clone.y === 'number'
          ) {
            const stepMeters =
              typeof clone.width === 'number'
                ? Math.max(2, clone.width * 0.5 + 1)
                : 2;
            const dx = (stepMeters / m.widthMeters) * 100;
            const dy = (2 / m.heightMeters) * 100;
            clone.x =
              clone.x + dx <= 98
                ? clone.x + dx
                : Math.max(2, clone.x - dx);
            clone.y =
              clone.y + dy <= 98
                ? clone.y + dy
                : Math.max(2, clone.y - dy);
            if (arr === scene.annotations) {
              clone.cell = cellAt(
                world([clone.x as number, clone.y as number], m),
                (clone.grid as number) || grid
              );
            }
          }
          (arr as unknown[]).push(clone);
          if (arr === scene.flows) {
            scene.corridors = structuredClone(scene.flows || []);
          }
          break;
        }
      }
    }, true);
    setSelectedId(newId);
    onSceneChanged();
    showToast(isNote ? 'Observación duplicada' : 'Elemento duplicado');
  };

  const handleDelete = () => {
    updateScene((scene) => {
      for (const arr of [
        scene.base.booths,
        scene.infrastructure,
        scene.entrances,
        scene.annotations,
        scene.roadPlans,
        scene.measurements,
        scene.reserves,
        scene.flows || [],
        scene.fences || [],
        scene.passages || [],
      ]) {
        const idx = arr.findIndex((o) => o.id === item.id);
        if (idx >= 0) arr.splice(idx, 1);
      }
      scene.corridors = structuredClone(scene.flows || []);
    }, true);
    setSelectedId(null);
    onSceneChanged();
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
                <>
                  <div className="two">
                    <label>
                      Anchura (m)
                      <input
                        id="edit-width"
                        type="number"
                        min="0.5"
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
                        min="0.5"
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
          ) : (
            isArea && (
              <p>
                Esta superficie queda excluida del tránsito de personas en el
                modelo.
              </p>
            )
          )}
        </>
      )}

      {isBooth && (
        <label className="check">
          <input
            type="checkbox"
            id="lock-piece"
            checked={!!(item as Booth).locked}
            onChange={(e) => {
              const checked = e.target.checked;
              updateScene((scene) => {
                const b = scene.base.booths.find((st) => st.id === item.id);
                if (b) b.locked = checked;
              }, true);
              onClearProposal();
            }}
          />{' '}
          Fijar posición en el autoconfigurador
        </label>
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
        id="duplicate-object"
        className="duplicate quiet wide"
        style={{marginTop: '12px'}}
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
