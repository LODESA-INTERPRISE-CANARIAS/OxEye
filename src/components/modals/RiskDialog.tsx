import React, {useEffect, useRef, useState} from 'react';
import {downloadFile} from '../../db/repository';
import {percent} from '../../engine/cartography/geometry';
import {EventEngine} from '../../engine/crowd/event-engine';
import {buildGrid} from '../../engine/crowd/grid-flow';
import {
  RESPONSE_PROFILES,
  ResponseSimulation,
} from '../../engine/emergency/response-model';
import {
  assessRisk,
  poissonTail,
  requiredStaff,
  resultHTML,
  type RiskAssessmentReport,
  safetyFingerprint,
} from '../../engine/emergency/risk';
import {
  resolveRiskGuide,
  type RiskGuideAction,
} from '../../engine/emergency/risk-guidance';
import {ExperienceMonitor} from '../../engine/experience/experience-monitor';
import {phaseScene} from '../../engine/logistics/phases';
import {useProjectStore} from '../../store/useProjectStore';
import {PostSimDiagnosticsView} from './PostSimDiagnosticsView';

export interface RiskDialogProps {
  engine: EventEngine | null;
  safetyStop: boolean;
  customReport: RiskAssessmentReport | null;
  onClearCustomReport: () => void;
  onSceneChanged: () => void;
  onReproduceSeed?: (seed: number) => void;
}

/**
 * Modal dialog (`#risk-dialog`) for pre-flight and live risk assessment, statistical hypotheses, and trial cancellation review.
 */
