import React, {useMemo, useState} from 'react';
import {cellAt, world} from '../../engine/cartography/geometry';
import {
  classifyInstallableObject,
  getContextualIncidentsForItem,
  hasGasCompatibleInstallation,
  type ContextualIncidentTemplate,
} from '../../engine/emergency/contextual-incidents';
import {INCIDENT_CATEGORIES, SEVERITY_META} from '../../engine/emergency/incident-center';
import type {EventEngine} from '../../engine/crowd/event-engine';
import type {
  EmergencyIncident,
  IncidentSeverityLevel,
  Scene,
  ScheduledIncident,
  ScheduledIncidentCondition,
  ScheduledIncidentTrigger,
  VenueMap,
} from '../../types';

export interface SimulationInspectorProps {
  item: any;
  scene: Scene;
  mapMeta: VenueMap;
  engine: EventEngine | null;
  onTriggerContextualIncident?: (
    targetId: string,
    templateId: string,
    opts?: {severity?: IncidentSeverityLevel}
  ) => void;
  onScheduleContextualIncident?: (
    spec: Omit<ScheduledIncident, 'id' | 'executed' | 'scheduledAtSec'>
  ) => void;
  onCancelScheduledIncident?: (id: string) => void;
  onInvestigateIncident?: (incidentId: string | number) => void;
}

const PROFILE_LABELS: Record<string, string> = {
  ceramic_workshop: 'Taller de cerámica',
  workshop: 'Taller / actividad',
  foodtruck: 'Foodtruck / cocina',
  commerce: 'Comercio local',
  stage: 'Escenario',
  yellow_tent: 'Carpa Amarilla',
  violet_point: 'Punto Violeta',
  toilet: 'Aseos',
  fence: 'Vallado perimetral',
  logistics: 'Zona logística / técnica',
  cover: 'Carpa / espacio cubierto',
  entrance: 'Acceso',
  generic: 'Instalación del recinto',
};

const FIRE_STAGE_LABELS: Record<string, string> = {
  conato: 'Conato localizado',
  desarrollado: 'Incendio desarrollado',
  exposicion: 'Exposición térmica a vecinos',
  propagacion: 'Propagación activa',
  controlado: 'Controlado por dotación',
  extinguido: 'Extinguido',
  hot_zone: 'Zona caliente en enfriamiento',
  approaching: 'Equipo de montaje en camino',
  installing: 'Instalando vallado perimetral',
  fenced: 'Zona asegurada y vallada',
  cleanup: 'Retirada de restos',
  inspection: 'Inspección previa a reapertura',
  reopened: 'Paso reabierto',
};

/**
 * Inspector de solo lectura en modo simulación con análisis de foco activo y
 * menú contextual «Provocar incidencia» dependiente de las propiedades del objeto.
 */
