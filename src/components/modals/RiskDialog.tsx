import React, {useEffect, useRef, useState} from 'react';
import {downloadFile} from '../../db/repository';
import {EventEngine} from '../../engine/crowd/event-engine';
import {
  ResponseSimulation,
} from '../../engine/emergency/response-model';
import {
  assessRisk,
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
}) => {
  const dlgRef = useRef<HTMLDialogElement | null>(null);
  const activeModal = useProjectStore((s) => s.activeModal);
  const currentScene = useProjectStore((s) => s.currentScene);
  const setActiveModal = useProjectStore((s) => s.setActiveModal);
  const setPanel = useProjectStore((s) => s.setPanel);
  const setTool = useProjectStore((s) => s.setTool);
  const setSelectedId = useProjectStore((s) => s.setSelectedId);
  const setXrayVisible = useProjectStore((s) => s.setXrayVisible);
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
      const e = new EventEngine(phaseScene(s, 'event'));
      e.reviewRunId = crypto.randomUUID();
      e.emergency = new ResponseSimulation(e);
      e.experience = new ExperienceMonitor(e);
      setRouteReport(assessRisk(s, e, {routes: true}));
    } catch (err) {
      showToast((err as Error).message);
    }
  };

  const closeDialog = () => {
    onClearCustomReport();
    setActiveModal(null);
  };

  const executeRiskAction = (act: RiskGuideAction) => {
    switch (act.kind) {
      case 'select-item':
        closeDialog();
        setPanel('design');
        if (act.enableXray) setXrayVisible(true);
        if (act.itemId) setSelectedId(act.itemId);
        showToast('Elemento seleccionado en el plano para corregirlo');
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
      {baseReport.statistical && (
        <>
          <h3>Escenario estadístico sanitario</h3>
          <p>
            Hipótesis: {baseReport.statistical.rate} incidencias/1.000
            personas·hora. Exposición:{' '}
            {Math.round(baseReport.statistical.exposure)} personas·hora. Se
            esperan {baseReport.statistical.expected.toFixed(2)} incidencias por
            jornada. Probabilidad de al menos una:{' '}
            {(baseReport.statistical.any * 100).toFixed(1)} %. Probabilidad
            teórica de demanda simultánea superior a equipos:{' '}
            {(baseReport.statistical.overlap * 100).toFixed(2)} %.
          </p>
          <p>
            Modelo Poisson de referencia, no probabilidad de daño ni de fallo
            real. Supone tasa constante e independencia; omite concentración por
            zonas, viajes, correlaciones y agravamiento por lluvia. No cubre
            incendios ni evacuación.
          </p>
        </>
      )}
      <h3>Hipótesis del ensayo</h3>
      <form id="risk-form" onSubmit={handleFormSubmit}>
        <label>
          Incidencias sanitarias por 1.000 personas·hora (vacío: desconocido)
          <input
            name="medicalRate"
            type="number"
            min="0"
            max="100"
            step="0.1"
            value={medicalRate}
            onChange={(e) => setMedicalRate(e.target.value)}
          />
        </label>
        <label>
          Fuente y contexto de esa tasa
          <input
            name="source"
            maxLength={250}
            required
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
        </label>
        <label>
          Intensidad de sucesos automáticos (avisos/1.000 personas·hora)
          <input
            name="autoRate"
            type="number"
            min="0"
            max="1000"
            required
            value={autoRate}
            onChange={(e) => setAutoRate(Number(e.target.value))}
          />
        </label>
        <p>
          La intensidad automática es una hipótesis de demostración. El 93 % son
          avisos leves; no representa una estadística municipal.
        </p>
        <label>
          Espera máxima sin asignación antes de cancelar el ensayo (s)
          <input
            name="maxWaitSeconds"
            type="number"
            min="15"
            max="600"
            required
            value={maxWaitSeconds}
            onChange={(e) => setMaxWaitSeconds(Number(e.target.value))}
          />
        </label>
        <button type="submit">Guardar hipótesis y reevaluar</button>
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
