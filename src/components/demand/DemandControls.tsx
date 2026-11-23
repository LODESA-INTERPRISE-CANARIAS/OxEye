import React, {useState} from 'react';
import {ATTENDANCE_CURVE_PRESETS} from '../../engine/crowd/attendance-model';
import type {
  DemandSyncBadgeState,
  DerivedEventDemand,
} from '../../engine/planning/event-demand';
import type {AttendanceCurveProfile} from '../../types';

export interface DemandSyncBadgeProps {
  state:
    | 'synced'
    | 'pending_changes'
    | 'outdated_results'
    | 'uncalibrated'
    | DemandSyncBadgeState;
  label: string;
  detail?: string;
}

/** Insignia visual con icono SVG y texto explícito sobre el estado de sincronización. */
export const DemandSyncBadge: React.FC<DemandSyncBadgeProps> = ({
  state,
  label,
  detail,
}) => {
  const renderIcon = () => {
    if (state === 'synced') {
      return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      );
    }
    if (state === 'pending_changes') {
      return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <polyline points="12 7 12 12 15.5 14" />
        </svg>
      );
    }
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    );
  };

  return (
    <span
      className={`demand-sync-badge state-${state}`}
      data-demand-sync-state={state}
      title={detail || label}
      role="status"
    >
      {renderIcon()}
      <span>{label}</span>
    </span>
  );
};

export interface AudienceTotalInputProps {
  id?: string;
  value: number;
  onChange: (nextTotal: number) => void;
  compact?: boolean;
}

export const AudienceTotalInput: React.FC<AudienceTotalInputProps> = ({
  id = 'unique-attendees-input',
  value,
  onChange,
  compact = false,
}) => (
  <label className={compact ? 'form-label demand-control-compact' : 'demand-field'}>
    <span>Asistentes únicos previstos</span>
    <input
      id={id}
      type="number"
      min={0}
      max={500000}
      step={50}
      value={value}
      onChange={(e) => {
        const next = Math.max(0, Math.min(500000, Math.round(Number(e.target.value) || 0)));
        onChange(next);
      }}
    />
  </label>
);

export interface EventDurationInputProps {
  idHours?: string;
  idStart?: string;
  hours: number;
  startHour: number;
  onChangeHours: (hours: number) => void;
  onChangeStartHour: (startHour: number) => void;
  compact?: boolean;
}

export const EventDurationInput: React.FC<EventDurationInputProps> = ({
  idHours = 'event-hours-input',
  idStart = 'event-start-hour-input',
  hours,
  startHour,
  onChangeHours,
  onChangeStartHour,
  compact = false,
}) => (
  <div className={compact ? 'demand-dual-row compact' : 'demand-dual-row'}>
    <label className={compact ? 'form-label' : 'demand-field'}>
      <span>Duración del evento</span>
      <select
        id={idHours}
        value={hours}
        onChange={(e) => onChangeHours(Math.max(1, Math.min(24, Number(e.target.value) || 8)))}
      >
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 24].map((h) => (
          <option key={h} value={h}>
            {h} h
          </option>
        ))}
      </select>
    </label>
    <label className={compact ? 'form-label' : 'demand-field'}>
      <span>Apertura</span>
      <select
        id={idStart}
        value={Math.floor(startHour)}
        onChange={(e) => onChangeStartHour(Math.max(0, Math.min(23, Number(e.target.value) || 10)))}
      >
        {Array.from({length: 24}, (_, h) => (
          <option key={h} value={h}>
            {String(h).padStart(2, '0')}:00
          </option>
        ))}
      </select>
    </label>
  </div>
);

export interface AttendanceProfileSelectorProps {
  id?: string;
  value: AttendanceCurveProfile;
  onChange: (profile: AttendanceCurveProfile) => void;
  compact?: boolean;
}

export const AttendanceProfileSelector: React.FC<AttendanceProfileSelectorProps> = ({
  id = 'attendance-profile-select',
  value,
  onChange,
  compact = false,
}) => (
  <label className={compact ? 'form-label demand-control-compact' : 'demand-field'}>
    <span>Curva horaria de llegadas</span>
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value as AttendanceCurveProfile)}
    >
      {(Object.keys(ATTENDANCE_CURVE_PRESETS) as AttendanceCurveProfile[]).map((k) => (
        <option key={k} value={k}>
          {ATTENDANCE_CURVE_PRESETS[k].label}
        </option>
      ))}
    </select>
  </label>
);

