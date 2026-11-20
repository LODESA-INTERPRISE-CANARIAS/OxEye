import React, {useEffect, useRef, useState} from 'react';
import {downloadFile} from '../../db/repository';
import {EventEngine} from '../../engine/crowd/event-engine';
import {
  ResponseSimulation,
} from '../../engine/emergency/response-model';
import {
  assessRisk,
  resultHTML,
  type RiskAssessmentReport,
  riskHTML,
  safetyFingerprint,
} from '../../engine/emergency/risk';
import {ExperienceMonitor} from '../../engine/experience/experience-monitor';
import {phaseScene} from '../../engine/logistics/phases';
import {useProjectStore} from '../../store/useProjectStore';

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
        <div
          dangerouslySetInnerHTML={{
            __html: resultHTML(engine, true),
          }}
        />
      )}
      <h2>Revisión de riesgos</h2>
      <p>
        El modelo se guarda como borrador aunque existan bloqueos. Los bloqueos
        impiden iniciar o reanudar el ensayo. Son controles internos del
        prototipo; la dotación legal corresponde al plan específico del evento.
      </p>
      <div
        dangerouslySetInnerHTML={{
          __html: riskHTML(baseReport),
        }}
      />
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
