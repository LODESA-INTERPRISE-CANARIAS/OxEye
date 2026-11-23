import React, {useEffect, useRef, useState} from 'react';
import {downloadFile} from '../../db/repository';
import {miniMap} from '../../engine/cartography/minimap';
import {EventEngine} from '../../engine/crowd/event-engine';
import {assessRisk} from '../../engine/emergency/risk';
import {TOPICS} from '../../engine/experience/experience-monitor';
import {phaseScene} from '../../engine/logistics/phases';
import {
  compare,
  computeSceneSpatialMetrics,
  type ComparisonChange,
  type SceneSpatialMetrics,
  type TrialResult,
} from '../../engine/planning/evaluator';
import {redesign} from '../../engine/planning/layout';
import {useProjectStore} from '../../store/useProjectStore';
import type {Scene, VenueMap} from '../../types';

const fmt = (n: number | null | undefined, unit = ''): string => {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const s = Number(n).toLocaleString('es-ES', {maximumFractionDigits: 2});
  return unit ? `${s} ${unit}` : s;
};

const fmtDelta = (
  delta: number,
  lowerIsBetter: boolean,
  unit = ''
): {text: string; color: string} => {
  if (Math.abs(delta) < 0.005) return {text: 'Sin cambio', color: '#64748b'};
  const sign = delta > 0 ? '+' : '';
  const good = lowerIsBetter ? delta < 0 : delta > 0;
  const s = `${sign}${Number(delta).toLocaleString('es-ES', {
    maximumFractionDigits: 2,
  })}${unit ? ' ' + unit : ''}`;
  return {text: s, color: good ? '#15803d' : '#b91c1c'};
};

interface RecoveryAlternative {
  source: Scene;
  next: Scene;
  beforeCritical: number;
  beforeTitles: string[];
  afterCritical: number;
  afterTitles: string[];
  beforeSpatial: SceneSpatialMetrics;
  afterSpatial: SceneSpatialMetrics;
  movedCount: number;
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

