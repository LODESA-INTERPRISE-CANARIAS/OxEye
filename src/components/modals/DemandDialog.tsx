import React, {useEffect, useMemo, useRef, useState} from 'react';
import {buildObjectiveDemandReport} from '../../engine/planning/demand';
import {
  deriveEventDemand,
  editHourlyArrivalBar,
  ensureEventDemandConfig,
  getDemandSyncStatus,
  proposeSmartDemandUpdates,
  resetCurveToProfile,
  updateEventDemand,
} from '../../engine/planning/event-demand';
import {ensureProjectObjectives} from '../../engine/planning/objectives';
import type {EventEngine} from '../../engine/crowd/event-engine';
import {useProjectStore} from '../../store/useProjectStore';
import type {DemandInputs, EventDemandConfig} from '../../types';
import {
  AttendanceProfileSelector,
  AudienceTotalInput,
  CapacityInput,
  DemandSyncBadge,
  DwellTimeInput,
  EventDurationInput,
  HourlyArrivalEditor,
} from '../demand/DemandControls';

const serviceFieldMeta: Array<{
  key: keyof EventDemandConfig['serviceParams'];
  label: string;
  min: number;
  max: number;
}> = [
  {key: 'foodShare', label: 'Compra comida (%)', min: 0, max: 100},
  {key: 'serviceHourly', label: 'Servicios/h por puesto', min: 1, max: 500},
  {key: 'utilization', label: 'Utilización objetivo (%)', min: 10, max: 100},
  {key: 'seatedShare', label: 'Comidas sentadas (%)', min: 0, max: 100},
  {key: 'mealMin', label: 'Comida mínima (min)', min: 1, max: 180},
  {key: 'mealMax', label: 'Comida máxima (min)', min: 1, max: 240},
  {key: 'tablesPerRoof', label: 'Mesas por carpa', min: 1, max: 100},
  {key: 'shopShare', label: 'Visita comercios (%)', min: 0, max: 100},
  {key: 'shopMinutes', label: 'Atención comercial (min)', min: 1, max: 120},
  {key: 'shopPlaces', label: 'Clientes simultáneos/comercio', min: 1, max: 50},
  {key: 'toiletShare', label: 'Usos de baño por llegada (%)', min: 0, max: 100},
  {key: 'toiletMinutes', label: 'Uso del baño (min)', min: 1, max: 60},
  {key: 'children', label: 'Menores en la mezcla (%)', min: 0, max: 100},
  {key: 'older', label: 'Mayores en la mezcla (%)', min: 0, max: 100},
];

type DemandTab = 'demand' | 'needs' | 'proposals' | 'compare';
type DemandViewMode = 'basic' | 'advanced';

export interface DemandDialogProps {
  engine?: EventEngine | null;
  appliedRunRevision?: number | null;
  onRequestDemandChange?: (
    patch: Partial<EventDemandConfig> & {
      serviceParamsPatch?: Partial<EventDemandConfig['serviceParams']>;
    }
  ) => void;
}

/**
 * Modal unificado de Demanda, Necesidades y Balance de servicios conectado en tiempo real
 * a `scene.demandConfig` sin duplicar copias locales desincronizadas.
 */
