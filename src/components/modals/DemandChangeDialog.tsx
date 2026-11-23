import React, {useEffect, useRef} from 'react';
import {formatClockHour} from '../../engine/planning/event-demand';
import type {EventDemandConfig} from '../../types';

export type DemandLiveDecision =
  | 'restart'
  | 'apply_now'
  | 'save_variant'
  | 'cancel';

export interface DemandChangeDialogProps {
  open: boolean;
  elapsedSeconds: number;
  currentConfig: EventDemandConfig | null;
  pendingConfig: EventDemandConfig | null;
  canApplyLive: boolean;
  liveApplyBlockedReason?: string;
  onDecision: (decision: DemandLiveDecision) => void;
}

/**
 * Diálogo de gestión de cambios cuando se modifican hipótesis de demanda con un ensayo
 * ya iniciado: nunca destruye la simulación sin confirmar ni deja planificación y motor desincronizados.
 */
export const DemandChangeDialog: React.FC<DemandChangeDialogProps> = ({
  open,
  elapsedSeconds,
  currentConfig,
  pendingConfig,
  canApplyLive,
  liveApplyBlockedReason,
  onDecision,
}) => {
  const dlgRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const dlg = dlgRef.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    else if (!open && dlg.open) dlg.close();
  }, [open]);

  const diffs: Array<{label: string; from: string; to: string}> = [];
  if (currentConfig && pendingConfig) {
    if (currentConfig.uniqueAttendees !== pendingConfig.uniqueAttendees) {
      diffs.push({
        label: 'Asistentes únicos',
        from: currentConfig.uniqueAttendees.toLocaleString('es-ES'),
        to: pendingConfig.uniqueAttendees.toLocaleString('es-ES'),
      });
    }
    if (currentConfig.hours !== pendingConfig.hours) {
      diffs.push({
        label: 'Duración',
        from: `${currentConfig.hours} h`,
        to: `${pendingConfig.hours} h`,
      });
    }
    if (currentConfig.startHour !== pendingConfig.startHour) {
      diffs.push({
        label: 'Apertura',
        from: `${String(Math.floor(currentConfig.startHour)).padStart(2, '0')}:00`,
        to: `${String(Math.floor(pendingConfig.startHour)).padStart(2, '0')}:00`,
      });
    }
    if (currentConfig.curveProfile !== pendingConfig.curveProfile) {
      diffs.push({
        label: 'Perfil horario',
        from: currentConfig.curveProfile,
        to: pendingConfig.curveProfile,
      });
    }
    if (currentConfig.dwellTimeMinutes !== pendingConfig.dwellTimeMinutes) {
      diffs.push({
        label: 'Permanencia media',
        from: `${currentConfig.dwellTimeMinutes} min`,
        to: `${pendingConfig.dwellTimeMinutes} min`,
      });
    }
    if (currentConfig.authorizedCapacity !== pendingConfig.authorizedCapacity) {
      diffs.push({
        label: 'Aforo autorizado',
        from:
          currentConfig.authorizedCapacity != null
            ? `${currentConfig.authorizedCapacity.toLocaleString('es-ES')} pers.`
            : 'No definido',
        to:
          pendingConfig.authorizedCapacity != null
            ? `${pendingConfig.authorizedCapacity.toLocaleString('es-ES')} pers.`
            : 'No definido',
      });
    }
  }

  const clockLabel = currentConfig
    ? formatClockHour(currentConfig.startHour, elapsedSeconds)
    : '';

  return (
    <dialog
      ref={dlgRef}
      id="demand-change-dialog"
      className="demand-change-modal"
      aria-labelledby="demand-change-title"
      onCancel={(e) => {
        e.preventDefault();
        onDecision('cancel');
      }}
    >
      <div className="demand-change-head">
        <div>
          <span className="status-chip">ENSAYO INICIADO · {clockLabel}</span>
          <h3 id="demand-change-title">¿Cómo aplicar el cambio de demanda?</h3>
        </div>
        <button
          type="button"
          className="quiet"
          onClick={() => onDecision('cancel')}
        >
          Cerrar
        </button>
      </div>

      <p className="small-note">
        Hay una simulación en curso con histórico acumulado. Elige cómo resolver estos cambios para
        mantener sincronizados el plan y el motor:
      </p>

      {diffs.length > 0 && (
        <div className="demand-change-diffs">
          {diffs.map((d) => (
            <div key={d.label} className="demand-diff-row">
              <span>{d.label}</span>
              <b>
                {d.from} → {d.to}
              </b>
            </div>
          ))}
        </div>
      )}

      <div className="demand-change-options">
        <button
          type="button"
          className="dark demand-option-btn"
          onClick={() => onDecision('restart')}
        >
          <strong>A · Reiniciar simulación con los nuevos datos</strong>
          <small>Vuelve a la apertura (t = 0) y ejecuta el escenario completo con la nueva configuración.</small>
        </button>

        <button
          type="button"
          className="quiet demand-option-btn"
          disabled={!canApplyLive}
          onClick={() => onDecision('apply_now')}
        >
          <strong>B · Aplicar desde el momento actual ({clockLabel})</strong>
          <small>
            {canApplyLive
              ? 'Conserva el histórico ya simulado y actualiza la tasa de llegadas de las franjas futuras.'
              : liveApplyBlockedReason ||
                'Este cambio estructural afecta al tramo ya transcurrido y requiere reiniciar o guardar variante.'}
          </small>
        </button>

        <button
          type="button"
          className="quiet demand-option-btn"
          onClick={() => onDecision('save_variant')}
        >
          <strong>C · Crear una variante comparativa</strong>
          <small>Guarda esta propuesta como variante sin interrumpir ni alterar el ensayo en curso.</small>
        </button>

        <button
          type="button"
          className="quiet demand-option-btn"
          onClick={() => onDecision('cancel')}
        >
          <strong>D · Cancelar y mantener el ensayo actual</strong>
          <small>Descarta el cambio pendiente para evitar contradicciones entre los paneles.</small>
        </button>
      </div>
    </dialog>
  );
};
