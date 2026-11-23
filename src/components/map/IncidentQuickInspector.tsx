import React, {useState} from 'react';
import type {EventEngine} from '../../engine/crowd/event-engine';
import type {CongestionInspectorData} from '../../engine/crowd/crowd-guidance';
import {
  categoryForIncidentType,
  formatIncidentCode,
  INCIDENT_CATEGORIES,
  incidentStatusHeadline,
  normalizeSeverity,
  SEVERITY_META,
} from '../../engine/emergency/incident-center';
import type {EmergencyIncident, Point} from '../../types';

export interface IncidentQuickInspectorProps {
  engine: EventEngine | null;
  selectedCongestionId: string | null;
  selectedIncidentId: string | number | null;
  onClose: () => void;
  onFocusPoint: (pt: Point, zoomWidth?: number) => void;
  onDispatchSteward: (congestionId: string) => void;
  onOpenFullAnalysis: (incidentId: string | number) => void;
  onOpenComparison: () => void;
}

function fmtMMSS(sec: number | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return 'Dato no disponible';
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m} min ${r} s`;
}

/**
 * Inspector compacto al hacer clic sobre una congestión o incidencia en el mapa (Sección 13).
 * Muestra «Dato no disponible» cuando no existe cálculo real, sin inventar cifras.
 */
export const IncidentQuickInspector: React.FC<IncidentQuickInspectorProps> = ({
  engine,
  selectedCongestionId,
  selectedIncidentId,
  onClose,
  onFocusPoint,
  onDispatchSteward,
  onOpenFullAnalysis,
  onOpenComparison,
}) => {
  const [studyNote, setStudyNote] = useState<string | null>(null);

  if (!engine) return null;

  if (selectedCongestionId) {
    const info: CongestionInspectorData | null =
      engine.crowdGuidance?.buildInspectorData(selectedCongestionId, engine) || null;
    if (!info) return null;

    return (
      <aside
        id="incident-quick-inspector"
        className="inc-quick-inspector"
        aria-label={info.title}
      >
        <div className="inc-quick-head">
          <div>
            <span className="inc-quick-badge" style={{background: 'rgba(193, 122, 50, 0.16)', color: '#9a3412'}}>
              {info.statusLabel}
            </span>
            <h4>{info.title}</h4>
          </div>
          <button type="button" className="close" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>

        <dl className="inc-quick-grid">
          <div>
            <dt>Inicio</dt>
            <dd>{info.startedAtLabel}</dd>
          </div>
          <div>
            <dt>Duración</dt>
            <dd>{info.durationLabel}</dd>
          </div>
          <div>
            <dt>Personas concentradas</dt>
            <dd>{info.peopleCountLabel}</dd>
          </div>
          <div>
            <dt>Densidad</dt>
            <dd>{info.densityLabel}</dd>
          </div>
          <div>
            <dt>Velocidad media</dt>
            <dd>{info.avgSpeedLabel}</dd>
          </div>
          <div>
            <dt>Personal disponible</dt>
            <dd>{info.availableStaffLabel}</dd>
          </div>
          <div className="span-2">
            <dt>Posible causa</dt>
            <dd>{info.possibleCause}</dd>
          </div>
          <div className="span-2">
            <dt>Recorridos alternativos</dt>
            <dd>{info.alternativeRoutesLabel}</dd>
          </div>
          <div className="span-2">
            <dt>Efectos secundarios / orientación</dt>
            <dd>{info.guidedSummaryLabel} · {info.sideEffectLabel}</dd>
          </div>
        </dl>

        {studyNote && <p className="inc-quick-study">{studyNote}</p>}

        <div className="inc-quick-actions">
          <button
            type="button"
            className="quiet"
            onClick={() => onFocusPoint(info.point, 48)}
          >
            Localizar
          </button>
          <button
            type="button"
            id="quick-dispatch-steward"
            className="dark"
            disabled={!info.canDispatchSteward}
            onClick={() => {
              onDispatchSteward(info.id);
              setStudyNote('Auxiliar enviado físicamente hacia la congestión.');
            }}
          >
            Enviar personal de orientación
          </button>
          <button
            type="button"
            id="quick-study-diversion"
            className="quiet"
            onClick={() => {
              const res = engine.crowdGuidance?.studyAlternative(engine, info.id);
              setStudyNote(
                res
                  ? `${res.caveat} (Sin aplicar cambios en la simulación).`
                  : 'Dato no disponible'
              );
            }}
          >
            Proponer desvío
          </button>
          <button
            type="button"
            className="quiet"
            onClick={onOpenComparison}
          >
            Comparar corrección
          </button>
        </div>
      </aside>
    );
  }

  if (selectedIncidentId != null) {
    const row = (engine.emergency?.events || []).find(
      (ev: EmergencyIncident) => String(ev.id) === String(selectedIncidentId)
    );
    if (!row) return null;

    const cat = row.category || categoryForIncidentType(row.type);
    const catMeta = INCIDENT_CATEGORIES[cat];
    const sev = normalizeSeverity(row.severity, row.type);
    const sevMeta = SEVERITY_META[sev];
    const code = row.code || formatIncidentCode(cat, Number(row.id) || 1);
    const sensitive = !!row.sensitive || cat === 'violet_point';
    const durSec =
      row.created != null
        ? (row.closed ?? engine.time) - row.created
        : undefined;

    return (
      <aside
        id="incident-quick-inspector"
        className="inc-quick-inspector"
        aria-label={`Incidencia ${code}`}
      >
        <div className="inc-quick-head">
          <div>
            <span
              className="inc-quick-badge"
              style={{background: catMeta.softBg, color: catMeta.color}}
            >
              {code} · {sevMeta.label}
            </span>
            <h4>
              {sensitive ? 'Punto Violeta · Atención reservada' : row.name || catMeta.label}
            </h4>
          </div>
          <button type="button" className="close" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>

        <dl className="inc-quick-grid">
          <div>
            <dt>Estado</dt>
            <dd>{incidentStatusHeadline(row, engine.time)}</dd>
          </div>
          <div>
            <dt>Inicio / duración</dt>
            <dd>
              {fmtMMSS(row.created)} · {fmtMMSS(durSec)}
            </dd>
          </div>
          <div>
            <dt>Recurso asignado</dt>
            <dd>{row.resourceName || 'Pendiente de asignación'}</dd>
          </div>
          <div>
            <dt>Ubicación</dt>
            <dd>
              {sensitive
                ? 'Reservada (privacidad Punto Violeta)'
                : row.point
                  ? `${row.point[0].toFixed(1)} m, ${row.point[1].toFixed(1)} m`
                  : 'Dato no disponible'}
            </dd>
          </div>
        </dl>

        <div className="inc-quick-actions">
          {!sensitive && row.point && (
            <button
              type="button"
              className="quiet"
              onClick={() => onFocusPoint(row.point!, 50)}
            >
              Localizar
            </button>
          )}
          <button
            type="button"
            className="dark"
            onClick={() => onOpenFullAnalysis(row.id)}
          >
            Inspeccionar / Ver evolución
          </button>
          <button type="button" className="quiet" onClick={onOpenComparison}>
            Comparar corrección
          </button>
        </div>
      </aside>
    );
  }

  return null;
};
