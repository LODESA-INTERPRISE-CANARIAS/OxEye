import React, {useEffect, useRef} from 'react';
import {downloadFile} from '../../db/repository';
import type {EventEngine} from '../../engine/crowd/event-engine';
import {resultHTML} from '../../engine/emergency/risk';
import {phases} from '../../engine/logistics/phases';
import {useProjectStore} from '../../store/useProjectStore';
import type {PhaseFilter, ShiftPlanResult} from '../../types';
import {PostSimDiagnosticsView} from './PostSimDiagnosticsView';

export interface ClosingDialogData {
  closedPhase: PhaseFilter;
  shiftPlan: ShiftPlanResult | null;
  shiftTime: number;
  engineTime: number;
  arrivals: number;
  served: number;
  abandoned: number;
  seed?: number;
  diagnosticMode?: boolean;
  engine?: EventEngine | null;
  emergencyReport?: Array<{
    id: string | number;
    type: string;
    status: string;
    reason?: string;
    reinforcements?: unknown;
    reporters: number;
  }>;
}

export interface ClosingDialogProps {
  data: ClosingDialogData | null;
  onPhaseChanged: () => void;
  onSceneChanged: () => void;
  onReproduceSeed?: (seed: number) => void;
}

const timeLabel = (t: number): string =>
  [Math.floor(t / 3600), Math.floor(t / 60) % 60, Math.floor(t) % 60]
    .map((v) => String(v).padStart(2, '0'))
    .join(':');

/**
 * Modal dialog (`#closing`) displayed when an event day or logistics shift finishes.
 */
