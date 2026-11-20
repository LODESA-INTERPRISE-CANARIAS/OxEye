import React, {useEffect, useRef, useState} from 'react';
import {downloadFile} from '../../db/repository';
import {batchMap} from '../../engine/cartography/minimap';
import {evaluateBatch, goals} from '../../engine/planning/batch';
import {useProjectStore} from '../../store/useProjectStore';
import type {BatchEvaluationRow, Scene} from '../../types';

export interface LaboratoryDialogProps {
  layoutSpace: number;
  onAdoptScene: () => void;
}

/**
 * Modal dialog (`#laboratory-dialog`) for multi-configuration batch evaluation and ranking.
 */
export const LaboratoryDialog: React.FC<LaboratoryDialogProps> = ({
  layoutSpace,
  onAdoptScene,
}) => {
  const dlgRef = useRef<HTMLDialogElement | null>(null);
  const batchStopRef = useRef(false);
  const baselineRef = useRef('');
  const siteRef = useRef('');

  const activeModal = useProjectStore((s) => s.activeModal);
  const activeVenue = useProjectStore((s) => s.activeVenue);
  const currentScene = useProjectStore((s) => s.currentScene);
  const currentMap = useProjectStore((s) => s.currentMap);
  const setActiveModal = useProjectStore((s) => s.setActiveModal);
  const updateScene = useProjectStore((s) => s.updateScene);
  const replaceScene = useProjectStore((s) => s.replaceScene);
  const showToast = useProjectStore((s) => s.showToast);

  const isOpen = activeModal === 'laboratory';
  const s = currentScene();

  const [weights, setWeights] = useState({
    comfort: 50,
    queues: 50,
    emergency: 50,
    experience: 50,
  });
  const [citizenWishes, setCitizenWishes] = useState('');
  const [batchCount, setBatchCount] = useState(3);
  const [batchMinutes, setBatchMinutes] = useState(15);
  const [batchRain, setBatchRain] = useState(true);
  const [batchBusy, setBatchBusy] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [livePreview, setLivePreview] = useState<{
    scene: Scene;
    people: Array<{x: number; y: number}>;
  } | null>(null);
  const [report, setReport] = useState<BatchEvaluationRow[]>([]);

  useEffect(() => {
    const dlg = dlgRef.current;
    if (!dlg) return;
    if (isOpen && !dlg.open) {
      if (!batchBusy) {
        const scene = currentScene();
        const eg = scene.eventGoals || [];
        setWeights({
          comfort: eg.length
            ? eg.includes('comfort') || eg.includes('family')
              ? 80
              : 30
            : 50,
          queues: eg.length ? 80 : 50,
          emergency: eg.length ? 80 : 50,
          experience: eg.length
            ? eg.includes('local') ||
              eg.includes('culture') ||
              eg.includes('music') ||
              eg.includes('food')
              ? 80
              : 30
            : 50,
        });
        setCitizenWishes(scene.citizenWishes || '');
        setReport([]);
        setStatusText('');
        setLivePreview(null);
      }
      dlg.showModal();
    } else if (!isOpen && dlg.open) {
      dlg.close();
    }
  }, [isOpen, batchBusy, currentScene]);

  const handleStart = async () => {
    if (batchBusy) return;
    if (!Object.values(weights).some(Boolean)) {
      showToast('Da prioridad a algún objetivo.');
      return;
    }
    updateScene((sc) => {
      sc.citizenWishes = citizenWishes;
    });
    const source = structuredClone(currentScene());
    baselineRef.current = JSON.stringify(source);
    siteRef.current = activeVenue;
    batchStopRef.current = false;
    setBatchBusy(true);

    try {
      const finalReport = await evaluateBatch(
        source,
        currentMap(),
        {
          count: batchCount,
          minutes: batchMinutes,
          rain: batchRain,
          space: layoutSpace,
          weights,
        },
        (u) => {
          if (u.complete && u.ranking) {
            setReport([...u.ranking]);
          }
          if (u.skipped !== undefined) {
            setStatusText(
              'No se encontró un diseño distinto para la alternativa ' +
                u.skipped
            );
          } else if (
            u.index !== undefined &&
            u.scene &&
            u.people &&
            u.seconds !== undefined
          ) {
            setStatusText(
              `Configuración ${u.index + 1} · ${u.weather} · ${Math.floor(u.seconds / 60)} min`
            );
            setLivePreview({scene: u.scene, people: u.people});
          }
        },
        () => batchStopRef.current
      );
      setReport(finalReport);
      setStatusText(
        `${finalReport.length} configuraciones evaluadas${
          batchStopRef.current ? ' · detenido' : ' · completado'
        }`
      );
    } catch (err) {
      setStatusText('No pudo completarse: ' + (err as Error).message);
    } finally {
      setBatchBusy(false);
    }
  };

  const handleAdopt = (rowId: number) => {
    if (batchBusy) {
      showToast('Espera a que termine la comparación.');
      return;
    }
    if (
      siteRef.current !== activeVenue ||
      JSON.stringify(currentScene()) !== baselineRef.current
    ) {
      showToast('El proyecto cambió. Repite la evaluación.');
      return;
    }
    const row = report.find((r) => r.id === rowId);
    if (!row) return;
    replaceScene(row.scene, true);
    setActiveModal(null);
    onAdoptScene();
  };

  return (
    <dialog
      id="laboratory-dialog"
      ref={dlgRef}
      onClose={() => {
        if (isOpen) setActiveModal(null);
      }}
    >
      <div id="laboratory-body">
        <h2>Lista de deseos</h2>
        <p>
          Elige qué pesa más en la comparación. Los resultados describen este
          modelo y este intervalo.
        </p>
        {(Object.entries(goals) as Array<[keyof typeof weights, string]>).map(
          ([k, label]) => (
            <label key={k}>
              {label}{' '}
              <input
                type="range"
                data-goal={k}
                min="0"
                max="100"
                value={weights[k]}
                onChange={(e) =>
                  setWeights((prev) => ({
                    ...prev,
                    [k]: Number(e.target.value),
                  }))
                }
              />
            </label>
          )
        )}
        <label>
          Deseos de la ciudadanía
          <textarea
            id="citizen-wishes"
            rows={3}
            maxLength={2000}
            value={citizenWishes}
            onChange={(e) => setCitizenWishes(e.target.value)}
          />
        </label>
        <h3>Lista de recursos</h3>
        <p>
          {s.base.booths.filter((o) => o.type === 'food').length} ofertas de
          comida ·{' '}
          {s.infrastructure.filter((o) => o.kind === 'picnic').length} mesas ·{' '}
          {s.infrastructure.filter((o) => o.role === 'cover').length} cubiertas
        </p>
        <label>
          Configuraciones solicitadas
          <select
            id="batch-count"
            value={batchCount}
            onChange={(e) => setBatchCount(Number(e.target.value))}
          >
            <option value={3}>3</option>
            <option value={6}>6</option>
            <option value={10}>10</option>
          </select>
        </label>
        <label>
          Minutos por ensayo
          <select
            id="batch-minutes"
            value={batchMinutes}
            onChange={(e) => setBatchMinutes(Number(e.target.value))}
          >
            <option value={15}>15</option>
            <option value={30}>30</option>
            <option value={60}>60</option>
          </select>
        </label>
        <label>
          <input
            id="batch-rain"
            type="checkbox"
            checked={batchRain}
            onChange={(e) => setBatchRain(e.target.checked)}
          />{' '}
          Repetir cada diseño con lluvia
        </label>
        <p>
          Caída, corte, incendio y conflicto se provocan por separado dentro de
          cada ensayo. Una incidencia sin objetivo compatible figura como prueba
          pendiente. Las alternativas conservan el inventario.
        </p>
        <button
          type="button"
          id="batch-start"
          className="dark"
          disabled={batchBusy}
          onClick={handleStart}
        >
          Comparar configuraciones
        </button>{' '}
        <button
          type="button"
          id="batch-stop"
          onClick={() => {
            batchStopRef.current = true;
          }}
        >
          Detener
        </button>{' '}
        <button
          type="button"
          id="batch-export"
          disabled={!report.length}
          onClick={() =>
            downloadFile(
              'Ranking_Ojo_de_Buey.json',
              JSON.stringify(
                report.map(({scene: _sc, preview: _pr, ...row}) => row),
                null,
                2
              )
            )
          }
        >
          Exportar ranking
        </button>
        <p id="batch-status">{statusText}</p>
        {livePreview && (
          <div
            id="batch-live"
            dangerouslySetInnerHTML={{
              __html: batchMap(
                livePreview.scene,
                currentScene(),
                currentMap(),
                livePreview.people
              ),
            }}
          />
        )}
        <div id="batch-cards">
          {report.map((r, i) => {
            const sortedAvg = Object.entries(r.averages).sort(
              (a, b) => b[1] - a[1]
            );
            const bestGoal = goals[sortedAvg[0][0]];
            const worstGoal = goals[sortedAvg[sortedAvg.length - 1][0]];
            return (
              <article key={r.id} className="batch-card">
                <h3>
                  {i + 1}. {r.name} · {r.score.toFixed(1)}/100
                </h3>
                <div
                  dangerouslySetInnerHTML={{
                    __html: batchMap(
                      r.scene,
                      currentScene(),
                      currentMap(),
                      r.preview
                    ),
                  }}
                />
                <p>
                  {Object.entries(r.averages)
                    .map(([k, v]) => `${goals[k]} ${v.toFixed(0)}/100`)
                    .join(' · ')}
                </p>
                <p>
                  <b>Mejor puntuación</b> {bestGoal} ·{' '}
                  <b>Principal margen de mejora</b> {worstGoal}
                </p>
                {r.runs.map((run, idx) => (
                  <p key={idx}>
                    {run.weather === 'rain' ? 'Lluvia' : 'Sin lluvia'} ·{' '}
                    {run.arrivals} llegadas · {run.abandoned} abandonos ·{' '}
                    {run.standing} comidas de pie · {run.completed}/4
                    incidencias resueltas · {run.missing} pruebas sin objetivo
                  </p>
                ))}
                <button
                  type="button"
                  data-adopt={r.id}
                  onClick={() => handleAdopt(r.id)}
                >
                  Usar esta configuración
                </button>
              </article>
            );
          })}
        </div>
      </div>
      <form method="dialog">
        <button type="submit">Cerrar</button>
      </form>
    </dialog>
  );
};