export const DemandDialog: React.FC<DemandDialogProps> = ({
  engine = null,
  appliedRunRevision = null,
  onRequestDemandChange,
}) => {
  const dlgRef = useRef<HTMLDialogElement | null>(null);
  const activeModal = useProjectStore((s) => s.activeModal);
  const currentScene = useProjectStore((s) => s.currentScene);
  const setActiveModal = useProjectStore((s) => s.setActiveModal);
  const updateScene = useProjectStore((s) => s.updateScene);
  const showToast = useProjectStore((s) => s.showToast);

  const isOpen = activeModal === 'demand';
  const scene = currentScene();
  const objectives = useMemo(() => ensureProjectObjectives(scene), [scene]);
  const config = useMemo(() => ensureEventDemandConfig(scene), [scene]);
  const derived = useMemo(() => deriveEventDemand(scene, config), [scene, config]);
  const syncStatus = useMemo(
    () => getDemandSyncStatus(scene, appliedRunRevision, engine?.time || 0),
    [scene, appliedRunRevision, engine?.time]
  );
  const smartProposal = useMemo(() => proposeSmartDemandUpdates(scene), [scene]);

  const [tab, setTab] = useState<DemandTab>('demand');
  const [viewMode, setViewMode] = useState<DemandViewMode>('basic');
  const [showSmartPreview, setShowSmartPreview] = useState(false);

  useEffect(() => {
    const dlg = dlgRef.current;
    if (!dlg) return;
    if (isOpen && !dlg.open) {
      dlg.showModal();
    } else if (!isOpen && dlg.open) {
      dlg.close();
    }
  }, [isOpen]);

  const applyPatch = (
    patch: Partial<EventDemandConfig> & {
      serviceParamsPatch?: Partial<EventDemandConfig['serviceParams']>;
    }
  ) => {
    if (onRequestDemandChange) {
      onRequestDemandChange(patch);
      return;
    }
    updateScene((sc) => {
      updateEventDemand(sc, patch);
    }, true);
  };

  const handleEditBar = (
    hourIndex: number,
    value: number,
    mode: 'keep_total' | 'update_total'
  ) => {
    const previewScene = structuredClone(scene);
    const nextCfg = editHourlyArrivalBar(previewScene, hourIndex, value, mode);
    applyPatch({
      curveProfile: nextCfg.curveProfile,
      hourlyArrivals: nextCfg.hourlyArrivals,
      uniqueAttendees: nextCfg.uniqueAttendees,
      provenance: 'manual',
    });
  };

  const handleResetProfile = () => {
    const previewScene = structuredClone(scene);
    const targetProfile =
      config.curveProfile === 'custom'
        ? config.hours >= 10
          ? 'full_day'
          : 'trade_fair'
        : config.curveProfile;
    const nextCfg = resetCurveToProfile(previewScene, targetProfile);
    applyPatch({
      curveProfile: nextCfg.curveProfile,
      hourlyArrivals: nextCfg.hourlyArrivals,
      provenance: 'curve_preset',
    });
  };

  const reportInputs: DemandInputs = derived.legacyDemandInputs;
  const report = useMemo(
    () => buildObjectiveDemandReport(scene, reportInputs),
    [scene, reportInputs]
  );

  const avgPlan = derived.averageServicesPlan;
  const criticalPlan = derived.criticalServicesPlan;

  return (
    <dialog
      id="demand-dialog"
      className="wide-modal demand-modal-shell"
      ref={dlgRef}
      onClose={() => {
        if (isOpen) setActiveModal(null);
      }}
    >
      <div id="demand-body" className="demand-modal-layout">
        {/* Cabecera fija con resumen permanente y estado de sincronización */}
        <header className="demand-modal-header">
          <div className="demand-header-top">
            <div>
              <h2>¿Qué servicios necesita el evento?</h2>
              <p className="demand-header-sub">
                Fuente única conectada con Simular, Necesidades y Objetivos SMART (
                {objectives.selected.length} prioridad
                {objectives.selected.length === 1 ? '' : 'es'}).
              </p>
            </div>
            <div className="demand-header-actions">
              <DemandSyncBadge
                state={syncStatus.state}
                label={syncStatus.label}
                detail={syncStatus.detail}
              />
              <div className="demand-mode-toggle" role="group" aria-label="Nivel de detalle">
                <button
                  type="button"
                  data-demand-mode="basic"
                  className={viewMode === 'basic' ? 'is-active' : ''}
                  onClick={() => setViewMode('basic')}
                >
                  Modo básico
                </button>
                <button
                  type="button"
                  data-demand-mode="advanced"
                  className={viewMode === 'advanced' ? 'is-active' : ''}
                  onClick={() => setViewMode('advanced')}
                >
                  Modo avanzado
                </button>
              </div>
            </div>
          </div>

          <div className="demand-summary-strip" role="region" aria-label="Resumen permanente de afluencia">
            <div className="demand-summary-kpi">
              <small>Asistentes únicos</small>
              <strong>{derived.plannedUniqueAttendees.toLocaleString('es-ES')}</strong>
            </div>
            <div className="demand-summary-kpi">
              <small>Llegadas por hora</small>
              <strong>
                Media {derived.averageArrivalsPerHour.toLocaleString('es-ES')}/h · Pico{' '}
                {derived.peakHourlyArrivals.toLocaleString('es-ES')}/h
              </strong>
              <span className="demand-kpi-meta">en {derived.peakArrivalHourLabel}</span>
            </div>
            <div className="demand-summary-kpi">
              <small>Ocupación simultánea prevista</small>
              <strong>
                Máx. {derived.peakSimultaneousOccupancy.toLocaleString('es-ES')} · Media{' '}
                {derived.averageSimultaneousOccupancy.toLocaleString('es-ES')}
              </strong>
              <span className="demand-kpi-meta">punta en {derived.peakOccupancyHourLabel}</span>
            </div>
            <div
              className={`demand-summary-kpi ${
                derived.capacityStatus.exceedsAuthorized ? 'is-warning' : ''
              }`}
            >
              <small>Aforo autorizado</small>
              <strong>{derived.capacityStatus.label}</strong>
              <span className="demand-kpi-meta">
                {derived.capacityStatus.defined
                  ? `${derived.capacityStatus.peakOccupancyPct}% en hora punta`
                  : 'Pendiente de definir'}
              </span>
            </div>
          </div>

          <div className="smart-substep-bar" style={{marginTop: '10px', marginBottom: 0}}>
            {(
              [
                ['demand', '1. Demanda y curva'],
                ['needs', '2. Necesidades y balance'],
                ['proposals', '3. Propuestas'],
                ['compare', '4. Comparación y variantes'],
              ] as Array<[DemandTab, string]>
            ).map(([tKey, tLabel]) => (
              <button
                key={tKey}
                type="button"
                data-demand-tab={tKey}
                className={`smart-subtab ${tab === tKey ? 'is-active' : ''}`}
                onClick={() => setTab(tKey)}
              >
                {tLabel}
              </button>
            ))}
          </div>
        </header>

        {/* Cuerpo desplazable */}
        <div className="demand-modal-body">
          {tab === 'demand' && (
            <form
              id="demand-form"
              onSubmit={(e) => {
                e.preventDefault();
                setTab('needs');
              }}
            >
              {/* Banner no destructivo de sugerencias SMART / Programa */}
              <div className="demand-smart-toolbar">
                <button
                  type="button"
                  id="demand-suggest-smart"
                  className={smartProposal.hasSuggestions ? 'dark' : 'quiet'}
                  onClick={() => setShowSmartPreview((prev) => !prev)}
                >
                  {smartProposal.hasSuggestions
                    ? `Revisar sugerencias SMART y Programa (${smartProposal.items.length})`
                    : 'Sin sugerencias SMART pendientes'}
                </button>
                <button
                  type="button"
                  className="quiet"
                  onClick={() => setActiveModal('objectives')}
                >
                  Editar Objetivos SMART
                </button>
              </div>

              {showSmartPreview && (
                <div className="demand-smart-preview" role="region" aria-label="Vista previa de sugerencias">
                  {smartProposal.hasSuggestions ? (
                    <>
                      <p style={{margin: '0 0 6px', fontSize: '0.84rem'}}>
                        <b>Cambios propuestos desde tus Objetivos SMART y Programa:</b> no se aplicarán
                        hasta que los confirmes.
                      </p>
                      <ul className="demand-suggestion-list">
                        {smartProposal.items.map((item) => (
                          <li key={item.field}>
                            <b>{item.label}:</b> {item.currentDisplay} →{' '}
                            <b>{item.suggestedDisplay}</b>{' '}
                            <span style={{color: 'var(--muted)'}}>({item.reason})</span>
                          </li>
                        ))}
                      </ul>
                      <div style={{display: 'flex', gap: '8px', marginTop: '8px'}}>
                        <button
                          type="button"
                          id="demand-confirm-smart"
                          className="dark"
                          onClick={() => {
                            applyPatch(smartProposal.patch);
                            setShowSmartPreview(false);
                            showToast('Sugerencias SMART aplicadas y sincronizadas.');
                          }}
                        >
                          Aplicar sugerencias confirmadas
                        </button>
                        <button
                          type="button"
                          className="quiet"
                          onClick={() => setShowSmartPreview(false)}
                        >
                          Mantener valores actuales
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="small-note" style={{margin: 0}}>
                      Tus valores actuales ya coinciden con los objetivos SMART y programa configurados.
                    </p>
                  )}
                </div>
              )}

              {/* A. Datos del evento */}
              <section className="demand-section-card">
                <div className="demand-section-title">A · Datos del evento</div>
                <div className="demand-grid">
                  <AudienceTotalInput
                    value={config.uniqueAttendees}
                    onChange={(nextTotal) =>
                      applyPatch({uniqueAttendees: nextTotal, provenance: 'manual'})
                    }
                  />
                  <EventDurationInput
                    hours={config.hours}
                    startHour={config.startHour}
                    onChangeHours={(h) => applyPatch({hours: h, provenance: 'manual'})}
                    onChangeStartHour={(st) => applyPatch({startHour: st, provenance: 'manual'})}
                  />
                  <label className="demand-field">
                    <span>Fecha principal</span>
                    <input
                      type="date"
                      value={config.date}
                      onChange={(e) => applyPatch({date: e.target.value, provenance: 'manual'})}
                    />
                  </label>
                  <label className="demand-field">
                    <span>Superficie operativa libre (m²)</span>
                    <input
                      type="number"
                      name="area"
                      min={50}
                      max={100000}
                      value={derived.operatingAreaM2}
                      onChange={(e) => {
                        const val = Math.max(50, Math.round(Number(e.target.value) || 50));
                        applyPatch({operationalAreaM2: val, provenance: 'manual'});
                      }}
                    />
                  </label>
                </div>
              </section>

              {/* B. Perfil horario, permanencia y aforo */}
              <section className="demand-section-card">
                <div className="demand-section-title">
                  B · Perfil horario, permanencia y referencia de aforo
                </div>
                <div className="demand-grid">
                  <AttendanceProfileSelector
                    id="attendance-curve-select"
                    value={config.curveProfile}
                    onChange={(prof) =>
                      applyPatch({
                        curveProfile: prof,
                        provenance: prof === 'custom' ? 'manual' : 'curve_preset',
                      })
                    }
                  />
                  <DwellTimeInput
                    value={config.dwellTimeMinutes}
                    onChange={(min) => applyPatch({dwellTimeMinutes: min, provenance: 'manual'})}
                  />
                  <CapacityInput
                    authorizedCapacity={config.authorizedCapacity}
                    desiredMaxOccupancy={config.desiredMaxOccupancy}
                    showDesired={viewMode === 'advanced'}
                    onChangeAuthorized={(val) =>
                      applyPatch({authorizedCapacity: val, provenance: 'manual'})
                    }
                    onChangeDesired={(val) =>
                      applyPatch({desiredMaxOccupancy: val, provenance: 'manual'})
                    }
                  />
                </div>

                {viewMode === 'advanced' && (
                  <div className="demand-grid" style={{marginTop: '10px'}}>
                    <label className="demand-field">
                      <span>Tasa estimada de reentradas (%)</span>
                      <input
                        type="number"
                        min={0}
                        max={50}
                        value={Math.round(config.reentryRate * 100)}
                        onChange={(e) =>
                          applyPatch({
                            reentryRate: Math.max(0, Math.min(50, Number(e.target.value) || 0)) / 100,
                            provenance: 'manual',
                          })
                        }
                      />
                    </label>
                    <label className="demand-field">
                      <span>Dispersión de permanencia (%)</span>
                      <input
                        type="number"
                        min={5}
                        max={90}
                        value={Math.round((config.dwellDistribution?.spreadRatio ?? 0.35) * 100)}
                        onChange={(e) =>
                          applyPatch({
                            dwellDistribution: {
                              ...config.dwellDistribution,
                              spreadRatio:
                                Math.max(5, Math.min(90, Number(e.target.value) || 35)) / 100,
                            },
                            provenance: 'manual',
                          })
                        }
                      />
                    </label>
                  </div>
                )}
              </section>

              {/* C. Curva horaria de llegadas y ocupación simultánea */}
              <section className="demand-section-card">
                <div className="demand-section-title">
                  C · Curva horaria de llegadas y ocupación simultánea
                </div>
                <HourlyArrivalEditor
                  derived={derived}
                  onEditBar={handleEditBar}
                  onResetCurve={handleResetProfile}
                />
              </section>

              {/* D. Parámetros de demanda de servicios */}
              <section className="demand-section-card">
                <div className="demand-section-title">
                  D · Hipótesis de consumo y dimensionamiento de servicios
                </div>
                {viewMode === 'basic' ? (
                  <p className="small-note" style={{margin: 0}}>
                    Usando parámetros de referencia: <b>{config.serviceParams.foodShare}%</b> comida ·{' '}
                    <b>{config.serviceParams.shopShare}%</b> comercios ·{' '}
                    <b>{config.serviceParams.toiletShare}%</b> aseos · uso objetivo{' '}
                    <b>{config.serviceParams.utilization}%</b>. Cambia a{' '}
                    <button
                      type="button"
                      className="link-inline-btn"
                      onClick={() => setViewMode('advanced')}
                    >
                      Modo avanzado
                    </button>{' '}
                    para personalizar cada ratio.
                  </p>
                ) : (
                  <div className="demand-grid">
                    {serviceFieldMeta.map((f) => (
                      <label key={f.key} className="demand-field">
                        <span>{f.label}</span>
                        <input
                          type="number"
                          name={f.key}
                          min={f.min}
                          max={f.max}
                          value={config.serviceParams[f.key]}
                          onChange={(e) => {
                            const val = Math.max(
                              f.min,
                              Math.min(f.max, Number(e.target.value) || f.min)
                            );
                            applyPatch({
                              serviceParamsPatch: {[f.key]: val},
                              provenance: 'manual',
                            });
                          }}
                        />
                      </label>
                    ))}
                  </div>
                )}
              </section>
              <div style={{display: 'flex', gap: '8px', justifyContent: 'flex-end'}}>
                <button type="submit" className="dark">
                  Calcular necesidades y balance frente a inventario
                </button>
              </div>
            </form>
          )}

          {tab === 'needs' && (
            <div id="demand-results">
              <h3>Necesidades calculadas y balance frente al inventario</h3>
              <p>
                Ocupación simultánea <b>media: {derived.averageSimultaneousOccupancy} pers.</b> ·{' '}
                <b>punta crítica: {derived.peakSimultaneousOccupancy} pers.</b> ({derived.peakOccupancyHourLabel}) ·{' '}
                Huella en carga punta: <b>{Math.round(criticalPlan.modules)} m²</b> ·{' '}
                Resto libre antes de vías: <b>{Math.round(criticalPlan.remaining)} m²</b> (vs media{' '}
                {Math.round(avgPlan.modules)} m²).
              </p>

              <table className="demand-balance-table">
                <thead>
                  <tr>
                    <th>Servicio</th>
                    <th>En plano</th>
                    <th>Demanda media ({derived.averageArrivalsPerHour}/h)</th>
                    <th>Franja crítica ({derived.peakArrivalHourLabel})</th>
                    <th>Balance en punta</th>
                  </tr>
                </thead>
                <tbody>
                  {derived.serviceBalance.map((row) => (
                    <tr key={row.key}>
                      <td>{row.label}</td>
                      <td>{row.placed}</td>
                      <td>{row.requiredAverage}</td>
                      <td>{row.requiredPeakSlot}</td>
                      <td
                        className={
                          row.deltaAtPeak < 0 ? 'balance-deficit' : 'balance-ok'
                        }
                      >
                        {row.deltaAtPeak === 0
                          ? 'Equilibrado'
                          : row.deltaAtPeak > 0
                            ? `+${row.deltaAtPeak} margen`
                            : `${row.deltaAtPeak} déficit`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <h3 style={{marginTop: '14px'}}>Evolución horaria prevista</h3>
              <table className="demand-balance-table">
                <thead>
                  <tr>
                    <th>Franja</th>
                    <th>Llegadas</th>
                    <th>Salidas</th>
                    <th>Ocupación máx.</th>
                    <th>% s/ Aforo</th>
                  </tr>
                </thead>
                <tbody>
                  {derived.hourly.map((slot) => (
                    <tr
                      key={slot.hourIndex}
                      className={slot.isCriticalPeak ? 'is-critical-row' : ''}
                    >
                      <td>
                        {slot.label} {slot.isCriticalPeak ? '· Punta' : ''}
                      </td>
                      <td>{slot.entries}</td>
                      <td>{slot.exits}</td>
                      <td>{slot.peakOccupancy}</td>
                      <td>
                        {slot.occupancyRatePct != null
                          ? `${slot.occupancyRatePct}%`
                          : 'No definido'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <h3 style={{marginTop: '14px'}}>Necesidades derivadas de tus Objetivos SMART</h3>
              <ul style={{margin: '6px 0 10px 18px', fontSize: '0.86rem'}}>
                {report.objectiveNeeds.map((n) => (
                  <li key={n.objectiveId}>
                    <b>{n.objectiveLabel}:</b> {n.recommendation}{' '}
                    {n.resources.length ? `(recursos: ${n.resources.join(', ')})` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {tab === 'proposals' && (
            <div className="smart-priority-list">
              {report.proposals.map((prop) => (
                <article key={prop.key} className="batch-card" style={{padding: '10px'}}>
                  <h3>{prop.title}</h3>
                  <p>
                    <b>Dotación orientativa:</b> {prop.food} comida · {prop.tables} mesas ·{' '}
                    {prop.roofs} carpas · {prop.shops} comercios · {prop.toilets} aseos
                  </p>
                  <p>
                    <b>Ocupación:</b> {prop.occupiedAreaM2} m² ·{' '}
                    <b>Coste estimado orientativo:</b>{' '}
                    {prop.estimatedCost.toLocaleString('es-ES')} €
                  </p>
                  <p style={{color: '#15803d', fontSize: '0.84rem'}}>
                    <b>Ventajas:</b> {prop.advantages.join(' ')}
                  </p>
                  <p style={{color: '#b45309', fontSize: '0.84rem'}}>
                    <b>Compromisos:</b> {prop.tradeoffs.join(' ')}
                  </p>
                </article>
              ))}
            </div>
          )}

          {tab === 'compare' && (
            <div>
              <h3>Comparación de configuraciones y variantes</h3>
              {(scene.demandVariants || []).length > 0 && (
                <div className="demand-section-card" style={{marginBottom: '10px'}}>
                  <div className="demand-section-title">
                    Variantes guardadas durante simulaciones ({scene.demandVariants!.length})
                  </div>
                  {scene.demandVariants!.map((variant) => {
                    const vDerived = deriveEventDemand(scene, variant.demandConfig);
                    return (
                      <div key={variant.id} className="demand-variant-row">
                        <div>
                          <b>{variant.name}</b>
                          <div className="small-note" style={{margin: 0}}>
                            {vDerived.plannedUniqueAttendees.toLocaleString('es-ES')} únicos ·{' '}
                            {variant.demandConfig.hours} h · punta{' '}
                            {vDerived.peakSimultaneousOccupancy} occ.
                          </div>
                        </div>
                        <button
                          type="button"
                          className="quiet"
                          onClick={() => {
                            applyPatch(variant.demandConfig);
                            showToast(`Variante «${variant.name}» activada como configuración principal.`);
                          }}
                        >
                          Activar
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              {report.tradeoffsSummary.length > 0 && (
                <div className="smart-tradeoffs-box" style={{marginBottom: '10px'}}>
                  <b>Compromisos activos de objetivos:</b>
                  {report.tradeoffsSummary.map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </div>
              )}
              <p className="small-note">
                Para evaluar cada alternativa en simulación real (colas, evacuación, lluvia y
                cumplimiento ponderado por tus Objetivos SMART), abre el comparador unificado.
              </p>
              <div style={{display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px'}}>
                <button
                  type="button"
                  className="dark"
                  onClick={() => setActiveModal('laboratory')}
                >
                  Abrir comparador de diseños (simulación 15 min)
                </button>
                <button
                  type="button"
                  onClick={() => setActiveModal('inventory')}
                >
                  Ajustar inventario manualmente
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Pie fijo */}
        <footer className="demand-modal-footer">
          <div className="demand-footer-meta">
            {config.legacyHourlyRate != null && (
              <span className="small-note" style={{margin: 0}}>
                Referencia previa heredada: {config.legacyHourlyRate}/h conservada
              </span>
            )}
          </div>
          <div className="demand-footer-actions">
            {tab === 'demand' && (
              <button type="submit" form="demand-form" className="quiet">
                Ver balance en Necesidades
              </button>
            )}
            <form method="dialog" style={{margin: 0}}>
              <button type="submit" className="quiet">
                Cerrar
              </button>
            </form>
          </div>
        </footer>
      </div>
    </dialog>
  );
};
