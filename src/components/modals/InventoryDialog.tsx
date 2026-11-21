import React, {useEffect, useMemo, useRef, useState} from 'react';
import {CATALOG, VENUES} from '../../data/catalog';
import {
  getInventoryMeta,
  INVENTORY_CATEGORIES,
  type InventoryCategoryKey,
} from '../../data/inventory-meta';
import {inventoryInfo} from '../../data/site-reference';
import {batchMap} from '../../engine/cartography/minimap';
import {
  DEFAULT_TENERIFE_RESPONSE_CONDITIONS,
  resolveResponseConditions,
} from '../../engine/emergency/response-model';
import {phaseScene} from '../../engine/logistics/phases';
import {
  arrangeStock,
  classify,
  reconcile,
} from '../../engine/planning/inventory';
import {redesign} from '../../engine/planning/layout';
import {useProjectStore} from '../../store/useProjectStore';
import type {ResponseConditions, Scene} from '../../types';
import {InventoryIcon} from '../icons/InventoryIcons';

export interface InventoryDialogProps {
  onSceneCommitted: () => void;
}

const fmtDuration = (sec: number): string => {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return m > 0 ? `${m} min${rem ? ` ${rem} s` : ''}` : `${rem} s`;
};

/**
 * Modal dialog (`#inventory-dialog`) for managing project stock quantities in a
 * BeamNG-inspired 3-column categorized catalog with editable Tenerife response-time conditions.
 */