export const SimulationInspector: React.FC<SimulationInspectorProps> = ({
  item,
  scene,
  mapMeta,
  engine,
  onTriggerContextualIncident,
  onScheduleContextualIncident,
  onCancelScheduledIncident,
  onInvestigateIncident,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const templates = useMemo(
    () => getContextualIncidentsForItem(item, scene),
    [item, scene]
  );
  const [selectedTplId, setSelectedTplId] = useState<string>('');
  const activeTpl: ContextualIncidentTemplate | undefined =
    templates.find((t) => t.id === selectedTplId) || templates[0];

  const [severity, setSeverity] = useState<IncidentSeverityLevel>(
    activeTpl?.defaultSeverity || 'moderada'
  );
  const [triggerMode, setTriggerMode] =
    useState<ScheduledIncidentTrigger>('immediate');
  const [triggerMinutes, setTriggerMinutes] = useState<number>(3);
  const [delaySeconds, setDelaySeconds] = useState<number>(30);
  const [conditionKind, setConditionKind] =
    useState<ScheduledIncidentCondition>('active_fire');
  const [crowdThreshold, setCrowdThreshold] = useState<number>(80);

  const profile = classifyInstallableObject(item, scene);
  const profileLabel = PROFILE_LABELS[profile] || 'Instalación';
  const hasGas = profile === 'foodtruck' && hasGasCompatibleInstallation(item);

  const coords =
    Array.isArray(item.points) && item.points.length
      ? world(item.points[Math.floor(item.points.length / 2)], mapMeta)
      : world([item.x ?? 50, item.y ?? 50], mapMeta);
  const cellLabel = cellAt(coords, scene.meta?.grid || 10);

  const resp: any = engine?.emergency;
  const fireNode = resp?.fire?.nodes?.get?.(item.id);
  const objectIncidents: EmergencyIncident[] = (resp?.events || []).filter(
    (ev: EmergencyIncident) =>
      ev.targetObjectId === item.id || ev.stationId === item.id
  );
  const primaryFireInc =
    objectIncidents.find((ev) => ev.id === fireNode?.rowId) ||
    objectIncidents.find((ev) => ev.type === 'fire');
  const cordon = primaryFireInc
    ? resp?.fire?.cordons?.find(
        (c: {rowId: string | number}) => c.rowId === primaryFireInc.id
      )
    : null;
  const serviceThreat = resp?.fire?.serviceThreats?.find(
    (t: {serviceId: string}) => t.serviceId === item.id
  );
  const scheduledList: ScheduledIncident[] = (resp?.scheduledIncidents || []).filter(
    (s: ScheduledIncident) => s.targetId === item.id
  );

  const handleSelectTemplate = (tpl: ContextualIncidentTemplate) => {
    setSelectedTplId(tpl.id);
    setSeverity(tpl.defaultSeverity);
  };

  const handleConfirmTrigger = () => {
    if (!activeTpl) return;
    if (triggerMode === 'immediate') {
      onTriggerContextualIncident?.(item.id, activeTpl.id, {severity});
      setMenuOpen(false);
      return;
    }
    onScheduleContextualIncident?.({
      targetId: item.id,
      targetName: item.name || profileLabel,
      templateId: activeTpl.id,
      incidentType: activeTpl.engineType,
      label: activeTpl.label,
      severity,
      trigger: triggerMode,
      triggerAtSec: triggerMode === 'at_time' ? Math.max(1, triggerMinutes) * 60 : undefined,
      delaySec: triggerMode === 'after_delay' ? Math.max(5, delaySeconds) : undefined,
      condition: triggerMode === 'condition' ? conditionKind : undefined,
      conditionValue:
        triggerMode === 'condition' && conditionKind === 'crowd_threshold'
          ? crowdThreshold
          : undefined,
      sensitive: activeTpl.sensitive,
    });
    setMenuOpen(false);
  };

  return (
    <div className="sim-inspector">
      <div className="sim-insp-head">
        <span className="sim-insp-badge">{profileLabel}</span>
        <h3>{item.name || profileLabel}</h3>
        <small>
          Celda {cellLabel} · {coords[0].toFixed(1)} m, {coords[1].toFixed(1)} m
          {item.width && item.depth ? ` · ${item.width} × ${item.depth} m` : ''}
          {profile === 'foodtruck'
            ? hasGas
              ? ' · Gas compatible'
              : ' · Sin gas'
            : ''}
        </small>
      </div>

      {serviceThreat && (
        <div className="sim-insp-threat">
          <b>Amenaza térmica sobre servicio</b>
          <span>
            Foco {serviceThreat.threatenedByCode} a {serviceThreat.distanceMeters} m ·{' '}
            {serviceThreat.occupantsPresent} personas en entorno ·{' '}
            {serviceThreat.action === 'relocation_needed'
              ? 'Evaluar reubicación / protección de material'
              : 'Evaluar evacuación e interrupción segura'}
          </span>
        </div>
      )}

      {fireNode && (
        <div className="sim-insp-fire-card">
          <div className="sim-insp-fire-title">
            <b>
              {primaryFireInc?.code || 'Foco'} ·{' '}
              {FIRE_STAGE_LABELS[cordon?.state || fireNode.stage] || fireNode.stage}
            </b>
            <span>{Math.round((fireNode.damage || 0) * 100)} % daño</span>
          </div>
          <div className="sim-insp-fire-metrics">
            <span>Combustión: {fireNode.combustionRadius.toFixed(1)} m</span>
            <span>Perímetro seg.: {fireNode.safetyRadius.toFixed(1)} m</span>
          </div>
          {primaryFireInc?.spreadCause && (
            <small className="sim-insp-spread-chain">
              Cadena causal: {primaryFireInc.spreadCause}
            </small>
          )}
          {primaryFireInc?.resourceLimitation && (
            <small className="sim-insp-limit">
              {primaryFireInc.resourceLimitation}
            </small>
          )}
          {primaryFireInc && onInvestigateIncident && (
            <button
              type="button"
              className="quiet sim-insp-btn-sm"
              onClick={() => onInvestigateIncident(primaryFireInc.id)}
            >
              Investigar incidencia
            </button>
          )}
        </div>
      )}

      {objectIncidents.length > 0 && !fireNode && (
        <div className="sim-insp-inc-list">
          <b>Incidencias registradas aquí ({objectIncidents.length})</b>
          {objectIncidents.slice(-3).map((ev) => (
            <div key={ev.id} className="sim-insp-inc-row">
              <span>
                {ev.code} · {ev.sensitive ? 'Atención reservada' : ev.name}
              </span>
              {onInvestigateIncident && (
                <button
                  type="button"
                  className="quiet"
                  onClick={() => onInvestigateIncident(ev.id)}
                >
                  Analizar
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="sim-insp-trigger-wrap">
        <button
          type="button"
          id="btn-trigger-contextual-incident"
          className="dark sim-insp-trigger-btn"
          disabled={!engine}
          onClick={() => setMenuOpen((o) => !o)}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.1"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 9v4M12 17h.01" />
            <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
          </svg>
          <span>Provocar incidencia</span>
        </button>

        {!engine && (
          <p className="small-note">
            Inicia o reinicia la simulación para provocar incidencias contextuales.
          </p>
        )}

        {menuOpen && engine && (
          <div className="sim-ctx-menu" id="contextual-incident-menu">
            <div className="sim-ctx-title">
              Situaciones compatibles ({templates.length})
            </div>
            {profile === 'violet_point' && (
              <p className="sim-ctx-privacy">
                Protocolo confidencial: los avisos de Punto Violeta protegen la privacidad y anonimización.
              </p>
            )}
            <div className="sim-ctx-list">
              {templates.map((tpl) => {
                const catMeta = INCIDENT_CATEGORIES[tpl.category];
                const isActive = activeTpl?.id === tpl.id;
                return (
                  <button
                    key={tpl.id}
                    type="button"
                    data-ctx-template={tpl.id}
                    className={`sim-ctx-option ${isActive ? 'is-selected' : ''}`}
                    onClick={() => handleSelectTemplate(tpl)}
                  >
                    <span
                      className="sim-ctx-dot"
                      style={{background: catMeta.color}}
                    />
                    <div>
                      <b>{tpl.label}</b>
                      <small>{tpl.description}</small>
                    </div>
                  </button>
                );
              })}
            </div>

            {activeTpl && (
              <div className="sim-ctx-controls">
                <label>
                  Gravedad
                  <select
                    id="ctx-severity-select"
                    value={severity}
                    onChange={(e) =>
                      setSeverity(e.target.value as IncidentSeverityLevel)
                    }
                  >
                    {(
                      Object.keys(SEVERITY_META) as IncidentSeverityLevel[]
                    ).map((lv) => (
                      <option key={lv} value={lv}>
                        {SEVERITY_META[lv].label}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Momento de inicio
                  <select
                    id="ctx-trigger-select"
                    value={triggerMode}
                    onChange={(e) =>
                      setTriggerMode(e.target.value as ScheduledIncidentTrigger)
                    }
                  >
                    <option value="immediate">Inmediato (ahora)</option>
                    <option value="after_delay">Tras intervalo (s)</option>
                    <option value="at_time">En instante del evento (min)</option>
                    <option value="condition">Al cumplirse condición</option>
                  </select>
                </label>

                {triggerMode === 'after_delay' && (
                  <label>
                    Retardo (segundos)
                    <input
                      type="number"
                      min={5}
                      max={3600}
                      value={delaySeconds}
                      onChange={(e) =>
                        setDelaySeconds(Math.max(5, Number(e.target.value) || 30))
                      }
                    />
                  </label>
                )}

                {triggerMode === 'at_time' && (
                  <label>
                    Minuto simulado
                    <input
                      type="number"
                      min={1}
                      max={600}
                      value={triggerMinutes}
                      onChange={(e) =>
                        setTriggerMinutes(Math.max(1, Number(e.target.value) || 1))
                      }
                    />
                  </label>
                )}

                {triggerMode === 'condition' && (
                  <>
                    <label>
                      Condición operativa
                      <select
                        value={conditionKind}
                        onChange={(e) =>
                          setConditionKind(
                            e.target.value as ScheduledIncidentCondition
                          )
                        }
                      >
                        <option value="active_fire">
                          Si existe un incendio activo
                        </option>
                        <option value="crowd_threshold">
                          Al superar aforo presente
                        </option>
                      </select>
                    </label>
                    {conditionKind === 'crowd_threshold' && (
                      <label>
                        Personas mínimas presentes
                        <input
                          type="number"
                          min={10}
                          max={5000}
                          value={crowdThreshold}
                          onChange={(e) =>
                            setCrowdThreshold(
                              Math.max(10, Number(e.target.value) || 50)
                            )
                          }
                        />
                      </label>
                    )}
                  </>
                )}

                <div className="sim-ctx-actions">
                  <button
                    type="button"
                    id="ctx-confirm-trigger"
                    className="dark"
                    onClick={handleConfirmTrigger}
                  >
                    {triggerMode === 'immediate' ? 'Iniciar incidencia' : 'Programar'}
                  </button>
                  <button
                    type="button"
                    className="quiet"
                    onClick={() => setMenuOpen(false)}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {scheduledList.length > 0 && (
        <div className="sim-insp-scheduled">
          <b>Programadas en este elemento ({scheduledList.length})</b>
          {scheduledList.map((s) => (
            <div key={s.id} className="sim-insp-sched-row">
              <div>
                <b>{s.label}</b>
                <small>
                  {s.executed
                    ? `Ejecutada en t=${Math.round(s.executedAt || 0)} s`
                    : s.trigger === 'at_time'
                      ? `Programada min ${Math.round((s.triggerAtSec || 0) / 60)}`
                      : s.trigger === 'after_delay'
                        ? `Tras ${s.delaySec} s`
                        : 'Pendiente por condición'}
                </small>
              </div>
              {!s.executed && onCancelScheduledIncident && (
                <button
                  type="button"
                  className="quiet"
                  onClick={() => onCancelScheduledIncident(s.id)}
                >
                  Anular
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
