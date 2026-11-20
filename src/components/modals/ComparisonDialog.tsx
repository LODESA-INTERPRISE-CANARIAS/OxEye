import React, {useEffect, useRef, useState} from 'react';
import {downloadFile} from '../../db/repository';
import {miniMap} from '../../engine/cartography/minimap';
import {compare, type TrialResult} from '../../engine/planning/evaluator';
import {useProjectStore} from '../../store/useProjectStore';
import type {Scene} from '../../types';

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
  const updateScene = useProjectStore((s) => s.updateScene);

  const isOpen = activeModal === 'comparison';
  const [statusMsg, setStatusMsg] = useState('');
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
        setStatusMsg(
          'Evaluando 15 minutos simulados por alternativa con la misma semilla…'
        );
        const source = structuredClone(currentScene());
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
            setStatusMsg('Evaluación interrumpida: ' + (err as Error).message);
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
      onClose={() => {
        if (isOpen) setActiveModal(null);
      }}
    >
      <h2>Evaluación automática de mapas</h2>
      <div id="comparison-body">
        {statusMsg && <p>{statusMsg}</p>}
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
    </dialog>
  );
};
