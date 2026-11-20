import React, {useEffect, useRef} from 'react';
import {downloadFile} from '../../db/repository';
import type {EventEngine} from '../../engine/crowd/event-engine';
import {resultHTML} from '../../engine/emergency/risk';
import {phases} from '../../engine/logistics/phases';
import {useProjectStore} from '../../store/useProjectStore';
import type {PhaseFilter, ShiftPlanResult} from '../../types';

export interface ClosingDialogData {
  closedPhase: PhaseFilter;
  shiftPlan: ShiftPlanResult | null;
  shiftTime: number;
  engineTime: number;
  arrivals: number;
  served: number;
  abandoned: number;
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
}) => {
  const dlgRef = useRef<HTMLDialogElement | null>(null);
  const activeModal = useProjectStore((s) => s.activeModal);
  const currentScene = useProjectStore((s) => s.currentScene);
  const setActiveModal = useProjectStore((s) => s.setActiveModal);
  const setPhase = useProjectStore((s) => s.setPhase);
  const setPanel = useProjectStore((s) => s.setPanel);
  const updateScene = useProjectStore((s) => s.updateScene);

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
      <div id="day-body">
        {!plan && data?.engine && (
          <div
            dangerouslySetInnerHTML={{
              __html: resultHTML(data.engine),
            }}
          />
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
