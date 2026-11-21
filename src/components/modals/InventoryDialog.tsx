import React, {useEffect, useRef, useState} from 'react';
import {CATALOG, VENUES} from '../../data/catalog';
import {inventoryInfo} from '../../data/site-reference';
import {batchMap} from '../../engine/cartography/minimap';
import {phaseScene} from '../../engine/logistics/phases';
import {
  arrangeStock,
  classify,
  reconcile,
} from '../../engine/planning/inventory';
import {redesign} from '../../engine/planning/layout';
import {useProjectStore} from '../../store/useProjectStore';
import type {Scene} from '../../types';

export interface InventoryDialogProps {
  onSceneCommitted: () => void;
}

/**
 * Modal dialog (`#inventory-dialog`) for managing project stock quantities and auto-distributing items.
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

  const isOpen = activeModal === 'inventory';
  const entries = Object.entries(CATALOG);

  const [counts, setCounts] = useState<Record<string, number>>({});
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
      setDraft(null);
      setAutoCandidate(null);
      setErrorMsg('');
      dlg.showModal();
    } else if (!isOpen && dlg.open) {
      dlg.close();
    }
  }, [isOpen, currentScene]);

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
      setDraft(res);
    } catch (err) {
      setDraft(null);
      setErrorMsg((err as Error).message);
    }
  };

  const commitScene = (scene: Scene) => {
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
        <h2>1. Lo que tengo</h2>
        <p>
          {currentMap().customLocation?.label || VENUES[activeVenue].name} ·
          Cantidades totales del proyecto. Los elementos retirados se indican
          antes de confirmar.
        </p>
        {(() => {
          const legacy = currentScene().infrastructure.filter((o) =>
            ['cleaning', 'prep', 'assembly', 'dismantle'].includes(o.kind)
          );
          return legacy.length > 0 ? (
            <>
              <p>
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
            </>
          ) : null;
        })()}
        <form id="stock-form" onSubmit={handleReviewSubmit}>
          <div className="stock-list">
            {entries.map(([k, c]) => (
              <label key={k}>
                <span>
                  {inventoryInfo[k]?.[0] || c.name}
                  <small className="inventory-explanation">
                    {inventoryInfo[k]?.[1] ||
                      `${c.role === 'furniture' ? 'Mobiliario' : 'Pieza física'} · ${c.w} × ${c.h} metros; dimensiones editables en el plano.`}
                  </small>
                </span>
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
                  value={counts[k] ?? 0}
                  onChange={(e) => {
                    setCounts((prev) => ({
                      ...prev,
                      [k]: Number(e.target.value),
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
              </label>
            ))}
          </div>
          <p>
            Carpas y mesas son independientes. El generador busca plazas bajo
            cubierta y conserva el vínculo de cada conjunto.
          </p>
          <button type="submit" className="dark">
            Revisar inventario
          </button>
        </form>
        <div id="stock-next">
          {errorMsg && <p>{errorMsg}</p>}
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
      <form method="dialog">
        <button type="submit">Cerrar</button>
      </form>
    </dialog>
  );
};