export const InventoryDialog: React.FC<InventoryDialogProps> = ({
  onSceneCommitted,
}) => {
  const dlgRef = useRef<HTMLDialogElement | null>(null);
  const activeModal = useProjectStore((s) => s.activeModal);
  const activeVenue = useProjectStore((s) => s.activeVenue);
  const onboardingStage = useProjectStore((s) => s.onboardingStage);
  const currentScene = useProjectStore((s) => s.currentScene);
  const currentMap = useProjectStore((s) => s.currentMap);
  const setActiveModal = useProjectStore((s) => s.setActiveModal);
  const setOnboardingStage = useProjectStore((s) => s.setOnboardingStage);
  const replaceScene = useProjectStore((s) => s.replaceScene);
  const updateScene = useProjectStore((s) => s.updateScene);
  const setPhase = useProjectStore((s) => s.setPhase);
  const setSelectedId = useProjectStore((s) => s.setSelectedId);
  const setTool = useProjectStore((s) => s.setTool);
  const showToast = useProjectStore((s) => s.showToast);

  const isOpen = activeModal === 'inventory';
  const entries = useMemo(() => Object.entries(CATALOG), []);

  const [counts, setCounts] = useState<Record<string, number>>({});
  const [respCond, setRespCond] = useState<ResponseConditions>(
    DEFAULT_TENERIFE_RESPONSE_CONDITIONS
  );
  const [activeTab, setActiveTab] = useState<InventoryCategoryKey>('all');
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<{
    scene: Scene;
    removed: number;
    added: number;
  } | null>(null);
  const [autoCandidate, setAutoCandidate] = useState<{
    scene: Scene;
    reason: string;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const dlg = dlgRef.current;
    if (!dlg) return;
    if (isOpen && !dlg.open) {
      const s = currentScene();
      const all = [
        ...s.base.booths,
        ...s.infrastructure,
        ...s.entrances,
        ...(s.pendingStock || []),
      ];
      const initialCounts = Object.fromEntries(
        Object.keys(CATALOG).map((k) => [
          k,
          all.filter((o) => classify(o) === k).length,
        ])
      );
      setCounts(initialCounts);
      setRespCond(resolveResponseConditions(s.responseConditions));
      setActiveTab('all');
      setSearch('');
      setDraft(null);
      setAutoCandidate(null);
      setErrorMsg('');
      dlg.showModal();
    } else if (!isOpen && dlg.open) {
      dlg.close();
    }
  }, [isOpen, currentScene]);

  const totalCount = useMemo(
    () => Object.values(counts).reduce((n, v) => n + (Number(v) || 0), 0),
    [counts]
  );

  const categoryCounts = useMemo(() => {
    const map: Record<string, number> = {
      all: entries.length,
      emergency: 0,
      commerce: 0,
      comfort: 0,
      logistics: 0,
    };
    for (const [k] of entries) {
      const cat = getInventoryMeta(k).category;
      map[cat] = (map[cat] || 0) + 1;
    }
    return map;
  }, [entries]);

  const filteredEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter(([k, c]) => {
      const meta = getInventoryMeta(k);
      if (activeTab !== 'all' && activeTab !== 'response' && meta.category !== activeTab) {
        return false;
      }
      if (!q) return true;
      const title = (inventoryInfo[k]?.[0] || c.name).toLowerCase();
      return title.includes(q) || k.toLowerCase().includes(q);
    });
  }, [entries, activeTab, search]);

  const handleAdjust = (key: string, delta: number) => {
    setCounts((prev) => ({
      ...prev,
      [key]: Math.max(0, Math.min(500, (prev[key] || 0) + delta)),
    }));
    setDraft(null);
    setAutoCandidate(null);
    setErrorMsg('');
  };

  const handleReviewSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setAutoCandidate(null);
    try {
      const res = reconcile(currentScene(), counts, CATALOG);
      res.scene.responseConditions = resolveResponseConditions(respCond);
      setDraft(res);
    } catch (err) {
      setDraft(null);
      setErrorMsg((err as Error).message);
    }
  };

  const commitScene = (scene: Scene) => {
    scene.responseConditions = resolveResponseConditions(respCond);
    replaceScene(scene, true);
    setPhase('event');
    setSelectedId(null);
    setTool('select');
    if (onboardingStage === 'inventory') {
      setOnboardingStage('none');
    }
    setActiveModal(null);
    onSceneCommitted();
  };

  const handleSaveResponseConditionsOnly = () => {
    const normalized = resolveResponseConditions(respCond);
    updateScene((sc) => {
      sc.responseConditions = normalized;
    }, true);
    showToast('Condiciones de respuesta de Tenerife guardadas');
  };

  const handleAutoPropose = () => {
    if (!draft) return;
    const m = currentMap();
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    const candidate = arrangeStock(draft.scene, m, seed);
    const trial = redesign(phaseScene(candidate, 'event'), m, {
      seed,
      space: 1.5,
      onlyMove: true,
      strategy: seed % 3,
      allowReplan: true,
    });
    if (trial.moves.length) {
      const changes = new Map(trial.moves.map((o: {id: string}) => [o.id, o]));
      for (const o of [...candidate.base.booths, ...candidate.infrastructure]) {
        if (changes.has(o.id)) Object.assign(o, changes.get(o.id));
      }
      if (trial.routing) Object.assign(candidate, trial.routing);
    }
    setAutoCandidate({scene: candidate, reason: trial.reason});
  };

  return (
    <dialog
      id="inventory-dialog"
      ref={dlgRef}
      onClose={() => {
        if (onboardingStage === 'inventory') {
          setOnboardingStage('none');
        }
        if (isOpen) setActiveModal(null);
      }}
    >
      <div id="inventory-body">
        {onboardingStage === 'inventory' && (
          <div className="onboarding-step-banner" id="onboarding-inventory-step">
            <b>Paso 2 de 2 · Define el inventario del evento</b>
            <span>
              El perímetro operativo y los accesos iniciales ya están listos.
              Ajusta las piezas que necesitas para pasar a la edición libre del
              plano.
            </span>
          </div>
        )}

        <div className="inv-header">
          <div>
            <h2 style={{marginBottom: '4px'}}>1. Lo que tengo</h2>
            <p className="small-note" style={{margin: 0}}>
              {currentMap().customLocation?.label || VENUES[activeVenue].name} ·
              Cantidades totales del proyecto y tiempos de respuesta externa.
            </p>
          </div>
          <div className="inv-header-meta">
            <span className="inv-total-pill" id="inv-total-pill">
              {totalCount} / 500 piezas
            </span>
            {activeTab !== 'response' && (
              <div className="inv-search-wrap">
                <InventoryIcon name="search" size={15} className="inv-search-ico" />
                <input
                  type="search"
                  className="inv-search"
                  placeholder="Buscar pieza, vehículo o servicio…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {search && (
                  <button
                    type="button"
                    className="inv-search-clear"
                    aria-label="Limpiar búsqueda"
                    onClick={() => setSearch('')}
                  >
                    ×
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="inv-tabs" role="tablist" aria-label="Categorías de inventario">
          {INVENTORY_CATEGORIES.map((cat) => (
            <button
              key={cat.key}
              type="button"
              role="tab"
              aria-selected={activeTab === cat.key}
              className={`inv-tab${activeTab === cat.key ? ' active' : ''}`}
              onClick={() => setActiveTab(cat.key)}
            >
              <span className="inv-tab-main">
                <InventoryIcon name={cat.icon} size={16} />
                <span>{cat.label}</span>
              </span>
              {cat.key !== 'response' && (
                <span className="inv-tab-count">{categoryCounts[cat.key] || 0}</span>
              )}
            </button>
          ))}
        </div>

        {(() => {
          const legacy = currentScene().infrastructure.filter((o) =>
            ['cleaning', 'prep', 'assembly', 'dismantle'].includes(o.kind)
          );
          return legacy.length > 0 ? (
            <div style={{marginBottom: '12px'}}>
              <p className="small-note">
                {legacy.length} rectángulos antiguos representan tareas, no
                personal. Puedes retirarlos y definir el equipo en Empresas y
                recursos.
              </p>
              <button
                id="remove-legacy"
                type="button"
                onClick={() => {
                  updateScene((sc) => {
                    sc.infrastructure = sc.infrastructure.filter(
                      (o) =>
                        !['cleaning', 'prep', 'assembly', 'dismantle'].includes(
                          o.kind
                        )
                    );
                  }, true);
                  onSceneCommitted();
                }}
              >
                Retirar esos rectángulos del plano
              </button>
            </div>
          ) : null;
        })()}

        {activeTab === 'response' ? (
          <div className="inv-response-panel" id="response-conditions-panel">
            <h3 className="inv-response-heading">
              <InventoryIcon name="response" size={18} />
              <span>Condiciones de tiempo de respuesta (referencia Tenerife)</span>
            </h3>
            <p className="small-note" style={{marginBottom: '12px'}}>
              En todo contexto existe un <b>refuerzo externo en reserva</b> que
              acude desde el acceso/spawn más cercano cuando hay <b>0 unidades</b>{' '}
              en recinto o cuando las unidades presentes se ven sobrepasadas.
              Puedes calibrar los tiempos de llegada según la distancia real en
              Tenerife (La Laguna / Área Metropolitana):
            </p>
            <div className="inv-response-grid">
              <div className="inv-response-card">
                <label>
                  <span className="inv-response-label">
                    <InventoryIcon name="detection" size={16} />
                    <span>Detección del riesgo y aviso al 1-1-2 (segundos)</span>
                  </span>
                  <input
                    id="rc-detection"
                    type="number"
                    min="5"
                    max="600"
                    step="5"
                    value={respCond.detectionSec}
                    onChange={(e) =>
                      setRespCond((prev) => ({
                        ...prev,
                        detectionSec: Math.max(5, Number(e.target.value) || 45),
                      }))
                    }
                  />
                </label>
                <span className="small-note">
                  Tiempo desde el inicio de la incidencia hasta la activación de
                  la central.
                </span>
              </div>

              <div className="inv-response-card">
                <label>
                  <span className="inv-response-label">
                    <InventoryIcon name="fire" size={16} />
                    <span>Bomberos de Tenerife — desplazamiento externo (segundos)</span>
                  </span>
                  <input
                    id="rc-fire"
                    type="number"
                    min="30"
                    max="3600"
                    step="30"
                    value={respCond.fireExternalSec}
                    onChange={(e) =>
                      setRespCond((prev) => ({
                        ...prev,
                        fireExternalSec: Math.max(30, Number(e.target.value) || 420),
                      }))
                    }
                  />
                </label>
                <span className="small-note">
                  Parque La Laguna / Santa Cruz · Con 0 bomberos en recinto:{' '}
                  <b>
                    {fmtDuration(respCond.detectionSec + respCond.fireExternalSec)}
                  </b>{' '}
                  (detección + traslado).
                </span>
              </div>

              <div className="inv-response-card">
                <label>
                  <span className="inv-response-label">
                    <InventoryIcon name="patrol" size={16} />
                    <span>Policía Local / Nacional — desplazamiento externo (segundos)</span>
                  </span>
                  <input
                    id="rc-police"
                    type="number"
                    min="30"
                    max="3600"
                    step="30"
                    value={respCond.policeExternalSec}
                    onChange={(e) =>
                      setRespCond((prev) => ({
                        ...prev,
                        policeExternalSec: Math.max(30, Number(e.target.value) || 360),
                      }))
                    }
                  />
                </label>
                <span className="small-note">
                  Refuerzo desde comisaría / spawn · Con 0 o todos ocupados:{' '}
                  <b>
                    {fmtDuration(respCond.detectionSec + respCond.policeExternalSec)}
                  </b>
                  .
                </span>
              </div>

              <div className="inv-response-card">
                <label>
                  <span className="inv-response-label">
                    <InventoryIcon name="ambulance" size={16} />
                    <span>SUC / Ambulancia 1-1-2 Canarias — desplazamiento externo (segundos)</span>
                  </span>
                  <input
                    id="rc-medical"
                    type="number"
                    min="30"
                    max="3600"
                    step="30"
                    value={respCond.medicalExternalSec}
                    onChange={(e) =>
                      setRespCond((prev) => ({
                        ...prev,
                        medicalExternalSec: Math.max(30, Number(e.target.value) || 480),
                      }))
                    }
                  />
                </label>
                <span className="small-note">
                  Base externa SUC Tenerife · Con 0 sanitarios o saturación:{' '}
                  <b>
                    {fmtDuration(respCond.detectionSec + respCond.medicalExternalSec)}
                  </b>
                  .
                </span>
              </div>
            </div>

            <div style={{display: 'flex', gap: '8px', flexWrap: 'wrap'}}>
              <button
                type="button"
                className="dark"
                onClick={handleSaveResponseConditionsOnly}
              >
                Guardar tiempos de respuesta
              </button>
              <button
                type="button"
                className="quiet"
                onClick={() =>
                  setRespCond({...DEFAULT_TENERIFE_RESPONSE_CONDITIONS})
                }
              >
                Restaurar referencia Tenerife (La Laguna)
              </button>
            </div>
          </div>
        ) : (
          <form id="stock-form" onSubmit={handleReviewSubmit}>
            <div className="stock-grid-3">
              {filteredEntries.map(([k, c]) => {
                const qty = counts[k] ?? 0;
                const meta = getInventoryMeta(k);
                const tiers = meta.tiers(respCond);
                const activeTier = qty === 0 ? 'zero' : qty === 1 ? 'one' : 'multi';
                const title = inventoryInfo[k]?.[0] || c.name;

                return (
                  <div
                    key={k}
                    className={`stock-card${qty > 0 ? ' has-units' : ''}`}
                  >
                    <div>
                      <div className="stock-card-head">
                        <span className="stock-card-icon" aria-hidden="true">
                          <InventoryIcon name={k} size={20} />
                        </span>
                        <div className="stock-card-title-wrap">
                          <span className="stock-card-title">{title}</span>
                          <span className="stock-card-size">
                            {c.w} × {c.h} m
                            {c.heavyLoad ? ' · pesado' : ''}
                          </span>
                        </div>
                      </div>

                      <div className="stock-card-tiers" style={{marginTop: '8px'}}>
                        <div
                          className={`stock-tier${activeTier === 'zero' ? ' active' : ''}`}
                        >
                          {tiers.zero}
                        </div>
                        <div
                          className={`stock-tier${activeTier === 'one' ? ' active' : ''}`}
                        >
                          {tiers.one}
                        </div>
                        <div
                          className={`stock-tier${activeTier === 'multi' ? ' active' : ''}`}
                        >
                          {tiers.multi}
                        </div>
                      </div>
                    </div>

                    <div className="stock-card-stepper">
                      <button
                        type="button"
                        data-minus={k}
                        aria-label={'Quitar una unidad de ' + c.name}
                        onClick={() => handleAdjust(k, -1)}
                      >
                        −
                      </button>
                      <input
                        aria-label={c.name}
                        name={k}
                        type="number"
                        min="0"
                        max="500"
                        step="1"
                        value={qty}
                        onChange={(e) => {
                          setCounts((prev) => ({
                            ...prev,
                            [k]: Math.max(
                              0,
                              Math.min(500, Number(e.target.value) || 0)
                            ),
                          }));
                          setDraft(null);
                          setAutoCandidate(null);
                          setErrorMsg('');
                        }}
                      />
                      <button
                        type="button"
                        data-plus={k}
                        aria-label={'Añadir una unidad de ' + c.name}
                        onClick={() => handleAdjust(k, 1)}
                      >
                        +
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="inv-footer-bar">
              <span className="small-note">
                Carpas y mesas son independientes. El generador busca plazas
                bajo cubierta y conserva el vínculo de cada conjunto.
              </span>
              <button type="submit" className="dark">
                Revisar inventario
              </button>
            </div>
          </form>
        )}

        <div id="stock-next">
          {errorMsg && <p className="warning">{errorMsg}</p>}
          {draft && (
            <>
              <h3>2. Colocar</h3>
              <p>
                {draft.added} piezas nuevas · {draft.removed} retiradas ·{' '}
                {(draft.scene.pendingStock || []).length} pendientes de
                ubicación.
              </p>
              <button
                type="button"
                id="stock-manual"
                onClick={() => commitScene(draft.scene)}
              >
                Colocar yo las piezas
              </button>{' '}
              <button
                type="button"
                id="stock-auto"
                onClick={handleAutoPropose}
              >
                Proponer distribución
              </button>
              <div id="stock-preview">
                {autoCandidate && (
                  <>
                    <div
                      dangerouslySetInnerHTML={{
                        __html: batchMap(
                          autoCandidate.scene,
                          currentScene(),
                          currentMap()
                        ),
                      }}
                    />
                    <p>
                      {(autoCandidate.scene.pendingStock || []).length} piezas
                      sin ubicación. {autoCandidate.reason}
                    </p>
                    <button
                      type="button"
                      id="stock-use"
                      onClick={() => commitScene(autoCandidate.scene)}
                    >
                      Usar este plano
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      <form method="dialog" style={{marginTop: '10px'}}>
        <button type="submit">Cerrar</button>
      </form>
    </dialog>
  );
};
