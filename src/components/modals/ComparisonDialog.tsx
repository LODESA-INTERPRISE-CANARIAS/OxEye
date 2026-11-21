import React, {useEffect, useRef, useState} from 'react';
import {downloadFile} from '../../db/repository';
import {miniMap} from '../../engine/cartography/minimap';
import {EventEngine} from '../../engine/crowd/event-engine';
import {assessRisk} from '../../engine/emergency/risk';
import {phaseScene} from '../../engine/logistics/phases';
import {compare, type TrialResult} from '../../engine/planning/evaluator';
import {redesign} from '../../engine/planning/layout';
import {useProjectStore} from '../../store/useProjectStore';
import type {Scene, VenueMap} from '../../types';

interface RecoveryAlternative {
  source: Scene;
  next: Scene;
  beforeCritical: number;
  beforeTitles: string[];
  afterCritical: number;
  afterTitles: string[];
  desc: string;
}

function findRecoveryAlternative(
  source: Scene,
  map: VenueMap
): RecoveryAlternative | null {
  try {
    const baseEngine = new EventEngine(phaseScene(source, 'event'));
    const baseReport = assessRisk(source, baseEngine, {routes: true});
    const beforeCritical = baseReport.critical.length;
    if (!beforeCritical) return null;
    const beforeTitles = baseReport.critical.map((i) => i.title);
    const hasFireRouteBlock = baseReport.critical.some(
      (i) => i.id === 'route-fire'
    );

    let best: RecoveryAlternative | null = null;
    const evaluateCandidate = (cand: Scene, desc: string) => {
      try {
        const eng = new EventEngine(phaseScene(cand, 'event'));
        const rep = assessRisk(cand, eng, {routes: true});
        if (rep.critical.length < beforeCritical) {
          if (!best || rep.critical.length < best.afterCritical) {
            best = {
              source,
              next: cand,
              beforeCritical,
              beforeTitles,
              afterCritical: rep.critical.length,
              afterTitles: rep.critical.map((i) => i.title),
              desc,
            };
          }
        }
      } catch {
        // Ignorar candidatos inválidos
      }
    };

    // 1. Probar redistribuciones automáticas con pasillos más amplios (≥ 4 m)
    for (let strategy = 0; strategy < 4; strategy++) {
      const proposal = redesign(source, map, {
        onlyMove: true,
        space: 4,
        seed: (source.seed || 7) + strategy * 31,
        strategy,
      });
      if (proposal.moves.length) {
        const cand = structuredClone(source);
        const byId = new Map(proposal.moves.map((m) => [m.id, m]));
        for (const o of [...cand.base.booths, ...cand.infrastructure]) {
          const moved = byId.get(o.id);
          if (moved) Object.assign(o, moved);
        }
        evaluateCandidate(cand, proposal.reason);
        if (best && (best as RecoveryAlternative).afterCritical === 0) {
          return best;
        }
      }
    }

    // 2. Si el bloqueo es de aproximación de bomberos, probar también despliegue a pie
    if (hasFireRouteBlock && !source.fireFootAccess) {
      const cand = structuredClone(source);
      cand.fireFootAccess = true;
      evaluateCandidate(
        cand,
        'Habilitar despliegue a pie de bomberos desde la posición del camión'
      );
    }

    return best;
  } catch {
    return null;
  }
}

export interface ComparisonDialogProps {
  onSceneChanged: () => void;
}

/**
 * Modal dialog (`#comparison`) that evaluates 15 simulated minutes and compares
 * automated single-change improvements against the baseline scene.
 */