export const ClosingDialog: React.FC<ClosingDialogProps> = ({
  data,
  onPhaseChanged,
  onSceneChanged,
  onReproduceSeed,
}) => {
  const dlgRef = useRef<HTMLDialogElement | null>(null);
  const activeModal = useProjectStore((s) => s.activeModal);
  const currentScene = useProjectStore((s) => s.currentScene);
  const setActiveModal = useProjectStore((s) => s.setActiveModal);
  const setPhase = useProjectStore((s) => s.setPhase);
  const setPanel = useProjectStore((s) => s.setPanel);
  const updateScene = useProjectStore((s) => s.updateScene);
  const showToast = useProjectStore((s) => s.showToast);

  const isOpen = activeModal === 'closing';

  useEffect(() => {
    const dlg = dlgRef.current;
    if (!dlg) return;
    if (isOpen && !dlg.open) {
      dlg.showModal();
    } else if (!isOpen && dlg.open) {
      dlg.close();
    }
  }, [isOpen]);

  const closedPhase = data?.closedPhase || 'event';
  const isLog = closedPhase === 'pre' || closedPhase === 'post';
  const plan = isLog ? data?.shiftPlan || null : null;
  const t = plan
    ? Math.min(data?.shiftTime || 0, plan.total, plan.limit)
    : data?.engineTime || 0;
  const finished = plan?.installed.filter((j) => j.at <= t) || [];
  const pending = plan ? plan.required - finished.length : 0;
  const msg = plan
    ? `Tareas completadas ${finished.length} / ${plan.required} · Pendientes ${pending}. ${plan.alerts.join(' ')}`
    : `Llegadas ${data?.arrivals || 0} · Atenciones ${data?.served || 0} · Abandonos ${data?.abandoned || 0}`;

  const handleResetShiftProgress = () => {
    if (closedPhase !== 'pre' && closedPhase !== 'post') return;
    updateScene((s) => {
      if (s.progressByPhase) delete s.progressByPhase[closedPhase];
      if (s.shiftDays) delete s.shiftDays[closedPhase];
    }, true);
    onSceneChanged();
    setActiveModal(null);
    showToast('Progreso del turno reiniciado · pulsa Iniciar para simular el montaje completo.');
  };

  const handleExtendDay = () => {
    updateScene((s) => {
      if (plan && (closedPhase === 'pre' || closedPhase === 'post')) {
        s.progressByPhase ??= {};
        s.progressByPhase[closedPhase] = [
          ...new Set([
            ...(s.progressByPhase[closedPhase] || []),
            ...finished.map((j) => j.o.id),
          ]),
        ];
        s.shiftDays ??= {};
        s.shiftDays[closedPhase] = (s.shiftDays[closedPhase] || 1) + 1;
      } else {
        s.eventDays = (s.eventDays || 1) + 1;
      }
    }, true);
    onSceneChanged();
    setActiveModal('org');
  };

  return (
    <dialog
      id="closing"
      ref={dlgRef}
      onClose={() => {
        if (isOpen) setActiveModal(null);
      }}
    >
      <h2>Balance de jornada</h2>
      {data?.diagnosticMode && (
        <div
          style={{
            padding: '9px 12px',
            marginBottom: '10px',
            borderRadius: '8px',
            background: 'rgba(180, 60, 76, 0.12)',
            border: '1px solid var(--danger)',
            color: 'var(--danger)',
            fontSize: '0.84rem',
            fontWeight: 700,
          }}
        >
          ESCENARIO NO VALIDADO — USO EXCLUSIVAMENTE ANALÍTICO · Simulación
          diagnóstica con restricciones críticas activas (no certifica seguridad).
        </div>
      )}
      {!plan && (data?.seed ?? data?.engine?.s.seed) !== undefined && (
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
            <b>Semilla reproducible del ensayo:</b> #
            {data?.seed ?? data?.engine?.s.seed}
          </span>
          <div style={{display: 'flex', gap: '6px', flexWrap: 'wrap'}}>
            <button
              type="button"
              className="quiet"
              onClick={() => {
                const seedVal = data?.seed ?? data?.engine?.s.seed ?? 2026;
                navigator.clipboard?.writeText(String(seedVal)).catch(() => {});
                showToast(`Semilla #${seedVal} copiada`);
              }}
            >
              Copiar semilla
            </button>
            {onReproduceSeed && (
              <button
                type="button"
                className="dark"
                onClick={() =>
                  onReproduceSeed(data?.seed ?? data?.engine?.s.seed ?? 2026)
                }
              >
                Fijar semilla y reproducir
              </button>
            )}
          </div>
        </div>
      )}
      <div id="day-body">
        {!plan && data?.engine && (
          <>
            <PostSimDiagnosticsView
              engine={data.engine}
              onSceneChanged={onSceneChanged}
              onCloseModal={() => setActiveModal(null)}
            />
            <div
              dangerouslySetInnerHTML={{
                __html: resultHTML(data.engine),
              }}
            />
          </>
        )}
        {plan && (
          <section className="shift-visual-card">
            <div className="diag-bar-meta">
              <span>Avance del turno logístico</span>
              <b>
                {finished.length} / {plan.required} tareas (
                {plan.required > 0
                  ? Math.round((finished.length / plan.required) * 100)
                  : 100}{' '}
                %)
              </b>
            </div>
            <div className="diag-bar-track">
              <div
                className="diag-bar-fill"
                style={{
                  width: `${plan.required > 0 ? Math.min(100, Math.round((finished.length / plan.required) * 100)) : 100}%`,
                  background: pending > 0 ? '#d97706' : '#6aa84f',
                }}
              />
            </div>
            {(pending > 0 || plan.alerts.length > 0) && (
              <article className="diag-guide-card severity-high" style={{marginTop: '12px'}}>
                <header className="diag-guide-head">
                  <span className="diag-guide-title">
                    <i style={{background: '#d97706'}} />
                    🚚 Tareas pendientes o alertas de turno
                  </span>
                  <span className="diag-badge badge-high">
                    {pending} pendientes
                  </span>
                </header>
                <p className="diag-why">
                  El turno configurado no ha bastado para completar todas las
                  piezas o faltan zonas logísticas (carga, maniobra o contenedores).
                </p>
                {plan.alerts.length > 0 && (
                  <p className="diag-evidence">
                    <b>Alertas:</b> {plan.alerts.join(' · ')}
                  </p>
                )}
                <div className="diag-actions">
                  <button
                    type="button"
                    className="dark"
                    onClick={() => setActiveModal('org')}
                  >
                    Añadir operarios / camiones
                  </button>
                  <button
                    type="button"
                    className="quiet"
                    onClick={() => setActiveModal('parameters')}
                  >
                    Ajustar tiempos y horas de turno
                  </button>
                </div>
              </article>
            )}
          </section>
        )}
        <p>
          {(phases as Record<string, string>)[closedPhase] || 'Evento'} ·{' '}
          {timeLabel(t)}
        </p>
        <p>{msg}</p>
        <button
          type="button"
          id="stay-day"
          onClick={() => setActiveModal(null)}
        >
          Volver al plano
        </button>{' '}
        <button type="button" id="extend-day" onClick={handleExtendDay}>
          Añadir jornada y ajustar recursos
        </button>
        {isLog && (
          <>
            {' '}
            <button
              type="button"
              id="reset-shift-progress"
              onClick={handleResetShiftProgress}
            >
              {closedPhase === 'post'
                ? 'Reiniciar desmontaje desde cero'
                : 'Reiniciar montaje desde cero'}
            </button>
          </>
        )}
        {closedPhase === 'pre' && !pending && (
          <button
            type="button"
            id="ready-map"
            onClick={() => {
              setActiveModal(null);
              setPhase('event');
              onPhaseChanged();
            }}
          >
            Ver montaje en Evento
          </button>
        )}
        {!plan && (
          <>
            <h3>Qué revisar antes del siguiente ensayo</h3>
            <p>
              {(data?.emergencyReport || [])
                .filter((r) => r.status !== 'resolved')
                .map((r) => r.reason || 'Aviso pendiente')
                .join(' · ') ||
                'Incidencias resueltas. Compara también colas, asientos y refugio.'}
            </p>
            <button
              type="button"
              id="improve-next"
              className="dark"
              onClick={() => setActiveModal('comparison')}
            >
              Probar una mejora y comparar resultados
            </button>{' '}
            <button
              type="button"
              id="review-next"
              onClick={() => {
                setPanel('design');
                setActiveModal('inventory');
              }}
            >
              Ajustar recursos
            </button>{' '}
            <button
              type="button"
              id="session-export"
              onClick={() =>
                downloadFile(
                  'Conclusiones_de_jornada.json',
                  JSON.stringify(currentScene().lastSessionReview, null, 2)
                )
              }
            >
              Guardar conclusiones
            </button>
          </>
        )}
      </div>
    </dialog>
  );
};