export const RiskDialog: React.FC<RiskDialogProps> = ({
  engine,
  safetyStop,
  customReport,
  onClearCustomReport,
  onSceneChanged,
  onReproduceSeed,
}) => {
  const dlgRef = useRef<HTMLDialogElement | null>(null);
  const activeModal = useProjectStore((s) => s.activeModal);
  const currentScene = useProjectStore((s) => s.currentScene);
  const activeRunSeed = useProjectStore((s) => s.activeRunSeed);
  const simSeedMode = useProjectStore((s) => s.simSeedMode);
  const setActiveModal = useProjectStore((s) => s.setActiveModal);
  const setPanel = useProjectStore((s) => s.setPanel);
  const setTool = useProjectStore((s) => s.setTool);
  const setXrayVisible = useProjectStore((s) => s.setXrayVisible);
  const locateOnMap = useProjectStore((s) => s.locateOnMap);
  const updateScene = useProjectStore((s) => s.updateScene);
  const showToast = useProjectStore((s) => s.showToast);

  const isOpen = activeModal === 'risk';
  const s = currentScene();

  const [medicalRate, setMedicalRate] = useState<string>('');
  const [source, setSource] = useState<string>('Supuesto sin calibrar');
  const [autoRate, setAutoRate] = useState<number>(120);
  const [maxWaitSeconds, setMaxWaitSeconds] = useState<number>(120);
  const [routeReport, setRouteReport] = useState<RiskAssessmentReport | null>(
    null
  );

  useEffect(() => {
    const dlg = dlgRef.current;
    if (!dlg) return;
    if (isOpen && !dlg.open) {
      const sc = currentScene();
      setMedicalRate(
        sc.riskInputs?.medicalRate != null
          ? String(sc.riskInputs.medicalRate)
          : ''
      );
      setSource(sc.riskInputs?.source || 'Supuesto sin calibrar');
      setAutoRate(Number(sc.riskInputs?.autoRate ?? 120));
      setMaxWaitSeconds(Number(sc.riskInputs?.maxWaitSeconds ?? 120));
      setRouteReport(null);
      dlg.showModal();
    } else if (!isOpen && dlg.open) {
      dlg.close();
    }
  }, [isOpen, currentScene]);

  const baseReport = (() => {
    if (routeReport) return routeReport;
    if (customReport) return customReport;
    const r = assessRisk(s);
    const locked = s.safetyLock?.fingerprint === safetyFingerprint(s);
    if (safetyStop || locked) {
      const failures = (s.safetyHistory?.at(-1)?.issues || []) as RiskAssessmentReport['issues'];
      return {
        ...r,
        issues: [...failures, ...r.issues],
        critical: [...failures, ...r.critical],
      };
    }
    return r;
  })();

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateScene((sc) => {
      sc.riskInputs = {
        medicalRate: medicalRate === '' ? null : Number(medicalRate),
        source,
        autoRate: Number(autoRate),
        maxWaitSeconds: Number(maxWaitSeconds),
      };
    }, true);
    onClearCustomReport();
    setRouteReport(null);
    onSceneChanged();
  };

  const handleRecheckRoutes = () => {
    try {
      const latest = currentScene();
      const e = new EventEngine(phaseScene(latest, 'event'));
      e.reviewRunId = crypto.randomUUID();
      e.emergency = new ResponseSimulation(e);
      e.experience = new ExperienceMonitor(e);
      setRouteReport(assessRisk(latest, e, {routes: true}));
    } catch (err) {
      showToast((err as Error).message);
    }
  };

  const formatSeconds = (sec: number): string => {
    const m = Math.floor(sec / 60);
    const rem = sec % 60;
    return m > 0 ? `${sec} s (${m} min${rem ? ` ${rem} s` : ''})` : `${sec} s`;
  };

  // Previsualización estadística en vivo al mover los sliders
  const liveStatistical = (() => {
    const parsedRate = medicalRate === '' ? null : Number(medicalRate);
    if (
      parsedRate === null ||
      !Number.isFinite(parsedRate) ||
      parsedRate < 0 ||
      parsedRate > 100
    ) {
      return baseReport.statistical;
    }
    const exposure = baseReport.expected * (Number(s.base.hours) || 0);
    const slots = baseReport.slots.medical;
    const meanServiceHours = (baseReport.statistical?.serviceMinutes || 4.5) / 60;
    const expected = (parsedRate * exposure) / 1000;
    return {
      rate: parsedRate,
      exposure,
      expected,
      any: poissonTail(expected, 0),
      overlap: poissonTail(
        ((parsedRate * baseReport.expected) / 1000) * meanServiceHours,
        slots
      ),
      slots,
      serviceMinutes: meanServiceHours * 60,
    };
  })();

  const closeDialog = () => {
    onClearCustomReport();
    setActiveModal(null);
  };

  const executeRiskAction = (act: RiskGuideAction) => {
    switch (act.kind) {
      case 'select-item':
        closeDialog();
        if (act.itemId) {
          locateOnMap({
            id: act.itemId,
            panel: 'design',
            enableXray: act.enableXray,
          });
        } else {
          setPanel('design');
          if (act.enableXray) setXrayVisible(true);
        }
        showToast('Elemento localizado y centrado en el plano para corregirlo');
        return;
      case 'switch-tool':
        closeDialog();
        setPanel('design');
        if (act.tool) setTool(act.tool);
        showToast('Pulsa sobre el plano para colocar el elemento');
        return;
      case 'open-modal':
        onClearCustomReport();
        if (act.modal === 'inventory') setPanel('design');
        setActiveModal(act.modal || null);
        return;
      case 'focus-panel':
        closeDialog();
        setPanel(act.panel || 'design');
        return;
      case 'focus-risk-form':
        document
          .getElementById('risk-form')
          ?.scrollIntoView({behavior: 'smooth', block: 'center'});
        return;
      case 'quick-fix': {
        if (act.fixType === 'clear-heavy-load' && act.itemId) {
          updateScene((sc) => {
            const target = [...sc.base.booths, ...sc.infrastructure].find(
              (o) => o.id === act.itemId
            );
            if (target) target.heavyLoad = false;
          }, true);
          showToast('Marca de carga pesada desactivada para esta pieza.');
        } else if (act.fixType === 'cap-vehicle-to-one' && act.itemId) {
          updateScene((sc) => {
            const target = sc.infrastructure.find((o) => o.id === act.itemId);
            if (target) target.capacity = 1;
          }, true);
          showToast('Capacidad simultánea del vehículo ajustada a 1.');
        } else if (act.fixType === 'fit-overbook-capacity' && act.itemId) {
          updateScene((sc) => {
            const target = sc.infrastructure.find((o) => o.id === act.itemId);
            if (target) {
              const req = requiredStaff(sc, target.kind);
              target.capacity = Math.max(
                0,
                Math.floor((Number(target.staff) || 0) / req)
              );
            }
          }, true);
          showToast('Equipos simultáneos ajustados al personal disponible.');
        } else if (act.fixType === 'sync-demand-arrivals') {
          updateScene((sc) => {
            if (sc.demandInputs) sc.base.arrivals = sc.demandInputs.arrivals;
          }, true);
          showToast('Afluencia del ensayo igualada al cálculo de demanda.');
        } else if (act.fixType === 'enable-trained') {
          updateScene((sc) => {
            sc.trained = true;
          }, true);
          showToast('Formación en primera intervención activada.');
        } else if (act.fixType === 'add-dry-staff') {
          updateScene((sc) => {
            sc.dryStaff = Math.min(10, Number(sc.dryStaff || 1) + 1);
          }, true);
          showToast('Personal de secado incrementado (+1 operario).');
        } else if (act.fixType === 'enable-fire-foot-access') {
          updateScene((sc) => {
            sc.fireFootAccess = true;
          }, true);
          showToast(
            'Despliegue a pie de bomberos habilitado. Comprobando rutas…'
          );
          onClearCustomReport();
          onSceneChanged();
          setTimeout(() => handleRecheckRoutes(), 0);
          return;
        } else if (
          act.fixType === 'relocate-emergency-resource' &&
          act.itemId
        ) {
          let movedName = '';
          updateScene((sc) => {
            const target = sc.infrastructure.find((o) => o.id === act.itemId);
            if (!target) return;
            const evScene = phaseScene(sc, 'event');
            const g = buildGrid(evScene);
            const originX = (target.x * g.m.widthMeters) / 100;
            const originY = (target.y * g.m.heightMeters) / 100;
            const profile =
              RESPONSE_PROFILES[target.kind] || RESPONSE_PROFILES.firstaid;
            const clearR =
              Math.max(
                profile.width,
                ['fire', 'ambulance', 'patrol'].includes(target.kind)
                  ? target.width || profile.width
                  : profile.width
              ) /
                2 +
              0.25;
            let bestK = -1;
            let bestDist = Infinity;
            for (let k = 0; k < g.free.length; k++) {
              if (!g.free[k]) continue;
              const p = g.point(k);
              let clear = true;
              for (let i = 0; i < 8; i++) {
                const ang = (i * Math.PI) / 4;
                const j = g.index(
                  p[0] + clearR * Math.cos(ang),
                  p[1] + clearR * Math.sin(ang)
                );
                if (j < 0 || !g.free[j]) {
                  clear = false;
                  break;
                }
              }
              if (!clear) continue;
              const d = Math.hypot(p[0] - originX, p[1] - originY);
              if (d < bestDist) {
                bestDist = d;
                bestK = k;
              }
            }
            if (bestK >= 0) {
              const [nx, ny] = percent(g.point(bestK), g.m);
              target.x = nx;
              target.y = ny;
              movedName = target.name;
            }
          }, true);
          if (movedName) {
            showToast(
              `«${movedName}» reubicado en el punto despejado más cercano.`
            );
            onClearCustomReport();
            onSceneChanged();
            setTimeout(() => handleRecheckRoutes(), 0);
            return;
          }
          showToast(
            'No se encontró un espacio libre cercano; abre un pasillo más ancho en el plano.'
          );
        }
        onClearCustomReport();
        setRouteReport(null);
        onSceneChanged();
        return;
      }
    }
  };

  return (
    <dialog
      id="risk-dialog"
      ref={dlgRef}
      onClose={() => {
        if (isOpen) {
          onClearCustomReport();
          setActiveModal(null);
        }
      }}
    >
      {safetyStop && engine && (
        <>
          <div
            dangerouslySetInnerHTML={{
              __html: resultHTML(engine, true),
            }}
          />
          <PostSimDiagnosticsView
            engine={engine}
            onSceneChanged={onSceneChanged}
            onCloseModal={closeDialog}
          />
        </>
      )}
      <h2>Revisión de riesgos</h2>
      {(() => {
        const lastHistSeed = (
          s.safetyHistory?.at(-1) as {seed?: number} | undefined
        )?.seed;
        const reportSeed = engine?.s.seed ?? lastHistSeed ?? activeRunSeed ?? s.seed;
        return (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
              padding: '8px 10px',
              marginBottom: '10px',
              borderRadius: '8px',
              background: 'var(--purple-soft)',
              borderLeft: '3px solid var(--purple)',
              fontSize: '0.84rem',
            }}
          >
            <span>
              <b>Semilla del ensayo / reporte:</b> #{reportSeed}
            </span>
            <div style={{display: 'flex', gap: '6px', flexWrap: 'wrap'}}>
              <button
                type="button"
                className="quiet"
                onClick={() => {
                  navigator.clipboard?.writeText(String(reportSeed)).catch(() => {});
                  showToast(`Semilla #${reportSeed} copiada`);
                }}
              >
                Copiar semilla
              </button>
              {onReproduceSeed && (
                <button
                  type="button"
                  className="dark"
                  onClick={() => onReproduceSeed(reportSeed)}
                >
                  Fijar semilla y reproducir
                </button>
              )}
            </div>
          </div>
        );
      })()}
      <p>
        El modelo se guarda como borrador aunque existan bloqueos. Los bloqueos
        impiden iniciar o reanudar el ensayo. Son controles internos del
        prototipo; la dotación legal corresponde al plan específico del evento.
      </p>
      <div
        className={`risk-summary ${baseReport.critical.length ? 'risk-stop' : ''}`}
      >
        <b>
          {baseReport.critical.length} bloqueos · {baseReport.warnings.length}{' '}
          aspectos por revisar
        </b>
        <p>
          {Math.round(baseReport.expected)} personas de ocupación media estimada.
          Equipos simultáneos: sanitarios {baseReport.slots.medical}, seguridad{' '}
          {baseReport.slots.security}, bomberos {baseReport.slots.fire}.
        </p>
      </div>
      <div className="risk-guided-list">
        {baseReport.issues.map((issue) => {
          const guide = resolveRiskGuide(issue, s);
          return (
            <article
              key={issue.id}
              className={`risk-item risk-guided-card ${issue.level}`}
              data-risk-id={issue.id}
            >
              <header className="diag-guide-head">
                <b className="risk-guided-title">
                  {guide.icon}{' '}
                  {issue.level === 'critical' ? 'BLOQUEO · ' : 'REVISAR · '}
                  {issue.title}
                </b>
                <span
                  className={`diag-badge ${issue.level === 'critical' ? 'badge-high' : 'badge-medium'}`}
                >
                  {issue.level === 'critical' ? 'Impide simular' : 'Aviso'}
                </span>
              </header>
              <p className="diag-why">{guide.cause}</p>
              <p className="diag-evidence">
                <b>Detalle:</b> {issue.action}
              </p>
              <ul className="diag-steps">
                {guide.steps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ul>
              {guide.actions.length > 0 && (
                <div className="diag-actions">
                  {guide.actions.map((act, i) => (
                    <button
                      key={i}
                      type="button"
                      className={act.primary ? 'dark' : 'quiet'}
                      onClick={() => executeRiskAction(act)}
                    >
                      {act.label}
                    </button>
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </div>
      {liveStatistical && (
        <section
          className="risk-stats-visual"
          aria-label="Escenario estadístico sanitario"
        >
          <h3>Escenario estadístico sanitario (modelo Poisson)</h3>
          <div className="risk-stat-cards">
            <div className="risk-stat-card">
              <div className="diag-bar-meta">
                <span>Probabilidad de ≥ 1 incidencia</span>
                <b>{(liveStatistical.any * 100).toFixed(1)} %</b>
              </div>
              <div className="diag-bar-track">
                <div
                  className="diag-bar-fill"
                  style={{
                    width: `${Math.min(100, Math.max(2, liveStatistical.any * 100))}%`,
                    background:
                      liveStatistical.any > 0.6
                        ? '#d9534f'
                        : liveStatistical.any > 0.25
                          ? '#d97706'
                          : '#6aa84f',
                  }}
                />
              </div>
              <small>
                {liveStatistical.expected.toFixed(2)} incidencias esperadas en{' '}
                {Math.round(liveStatistical.exposure)} pers·h
              </small>
            </div>

            <div className="risk-stat-card">
              <div className="diag-bar-meta">
                <span>Riesgo de saturación simultánea</span>
                <b>{(liveStatistical.overlap * 100).toFixed(2)} %</b>
              </div>
              <div className="diag-bar-track risk-threshold-track">
                <div
                  className="diag-bar-fill"
                  style={{
                    width: `${Math.min(100, Math.max(2, liveStatistical.overlap * 100 * 5))}%`,
                    background:
                      liveStatistical.overlap > 0.05 ? '#d9534f' : '#6aa84f',
                  }}
                />
                <span
                  className="risk-threshold-mark"
                  title="Umbral interno de aviso: 5 %"
                />
              </div>
              <small>
                {liveStatistical.slots} equipos sanitarios · aviso interno si
                supera 5 %
              </small>
            </div>
          </div>
          <p className="risk-stat-footnote">
            Modelo Poisson de referencia, no probabilidad real de daño. Supone
            tasa constante e independencia; omite lluvia, aglomeraciones,
            incendios y evacuación.
          </p>
        </section>
      )}
      <h3>Hipótesis del ensayo</h3>
      <form id="risk-form" className="risk-sliders-form" onSubmit={handleFormSubmit}>
        <div className="risk-slider-field">
          <div className="risk-slider-head">
            <label htmlFor="risk-medical-rate">
              Incidencias sanitarias (por 1.000 pers·h)
            </label>
            <output className="risk-slider-pill">
              {medicalRate === ''
                ? 'Sin calibrar'
                : `${Number(medicalRate).toFixed(1)} ‰ · ${liveStatistical ? (liveStatistical.any * 100).toFixed(0) : 0} % prob.`}
            </output>
          </div>
          <div className="risk-slider-row">
            <input
              type="range"
              aria-label="Deslizador de incidencias sanitarias por 1.000 personas·hora"
              min="0"
              max="20"
              step="0.1"
              value={medicalRate === '' ? 0 : Math.min(20, Number(medicalRate))}
              onChange={(e) => setMedicalRate(e.target.value)}
            />
            <input
              id="risk-medical-rate"
              name="medicalRate"
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={medicalRate}
              onChange={(e) => setMedicalRate(e.target.value)}
            />
          </div>
        </div>

        <label className="risk-text-field">
          Fuente y contexto de esa tasa
          <input
            name="source"
            maxLength={250}
            required
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
        </label>

        <div className="risk-slider-field">
          <div className="risk-slider-head">
            <label htmlFor="risk-auto-rate">
              Intensidad de sucesos automáticos (avisos / 1.000 pers·h)
            </label>
            <output className="risk-slider-pill">
              {autoRate} ‰ ·{' '}
              {autoRate === 0
                ? 'Desactivado'
                : autoRate <= 80
                  ? 'Baja'
                  : autoRate <= 200
                    ? 'Media'
                    : 'Alta'}
            </output>
          </div>
          <div className="risk-slider-row">
            <input
              type="range"
              aria-label="Deslizador de intensidad de sucesos automáticos"
              min="0"
              max="500"
              step="5"
              value={Math.min(500, autoRate)}
              onChange={(e) => setAutoRate(Number(e.target.value))}
            />
            <input
              id="risk-auto-rate"
              name="autoRate"
              type="number"
              min="0"
              max="1000"
              required
              value={autoRate}
              onChange={(e) => setAutoRate(Number(e.target.value))}
            />
          </div>
          <div className="risk-split-bar" aria-label="Reparto de severidad: 93% leves, 7% moderados o graves">
            <span className="split-mild" style={{width: '93%'}}>
              93 % leves
            </span>
            <span className="split-severe" style={{width: '7%'}}>
              7 %
            </span>
          </div>
        </div>

        <div className="risk-slider-field">
          <div className="risk-slider-head">
            <label htmlFor="risk-max-wait">
              Espera máxima sin asignación antes de cancelar
            </label>
            <output className="risk-slider-pill">
              {formatSeconds(maxWaitSeconds)} ·{' '}
              {maxWaitSeconds <= 90
                ? 'Estricto'
                : maxWaitSeconds <= 240
                  ? 'Equilibrado'
                  : 'Permisivo'}
            </output>
          </div>
          <div className="risk-slider-row">
            <input
              type="range"
              aria-label="Deslizador de espera máxima sin asignación"
              min="15"
              max="600"
              step="15"
              value={Math.max(15, Math.min(600, maxWaitSeconds))}
              onChange={(e) => setMaxWaitSeconds(Number(e.target.value))}
            />
            <input
              id="risk-max-wait"
              name="maxWaitSeconds"
              type="number"
              min="15"
              max="600"
              required
              value={maxWaitSeconds}
              onChange={(e) => setMaxWaitSeconds(Number(e.target.value))}
            />
          </div>
        </div>

        <button type="submit" className="dark">
          Guardar hipótesis y reevaluar
        </button>
      </form>
      <div className="risk-actions">
        <button
          id="risk-fix"
          type="button"
          onClick={() => {
            onClearCustomReport();
            setPanel('design');
            setActiveModal('inventory');
          }}
        >
          Corregir recursos en el plano
        </button>
        <button id="risk-recheck" type="button" onClick={handleRecheckRoutes}>
          Comprobar dotación y recorridos
        </button>
        <button
          id="risk-export"
          type="button"
          onClick={() =>
            downloadFile(
              'Revision_de_riesgos.json',
              JSON.stringify(
                {
                  event: s.title,
                  seed:
                    engine?.s.seed ??
                    (s.safetyHistory?.at(-1) as {seed?: number} | undefined)?.seed ??
                    activeRunSeed ??
                    s.seed,
                  seedMode: simSeedMode,
                  report: baseReport,
                  history: s.safetyHistory || [],
                  hypotheses: s.riskInputs || {},
                  status: 'Borrador exploratorio; no certifica seguridad',
                },
                null,
                2
              )
            )
          }
        >
          Descargar revisión
        </button>
        <button
          id="risk-close"
          type="button"
          onClick={() => {
            onClearCustomReport();
            setActiveModal(null);
          }}
        >
          Cerrar
        </button>
      </div>
    </dialog>
  );
};