export const ComparisonDialog: React.FC<ComparisonDialogProps> = ({
  onSceneChanged,
}) => {
  const dlgRef = useRef<HTMLDialogElement | null>(null);
  const evaluatingRef = useRef(false);

  const activeModal = useProjectStore((s) => s.activeModal);
  const activeVenue = useProjectStore((s) => s.activeVenue);
  const currentScene = useProjectStore((s) => s.currentScene);
  const currentMap = useProjectStore((s) => s.currentMap);
  const setActiveModal = useProjectStore((s) => s.setActiveModal);
  const setPanel = useProjectStore((s) => s.setPanel);
  const updateScene = useProjectStore((s) => s.updateScene);
  const replaceScene = useProjectStore((s) => s.replaceScene);
  const showToast = useProjectStore((s) => s.showToast);

  const isOpen = activeModal === 'comparison';
  const [statusMsg, setStatusMsg] = useState('');
  const [recoveryResult, setRecoveryResult] =
    useState<RecoveryAlternative | null>(null);
  const [evalResult, setEvalResult] = useState<{
    source: Scene;
    next: Scene;
    seed: number;
    before: TrialResult;
    best?: {
      change: {
        kind: string;
        id: string;
        desc: string;
        patch: Record<string, unknown>;
      };
      after: TrialResult;
      gain: number;
    };
  } | null>(null);

  useEffect(() => {
    const dlg = dlgRef.current;
    if (!dlg) return;
    if (isOpen && !dlg.open) {
      dlg.showModal();
      if (!evaluatingRef.current) {
        evaluatingRef.current = true;
        setEvalResult(null);
        setRecoveryResult(null);
        setStatusMsg(
          'Evaluando 15 minutos simulados por alternativa con la misma semilla…'
        );
        const source = structuredClone(currentScene());
        const map = currentMap();
        const stamp = JSON.stringify(source);
        const site = activeVenue;
        const history = source.learning || [];

        compare(source, history, () => new Promise((r) => setTimeout(r, 0)))
          .then((result) => {
            if (
              site !== useProjectStore.getState().activeVenue ||
              JSON.stringify(useProjectStore.getState().currentScene()) !==
                stamp
            ) {
              setStatusMsg('El escenario cambió. Repite la comparación.');
              return;
            }
            const best = result.alternatives[0];
            const next = structuredClone(source);
            if (best) {
              const target = [
                ...next.base.booths,
                ...next.infrastructure,
              ].find((o) => o.id === best.change.id);
              if (target) Object.assign(target, best.change.patch);
            }
            updateScene((sc) => {
              sc.learning = [
                ...history,
                ...result.alternatives.map((a) => ({
                  kind: a.change.kind,
                  gain: a.gain,
                })),
              ].slice(-60);
              sc.lastAudit = {...result, date: new Date().toISOString()};
            });
            setStatusMsg('');
            setEvalResult({
              source,
              next,
              seed: result.seed,
              before: result.before,
              best,
            });
          })
          .catch((err) => {
            const recovery = findRecoveryAlternative(source, map);
            if (recovery) {
              setStatusMsg('');
              setRecoveryResult(recovery);
            } else {
              setStatusMsg(
                'No se pudo generar una redistribución automática sin bloqueos: ' +
                  (err as Error).message
              );
            }
          })
          .finally(() => {
            evaluatingRef.current = false;
          });
      }
    } else if (!isOpen && dlg.open) {
      dlg.close();
    }
  }, [isOpen, activeVenue, currentScene, updateScene]);

  const metricsText = (r: TrialResult) =>
    `Llegadas ${r.arrivals} · atendidos ${r.served} · abandonos ${r.abandoned} · puntuación de fallos ${r.score}`;

  const handleChooseBest = () => {
    if (!evalResult?.best) return;
    const best = evalResult.best;
    updateScene((sc) => {
      const target = [...sc.base.booths, ...sc.infrastructure].find(
        (o) => o.id === best.change.id
      );
      if (target) Object.assign(target, best.change.patch);
    }, true);
    setActiveModal(null);
    onSceneChanged();
  };

  return (
    <dialog
      id="comparison"
      ref={dlgRef}
      onClick={(e) => {
        if (e.target === dlgRef.current) setActiveModal(null);
      }}
      onClose={() => {
        if (isOpen) setActiveModal(null);
      }}
    >
      <h2>Evaluación automática de mapas</h2>
      <div id="comparison-body">
        {statusMsg && <p>{statusMsg}</p>}
        {!evalResult &&
          !recoveryResult &&
          statusMsg.startsWith('No se pudo generar') && (
            <p style={{marginTop: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap'}}>
              <button
                type="button"
                className="dark"
                onClick={() => setActiveModal('risk')}
              >
                Revisar riesgos y corregir bloqueos
              </button>
              <button
                type="button"
                className="quiet"
                onClick={() => {
                  setPanel('design');
                  setActiveModal(null);
                }}
              >
                Ir al plano a despejar pasos
              </button>
            </p>
          )}
        {recoveryResult && (
          <>
            <p>
              El mapa actual tiene{' '}
              <b>
                {recoveryResult.beforeCritical}{' '}
                {recoveryResult.beforeCritical === 1 ? 'bloqueo' : 'bloqueos'}
              </b>{' '}
              que impiden simular. Se ha encontrado una distribución alternativa
              que{' '}
              {recoveryResult.afterCritical === 0
                ? 'resuelve todos los bloqueos.'
                : `reduce los bloqueos a ${recoveryResult.afterCritical}.`}
            </p>
            <h3>Tu mapa original ({recoveryResult.beforeCritical} bloqueos)</h3>
            <div
              dangerouslySetInnerHTML={{
                __html: miniMap(
                  recoveryResult.source,
                  currentScene(),
                  currentMap()
                ),
              }}
            />
            <p className="small-note">{recoveryResult.beforeTitles.join(' · ')}</p>
            <h3>
              Distribución alternativa ({recoveryResult.afterCritical} bloqueos)
            </h3>
            <div
              dangerouslySetInnerHTML={{
                __html: miniMap(
                  recoveryResult.next,
                  currentScene(),
                  currentMap()
                ),
              }}
            />
            <p>{recoveryResult.desc}</p>
            {recoveryResult.afterTitles.length > 0 && (
              <p className="small-note">
                Pendiente: {recoveryResult.afterTitles.join(' · ')}
              </p>
            )}
            <div style={{marginTop: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap'}}>
              <button
                type="button"
                id="apply-recovery"
                className="dark"
                onClick={() => {
                  replaceScene(recoveryResult.next, true);
                  setActiveModal(null);
                  onSceneChanged();
                  showToast(
                    'Distribución alternativa aplicada (Ctrl+Z para deshacer)'
                  );
                }}
              >
                Aplicar esta distribución
              </button>
              <button
                type="button"
                className="quiet"
                onClick={() => setActiveModal('risk')}
              >
                Volver a riesgos
              </button>
            </div>
          </>
        )}
        {evalResult && (
          <>
            <p>
              Ensayo de 15 min · semilla {evalResult.seed}. Puntuación =
              episodios + 2 × abandonos + 3 × entradas bloqueadas.
            </p>
            <h3>Tu mapa original</h3>
            <div
              dangerouslySetInnerHTML={{
                __html: miniMap(
                  evalResult.source,
                  currentScene(),
                  currentMap(),
                  evalResult.best?.change.id
                ),
              }}
            />
            <p>{metricsText(evalResult.before)}</p>
            {evalResult.best ? (
              <>
                <h3>Propuesta comparada</h3>
                <div
                  dangerouslySetInnerHTML={{
                    __html: miniMap(
                      evalResult.next,
                      currentScene(),
                      currentMap(),
                      evalResult.best.change.id
                    ),
                  }}
                />
                <p>{evalResult.best.change.desc}</p>
                <p>{metricsText(evalResult.best.after)}</p>
                <b>
                  {evalResult.best.gain > 0
                    ? `Mejora medida de ${evalResult.best.gain} puntos`
                    : evalResult.best.gain === 0
                      ? 'Sin mejora medida'
                      : 'Resultado peor que el original'}
                </b>
              </>
            ) : (
              <p>
                Sin cambios candidatos para los fallos observados en este
                intervalo.
              </p>
            )}
            <p>
              El historial de este recinto prioriza los tipos de cambio que
              redujeron los fallos en ensayos anteriores.
            </p>
            <button
              type="button"
              id="audit-download"
              onClick={() =>
                downloadFile(
                  'Autoinforme_Ojo_de_Buey.json',
                  JSON.stringify(currentScene().lastAudit, null, 2)
                )
              }
            >
              Descargar autoinforme
            </button>{' '}
            <button
              type="button"
              id="keep"
              onClick={() => setActiveModal(null)}
            >
              Conservar original
            </button>{' '}
            {evalResult.best && (
              <button type="button" id="choose" onClick={handleChooseBest}>
                Usar propuesta
              </button>
            )}
          </>
        )}
      </div>
      <form method="dialog" style={{marginTop: '14px'}}>
        <button type="submit" id="comparison-close">
          Cerrar
        </button>
      </form>
    </dialog>
  );
};