export interface DwellTimeInputProps {
  id?: string;
  value: number;
  onChange: (minutes: number) => void;
  compact?: boolean;
}

export const DwellTimeInput: React.FC<DwellTimeInputProps> = ({
  id = 'dwell-time-input',
  value,
  onChange,
  compact = false,
}) => (
  <label className={compact ? 'form-label demand-control-compact' : 'demand-field'}>
    <span>Permanencia media esperada (min)</span>
    <input
      id={id}
      type="number"
      min={10}
      max={720}
      step={5}
      value={value}
      onChange={(e) => {
        const v = Math.max(10, Math.min(720, Math.round(Number(e.target.value) || 60)));
        onChange(v);
      }}
    />
  </label>
);

export interface CapacityInputProps {
  idAuthorized?: string;
  idDesired?: string;
  authorizedCapacity: number | null;
  desiredMaxOccupancy?: number | null;
  onChangeAuthorized: (val: number | null) => void;
  onChangeDesired?: (val: number | null) => void;
  showDesired?: boolean;
  compact?: boolean;
}

export const CapacityInput: React.FC<CapacityInputProps> = ({
  idAuthorized = 'authorized-capacity-input',
  idDesired = 'desired-occupancy-input',
  authorizedCapacity,
  desiredMaxOccupancy,
  onChangeAuthorized,
  onChangeDesired,
  showDesired = false,
  compact = false,
}) => (
  <div className={showDesired ? 'demand-dual-row' : undefined}>
    <label className={compact ? 'form-label' : 'demand-field'}>
      <span>
        Aforo autorizado{' '}
        <small className="demand-muted-inline">
          ({authorizedCapacity != null ? `${authorizedCapacity.toLocaleString('es-ES')} pers.` : 'No definido'})
        </small>
      </span>
      <div className="demand-nullable-wrap">
        <input
          id={idAuthorized}
          type="number"
          min={1}
          max={500000}
          placeholder="No definido"
          value={authorizedCapacity != null ? authorizedCapacity : ''}
          onChange={(e) => {
            const raw = e.target.value.trim();
            if (!raw) {
              onChangeAuthorized(null);
              return;
            }
            const n = Math.round(Number(raw));
            onChangeAuthorized(Number.isFinite(n) && n > 0 ? n : null);
          }}
        />
        {authorizedCapacity != null && (
          <button
            type="button"
            className="quiet demand-clear-btn"
            onClick={() => onChangeAuthorized(null)}
            title="Marcar aforo como no definido"
          >
            Quitar
          </button>
        )}
      </div>
    </label>
    {showDesired && onChangeDesired && (
      <label className={compact ? 'form-label' : 'demand-field'}>
        <span>
          Ocupación máx. deseada{' '}
          <small className="demand-muted-inline">
            ({desiredMaxOccupancy != null ? `${desiredMaxOccupancy.toLocaleString('es-ES')}` : 'No definido'})
          </small>
        </span>
        <input
          id={idDesired}
          type="number"
          min={1}
          max={500000}
          placeholder="No definido"
          value={desiredMaxOccupancy != null ? desiredMaxOccupancy : ''}
          onChange={(e) => {
            const raw = e.target.value.trim();
            if (!raw) {
              onChangeDesired(null);
              return;
            }
            const n = Math.round(Number(raw));
            onChangeDesired(Number.isFinite(n) && n > 0 ? n : null);
          }}
        />
      </label>
    )}
  </div>
);

export interface HourlyArrivalEditorProps {
  derived: DerivedEventDemand;
  onEditBar: (hourIndex: number, value: number, mode: 'keep_total' | 'update_total') => void;
  onResetCurve: () => void;
}

/**
 * Gráfica editable de llegadas por hora + ocupación simultánea estimada por franja.
 * Al editar una barra permite explícitamente elegir entre mantener el total de asistentes
 * únicos (redistribuyendo el resto) o actualizar el total al valor resultante.
 */