    const beforeSpatial = computeSceneSpatialMetrics(source, map);
    let best: RecoveryAlternative | null = null;
    const evaluateCandidate = (cand: Scene, desc: string, movedCount = 0) => {
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
              beforeSpatial,
              afterSpatial: computeSceneSpatialMetrics(cand, map),
              movedCount,
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
        evaluateCandidate(cand, proposal.reason, proposal.moves.length);
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
      change: ComparisonChange;
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
              if (best.change.moves?.length) {
                const byId = new Map(best.change.moves.map((mv) => [mv.id, mv]));
                for (const o of [...next.base.booths, ...next.infrastructure]) {
                  const mv = byId.get(o.id);
                  if (mv) Object.assign(o, mv);
                }
              } else if (best.change.addItem) {
                next.infrastructure.push(structuredClone(best.change.addItem));
              } else {
                const target = [
                  ...next.base.booths,
                  ...next.infrastructure,
                ].find((o) => o.id === best.change.id);
                if (target) Object.assign(target, best.change.patch);
              }
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

  const handleChooseBest = () => {
    if (!evalResult?.best) return;
    const best = evalResult.best;
    updateScene((sc) => {
      if (best.change.moves?.length) {
        const byId = new Map(best.change.moves.map((mv) => [mv.id, mv]));
        for (const o of [...sc.base.booths, ...sc.infrastructure]) {
          const mv = byId.get(o.id);
          if (mv) Object.assign(o, mv);
        }
      } else if (best.change.addItem) {
        sc.infrastructure.push(structuredClone(best.change.addItem));
      } else {
        const target = [...sc.base.booths, ...sc.infrastructure].find(
          (o) => o.id === best.change.id
        );
        if (target) Object.assign(target, best.change.patch);
      }
    }, true);
    setActiveModal(null);
    onSceneChanged();
    showToast('Propuesta aplicada al plano (Ctrl+Z para deshacer)');
  };

  const renderMetricComparison = (
    before: TrialResult,
    after: TrialResult,
    change: ComparisonChange
  ) => {
    const allTopics = Array.from(
      new Set([...Object.keys(before.counts), ...Object.keys(after.counts)])
    );
    const topicDiffs = allTopics
      .map((k) => ({
        key: k,
        label: TOPICS[k] || k,
        b: before.counts[k] || 0,
        a: after.counts[k] || 0,
        diff: (after.counts[k] || 0) - (before.counts[k] || 0),
      }))
      .filter((t) => t.b > 0 || t.a > 0);

    const rows: Array<{
      label: string;
      b: string;
      a: string;
      delta: {text: string; color: string};
    }> = [
      {
        label: 'Puntuación de fallos (menor = mejor)',
        b: String(before.score),
        a: String(after.score),
        delta: fmtDelta(after.score - before.score, true, 'pts'),
      },
      {
        label: 'Episodios de fricción detectados',
        b: String(before.episodes),
        a: String(after.episodes),
        delta: fmtDelta(after.episodes - before.episodes, true),
      },
      {
        label: 'Atendidos / Abandonos / Entradas bloq.',
        b: `${before.served} / ${before.abandoned} / ${before.entryBlocked}`,
        a: `${after.served} / ${after.abandoned} / ${after.entryBlocked}`,
        delta: fmtDelta(
          after.abandoned -
            before.abandoned +
            (after.entryBlocked - before.entryBlocked),
          true,
          'fallos'
        ),
      },
      {
        label: 'Espera media / Tiempo atascado',
        b: `${before.avgWaitSec} s / ${before.stuckSeconds} s`,
        a: `${after.avgWaitSec} s / ${after.stuckSeconds} s`,
        delta: fmtDelta(after.avgWaitSec - before.avgWaitSec, true, 's espera'),
      },
      {
        label: 'Distanciamiento mín. entre elementos',
        b: fmt(before.spatial.minClearanceMeters, 'm'),
        a: fmt(after.spatial.minClearanceMeters, 'm'),
        delta:
          before.spatial.minClearanceMeters !== null &&
          after.spatial.minClearanceMeters !== null
            ? fmtDelta(
                after.spatial.minClearanceMeters -
                  before.spatial.minClearanceMeters,
                false,
                'm'
              )
            : {text: '—', color: '#64748b'},
      },
      {
        label: 'Separación media al vecino más cercano',
        b: fmt(before.spatial.avgNearestSpacingMeters, 'm'),
        a: fmt(after.spatial.avgNearestSpacingMeters, 'm'),
        delta:
          before.spatial.avgNearestSpacingMeters !== null &&
          after.spatial.avgNearestSpacingMeters !== null
            ? fmtDelta(
                after.spatial.avgNearestSpacingMeters -
                  before.spatial.avgNearestSpacingMeters,
                false,
                'm'
              )
            : {text: '—', color: '#64748b'},
      },
      {
        label: 'Superficie de servicio / refugio',
        b: `${fmt(before.spatial.serviceSurfaceM2, 'm²')} / ${fmt(before.spatial.shelterSurfaceM2, 'm²')}`,
        a: `${fmt(after.spatial.serviceSurfaceM2, 'm²')} / ${fmt(after.spatial.shelterSurfaceM2, 'm²')}`,
        delta: change.addedSurfaceM2
          ? {text: `+${fmt(change.addedSurfaceM2, 'm²')} añadidos`, color: '#15803d'}
          : {text: '0 m² añadidos', color: '#64748b'},
      },
    ];

    const changedTopics = topicDiffs.filter((t) => t.diff !== 0);
    const spatialSummary =
      change.spatialKind === 'nueva_superficie'
        ? `Añade una nueva superficie no contemplada (+${fmt(change.addedSurfaceM2, 'm²')}) para cubrir necesidades detectadas de los asistentes.`
        : change.spatialKind === 'espaciado'
          ? `Modifica la posición en el plano${
              change.moveDistanceMeters
                ? ` (${fmt(change.moveDistanceMeters, 'm')})`
                : ''
            } para mejorar el distanciamiento entre elementos (mín. ${fmt(before.spatial.minClearanceMeters, 'm')} → ${fmt(after.spatial.minClearanceMeters, 'm')}; media ${fmt(before.spatial.avgNearestSpacingMeters, 'm')} → ${fmt(after.spatial.avgNearestSpacingMeters, 'm')}). No añade nuevas superficies (0 m²).`
          : `Ajuste operativo/de gestión sobre un elemento existente: no altera el distanciamiento entre elementos (mín. ${fmt(before.spatial.minClearanceMeters, 'm')}, media ${fmt(before.spatial.avgNearestSpacingMeters, 'm')}) ni añade nuevas superficies (0 m²).`;

    return (
      <div style={{margin: '10px 0 12px'}}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: '0.84rem',
            marginBottom: '10px',
          }}
        >
          <thead>
            <tr style={{borderBottom: '1px solid var(--line-strong)', textAlign: 'left'}}>
              <th style={{padding: '5px 6px'}}>Métrica</th>
              <th style={{padding: '5px 6px'}}>Original</th>
              <th style={{padding: '5px 6px'}}>Propuesta</th>
              <th style={{padding: '5px 6px'}}>Diferencia</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} style={{borderBottom: '1px solid var(--line)'}}>
                <td style={{padding: '5px 6px'}}>{r.label}</td>
                <td style={{padding: '5px 6px'}}>{r.b}</td>
                <td style={{padding: '5px 6px'}}>{r.a}</td>
                <td
                  style={{
                    padding: '5px 6px',
                    fontWeight: 600,
                    color: r.delta.color,
                  }}
                >
                  {r.delta.text}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div
          style={{
            background: 'var(--purple-soft)',
            borderLeft: '3px solid var(--purple)',
            color: 'var(--ink)',
            padding: '8px 10px',
            borderRadius: '6px',
            fontSize: '0.84rem',
            lineHeight: 1.45,
          }}
        >
          <b>¿Por qué cambia la puntuación?</b>{' '}
          {changedTopics.length > 0 ? (
            <>
              Variación por tipo de episodio:{' '}
              {changedTopics
                .map(
                  (t) =>
                    `${t.label} (${t.b} → ${t.a}, ${t.diff > 0 ? '+' : ''}${t.diff})`
                )
                .join(' · ')}
              .
            </>
          ) : (
            <>Sin variación en el conteo de episodios por categoría.</>
          )}
          <div style={{marginTop: '4px'}}>
            <b>Impacto espacial y superficies:</b> {spatialSummary}
          </div>
        </div>
      </div>
    );
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
        {currentScene().objectives && (
          <p className="small-note">
            Evaluando respecto a objetivos SMART:{' '}
            <b>
              {currentScene()
                .objectives!.profile.highlights.join(' · ') ||
                currentScene().objectives!.profile.activeAxes.join(', ')}
            </b>{' '}
            ·{' '}
            <button
              type="button"
              className="quiet"
              onClick={() => setActiveModal('laboratory')}
            >
              Comparar las 3 estrategias completas
            </button>
          </p>
        )}
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
            <p className="small-note">
              <b>Distanciamiento entre elementos:</b> separación mínima{' '}
              {fmt(recoveryResult.beforeSpatial.minClearanceMeters, 'm')} →{' '}
              {fmt(recoveryResult.afterSpatial.minClearanceMeters, 'm')} ·
              separación media{' '}
              {fmt(recoveryResult.beforeSpatial.avgNearestSpacingMeters, 'm')} →{' '}
              {fmt(recoveryResult.afterSpatial.avgNearestSpacingMeters, 'm')}
              {recoveryResult.movedCount > 0
                ? ` · ${recoveryResult.movedCount} elemento(s) reubicados · 0 m² añadidos.`
                : ' · sin reubicar mobiliario.'}
            </p>
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
                <p>
                  <b>Cambio propuesto:</b> {evalResult.best.change.desc}
                </p>
                {renderMetricComparison(
                  evalResult.before,
                  evalResult.best.after,
                  evalResult.best.change
                )}
                <b>
                  {evalResult.best.gain > 0
                    ? `Mejora medida de ${evalResult.best.gain} puntos`
                    : evalResult.best.gain === 0
                      ? 'Sin mejora medida'
                      : 'Resultado peor que el original'}
                </b>
              </>
            ) : (
              <>
                <p>
                  Llegadas {evalResult.before.arrivals} · atendidos{' '}
                  {evalResult.before.served} · abandonos{' '}
                  {evalResult.before.abandoned} · episodios{' '}
                  {evalResult.before.episodes} · puntuación{' '}
                  {evalResult.before.score}.
                </p>
                <p>
                  Sin cambios candidatos para los fallos observados en este
                  intervalo.
                </p>
              </>
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