export const HourlyArrivalEditor: React.FC<HourlyArrivalEditorProps> = ({
  derived,
  onEditBar,
  onResetCurve,
}) => {
  const [pendingEdit, setPendingEdit] = useState<{
    hourIndex: number;
    draftValue: number;
  } | null>(null);

  const hourly = derived.hourly;
  const maxBar = Math.max(
    1,
    ...hourly.map((h) => Math.max(h.entries, h.peakOccupancy))
  );

  const currentVal =
    pendingEdit != null ? hourly[pendingEdit.hourIndex]?.entries ?? 0 : 0;
  const delta = pendingEdit != null ? pendingEdit.draftValue - currentVal : 0;
  const projectedTotal = Math.max(0, derived.plannedUniqueAttendees + delta);

  return (
    <div className="demand-curve-editor">
      <div className="demand-curve-bars" role="group" aria-label="Curva horaria de llegadas y ocupación">
        {hourly.map((slot) => {
          const isEdited = pendingEdit?.hourIndex === slot.hourIndex;
          const displayEntries = isEdited ? pendingEdit.draftValue : slot.entries;
          const entryH = Math.max(4, Math.round((displayEntries / maxBar) * 86));
          const occH = Math.max(2, Math.round((slot.peakOccupancy / maxBar) * 86));
          const isPeak = slot.hourIndex === derived.peakArrivalHourIndex;

          return (
            <div
              key={slot.hourIndex}
              className={`demand-bar-col ${isPeak ? 'is-peak' : ''} ${isEdited ? 'is-edited' : ''}`}
            >
              <div className="demand-bar-stage" title={`${slot.label} · Llegadas: ${displayEntries}/h · Ocupación máx.: ${slot.peakOccupancy}`}>
                <div
                  className="demand-bar-occ-ghost"
                  style={{height: `${occH}px`}}
                />
                <div
                  className="demand-bar-fill"
                  style={{height: `${entryH}px`}}
                />
              </div>
              <input
                type="number"
                className="demand-bar-input"
                aria-label={`Llegadas ${slot.label}`}
                min={0}
                max={derived.plannedUniqueAttendees * 4 || 50000}
                value={displayEntries}
                onChange={(e) => {
                  const val = Math.max(0, Math.round(Number(e.target.value) || 0));
                  setPendingEdit({hourIndex: slot.hourIndex, draftValue: val});
                }}
              />
              <span className="demand-bar-hour">{slot.label.slice(0, 5)}</span>
              <small className="demand-bar-occ-caption" title="Ocupación simultánea máxima en esa hora">
                {slot.peakOccupancy} occ
              </small>
            </div>
          );
        })}
      </div>

      {pendingEdit != null && delta !== 0 && (
        <div className="demand-bar-conflict-bar" role="alert">
          <div>
            Has ajustado <b>{hourly[pendingEdit.hourIndex]?.label}</b> a{' '}
            <b>{pendingEdit.draftValue} pers./h</b>. La suma pasaría de{' '}
            {derived.plannedUniqueAttendees.toLocaleString('es-ES')} a{' '}
            <b>{projectedTotal.toLocaleString('es-ES')}</b> asistentes.
          </div>
          <div className="demand-bar-conflict-actions">
            <button
              type="button"
              className="dark"
              onClick={() => {
                onEditBar(pendingEdit.hourIndex, pendingEdit.draftValue, 'keep_total');
                setPendingEdit(null);
              }}
            >
              Mantener {derived.plannedUniqueAttendees.toLocaleString('es-ES')} asistentes (redistribuir)
            </button>
            <button
              type="button"
              className="quiet"
              onClick={() => {
                onEditBar(pendingEdit.hourIndex, pendingEdit.draftValue, 'update_total');
                setPendingEdit(null);
              }}
            >
              Actualizar total a {projectedTotal.toLocaleString('es-ES')}
            </button>
            <button
              type="button"
              className="quiet"
              onClick={() => setPendingEdit(null)}
            >
              Descartar
            </button>
          </div>
        </div>
      )}

      <div className="demand-curve-legend">
        <span>
          <i className="swatch-entries" /> Llegadas/h (suma exacta:{' '}
          <b>{derived.plannedUniqueAttendees.toLocaleString('es-ES')}</b> · media:{' '}
          <b>{derived.averageArrivalsPerHour.toLocaleString('es-ES')}/h</b> · pico:{' '}
          <b>{derived.peakHourlyArrivals.toLocaleString('es-ES')}/h</b> en{' '}
          {derived.peakArrivalHourLabel})
        </span>
        <button
          type="button"
          className="quiet"
          onClick={() => {
            setPendingEdit(null);
            onResetCurve();
          }}
        >
          Restaurar forma del perfil
        </button>
      </div>
    </div>
  );
};
