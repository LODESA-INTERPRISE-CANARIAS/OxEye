import React, {useEffect, useState} from 'react';
import {
  cellAt,
  column,
  world,
} from '../../engine/cartography/geometry';
import {
  buildIncidentExportPayload,
  buildIncidentTimelineCsv,
  categoryForIncidentType,
  evaluateIncidentManagement,
  formatIncidentCode,
  formatRelativeTime,
  INCIDENT_CATEGORIES,
  incidentStatusHeadline,
  normalizeSeverity,
  runAlternativeIncidentTrial,
  SEVERITY_META,
  type AlternativeChangeKind,
  type AlternativeComparisonResult,
} from '../../engine/emergency/incident-center';
import {downloadFile} from '../../db/repository';
import {formatEventTimeOfDay, resolveScheduleWindow} from './SimulationStrip';
import type {EmergencyIncident, PhaseViewKey, Scene} from '../../types';

export interface IncidentAnalysisPanelProps {
  incident: EmergencyIncident;
   
  engine: any;
  baseScene: Scene;
  phase: PhaseViewKey;
  replayLog: Array<{time: number; kind: string; value: unknown}>;
  savedMainTime: number;
  currentTime: number;
  playing: boolean;
  playbackSpeed: 1 | 2 | 5 | 10 | 50;
  viewMode: 'focus' | 'context';
  privacyMode: 'public' | 'authorized_synthetic';
  onSeekTime: (globalSeconds: number) => void;
  onTogglePlay: () => void;
  onChangeSpeed: (s: 1 | 2 | 5 | 10 | 50) => void;
  onChangeViewMode: (m: 'focus' | 'context') => void;
  onChangePrivacyMode: (p: 'public' | 'authorized_synthetic') => void;
  onFocusMap: () => void;
  onSelectSimultaneous: (id: string | number) => void;
  onExit: () => void;
}

function fmtSeconds(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return '—';
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m} min ${r} s`;
}

/**
 * Panel «Análisis de incidencia» con identificación, línea temporal T+00:00,
 * reproductor determinista, métricas de gestión, exportación y comparación alternativa.
 */
export const IncidentAnalysisPanel: React.FC<IncidentAnalysisPanelProps> = ({
  incident,
  engine,
  baseScene,
  phase,
  replayLog,
  savedMainTime,
  currentTime,
  playing,
  playbackSpeed,
  viewMode,
  privacyMode,
  onSeekTime,
  onTogglePlay,
  onChangeSpeed,
  onChangeViewMode,
  onChangePrivacyMode,
  onFocusMap,
  onSelectSimultaneous,
  onExit,
}) => {
  const [comparison, setComparison] =
    useState<AlternativeComparisonResult | null>(null);
  const [selectedAlt, setSelectedAlt] =
    useState<AlternativeChangeKind>('add_extra_unit');
  const [showCompareBox, setShowCompareBox] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onExit();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onExit]);

  useEffect(() => {
    setComparison(null);
  }, [incident.id]);

  const cat = incident.category || categoryForIncidentType(incident.type);
  const catMeta = INCIDENT_CATEGORIES[cat];
  const sev = normalizeSeverity(incident.severity, incident.type);
  const sevMeta = SEVERITY_META[sev];
  const code =
    incident.code || formatIncidentCode(cat, Number(incident.id) || 1);
  const win = resolveScheduleWindow(baseScene, phase);
  const isRedactedViolet =
    cat === 'violet_point' && privacyMode === 'public';

  const originTime = incident.created ?? 0;
  const maxPlaybackTime = Math.max(
    originTime,
    savedMainTime,
    incident.closed ?? savedMainTime
  );
  const relCurrent = Math.max(0, currentTime - originTime);
  const relMax = Math.max(1, maxPlaybackTime - originTime);

  const cordon = engine?.emergency?.fire?.cordons?.find(
    (c: {rowId: string | number}) => c.rowId === incident.id
  );
  const statusText = incidentStatusHeadline(
    incident,
    currentTime,
    cordon?.state
  );
  const timeline = incident.timeline || [];
  const metrics = evaluateIncidentManagement(incident, engine);

  const nextMilestone = timeline.find((ev) => ev.time > currentTime + 0.5);

  const globalStartClock = formatEventTimeOfDay(originTime, win.from, win.to);
  const globalCurrentClock = formatEventTimeOfDay(
    currentTime,
    win.from,
    win.to
  );
  const globalDetectClock =
    incident.reportedAt != null
      ? formatEventTimeOfDay(incident.reportedAt, win.from, win.to)
      : 'Pendiente';

  const originBadge =
    incident.originMode === 'spread' || incident.parentIncidentId != null
      ? 'Propagación térmica'
      : incident.originMode === 'manual'
        ? 'Manual contextual'
        : 'Automática';

  const childSpreadRows = ((engine?.emergency?.events || []) as EmergencyIncident[]).filter(
    (ev) => ev.parentIncidentId === incident.id
  );
  const fireNode = engine?.emergency?.fire?.nodes?.get?.(
    incident.targetObjectId || incident.stationId
  );

  const locationLabel = isRedactedViolet
    ? 'Servicio Punto Violeta (ubicación individual reservada)'
    : incident.point
      ? `Celda ${cellAt(incident.point, baseScene.meta?.grid || 10)} (${incident.point[0].toFixed(
          1
        )} m, ${incident.point[1].toFixed(1)} m)`
      : `Zona ${column(0)}1`;

  const mapMeta = engine?.g?.m || {widthMeters: 140, heightMeters: 100};
  const nearAccess =
    !isRedactedViolet && incident.point && baseScene.entrances?.length
      ? baseScene.entrances.reduce(
          (best, ent) => {
            const p = world([ent.x, ent.y], mapMeta);
            const d = Math.hypot(
              p[0] - incident.point![0],
              p[1] - incident.point![1]
            );
            return !best || d < best.d ? {ent, d} : best;
          },
          null as {ent: (typeof baseScene.entrances)[number]; d: number} | null
        )?.ent || null
      : null;

  const simultaneousRows = ((engine?.emergency?.events || []) as EmergencyIncident[]).filter(
    (r) =>
      r.id !== incident.id &&
      (incident.simultaneousIds?.includes(r.id) ||
        Math.abs((r.created || 0) - originTime) <= 120)
  );

  const handleRunAlternative = (kind: AlternativeChangeKind) => {
    setSelectedAlt(kind);
    const res = runAlternativeIncidentTrial(
      baseScene,
      incident,
      replayLog,
      kind,
      metrics,
      savedMainTime
    );
    setComparison(res);
    setShowCompareBox(true);
  };

  const handleExportJson = () => {
    const payload = buildIncidentExportPayload(
      incident,
      engine,
      metrics,
      privacyMode,
      globalCurrentClock,
      comparison
    );
    downloadFile(
      `${code}_Analisis_Incidencia.json`,
      JSON.stringify(payload, null, 2)
    );
  };

  const handleExportCsv = () => {
    const csv = buildIncidentTimelineCsv(incident, privacyMode);
    downloadFile(`${code}_Cronologia.csv`, csv, 'text/csv;charset=utf-8');
  };

  const handleExportPdf = () => {
    const payload = buildIncidentExportPayload(
      incident,
      engine,
      metrics,
      privacyMode,
      globalCurrentClock,
      comparison
    );
    const w = window.open('', '_blank', 'width=860,height=740');
    if (!w) return;
    const svgEl = document.getElementById('map');
    const svgSnapshot = svgEl ? svgEl.outerHTML : '';
    const rowsHtml = (timeline || [])
      .map(
        (ev) =>
          `<tr><td><b>${formatRelativeTime(
            ev.relTime
          )}</b></td><td>${formatEventTimeOfDay(
            ev.time,
            win.from,
            win.to
          )}</td><td>${ev.label}</td><td>${
            isRedactedViolet ? 'Registro reservado de servicio.' : ev.detail
          }</td></tr>`
      )
      .join('');
    w.document.write(
      `<!doctype html><html lang="es"><head><meta charset="utf-8"/><title>Ficha ${code} — OxEye</title>` +
        '<style>body{font-family:system-ui,sans-serif;padding:24px;color:#1e293b}h1{margin:0 0 6px}table{width:100%;border-collapse:collapse;margin:12px 0;font-size:12px}th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left}svg{max-width:100%;max-height:280px;border:1px solid #cbd5e1;border-radius:8px}.note{font-size:11px;color:#475569}</style></head><body>' +
        `<h1>${code} · ${catMeta.label} (${sevMeta.label})</h1>` +
        `<p><b>Instante de captura:</b> ${globalCurrentClock} (${formatRelativeTime(
          relCurrent
        )}) · <b>Ubicación:</b> ${locationLabel}</p>` +
        `<p><b>Estado:</b> ${statusText} · <b>Recursos:</b> ${
          metrics.resourcesUsed.join(', ') || 'Sin asignar'
        }</p>` +
        `<p class="note">${String(payload.privacidad)}</p>` +
        (svgSnapshot
          ? `<h3>Captura del plano (${globalCurrentClock} · ${formatRelativeTime(
              relCurrent
            )})</h3>${svgSnapshot}`
          : '') +
        `<h3>Cronología</h3><table><thead><tr><th>Relativo</th><th>Hora evento</th><th>Hito</th><th>Detalle</th></tr></thead><tbody>${rowsHtml}</tbody></table>` +
        `<h3>Evaluación de gestión</h3><p>Detección: ${fmtSeconds(
          metrics.detectionSeconds
        )} · Asignación: ${fmtSeconds(
          metrics.assignmentSeconds
        )} · Llegada: ${fmtSeconds(
          metrics.arrivalSeconds
        )} · Resolución: ${fmtSeconds(
          metrics.totalResolutionSeconds
        )} · Distancia: ${metrics.distanceMeters} m · Coste estimado (orientativo no calibrado): ~${
          metrics.estimatedCostEur
        } €</p>` +
        (comparison
          ? `<h3>Comparación alternativa (${comparison.changeLabel})</h3><p>Delta respuesta: ${comparison.deltaResponseSec ?? '—'} s · Delta resolución: ${comparison.deltaResolutionSec ?? '—'} s · Delta distancia: ${comparison.deltaDistanceM} m. ${comparison.caveat}</p>`
          : '') +
        '<script>window.onload=()=>window.print();</script></body></html>'
    );
    w.document.close();
  };

  return (
    <section
      id="incident-analysis-panel"
      className="incident-analysis-panel"
      style={{'--inc-color': catMeta.color} as React.CSSProperties}
      aria-label={`Análisis de incidencia ${code}`}
    >
      <header className="inc-panel-head">
        <div>
          <div className="inc-badges-row">
            <span
              className="inc-cat-badge"
              style={{
                color: catMeta.color,
                background: catMeta.softBg,
                borderColor: catMeta.color,
              }}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.1"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                dangerouslySetInnerHTML={{__html: catMeta.svgIcon}}
              />
              <span>{code}</span>
            </span>
            <span
              className="inc-severity-badge"
              style={{
                background: sevMeta.badgeBg,
                color: sevMeta.badgeFg,
                borderColor: sevMeta.border,
              }}
            >
              {sevMeta.label}
            </span>
            <span className="inc-readonly-chip">{originBadge}</span>
            <span className="inc-readonly-chip">Solo lectura · histórico</span>
          </div>
          <h3>
            Análisis de incidencia ·{' '}
            {isRedactedViolet ? catMeta.label : incident.name || catMeta.label}
          </h3>
        </div>
        <div className="inc-head-actions">
          <button
            type="button"
            className="quiet"
            onClick={onFocusMap}
            title="Centrar cámara en la incidencia"
          >
            Centrar
          </button>
          <button
            type="button"
            id="inc-exit-analysis"
            className="dark"
            onClick={onExit}
          >
            Regresar a la simulación general
          </button>
        </div>
      </header>

      <div className="inc-panel-body">
        {/* A. Identificación */}
        <div className="inc-section">
          <div className="inc-section-title">A. IDENTIFICACIÓN Y CONTEXTO</div>
          <div className="inc-id-grid">
            <div>
              <span>Categoría</span>
              <b>{catMeta.label}</b>
            </div>
            <div>
              <span>Estado actual</span>
              <b>{statusText}</b>
            </div>
            <div>
              <span>Hora inicio / detección</span>
              <b>
                {globalStartClock} · det. {globalDetectClock}
              </b>
            </div>
            <div>
              <span>Ubicación</span>
              <b>
                {locationLabel}
                {nearAccess ? ` · cerca de ${nearAccess.name}` : ''}
              </b>
            </div>
            <div>
              <span>Recursos asignados</span>
              <b>{metrics.resourcesUsed.join(', ') || 'Pendiente de asignación'}</b>
            </div>
            <div>
              <span>Personas implicadas</span>
              <b>
                {isRedactedViolet
                  ? 'Datos individuales reservados (servicio Punto Violeta)'
                  : incident.agentId
                    ? `Visitante anónimo #${incident.agentId} + equipo`
                    : 'Entorno de puesto / área afectada'}
              </b>
            </div>
            {(incident.spreadCause || fireNode || incident.resourceLimitation) && (
              <div>
                <span>Foco y propagación</span>
                <b>
                  {incident.spreadCause ? `${incident.spreadCause} · ` : ''}
                  {fireNode
                    ? `Combustión ${fireNode.combustionRadius.toFixed(1)} m · Seg. ${fireNode.safetyRadius.toFixed(1)} m · ${Math.round(fireNode.damage * 100)} % daño`
                    : incident.fireStage || 'Registrado'}
                  {incident.resourceLimitation ? ` · ${incident.resourceLimitation}` : ''}
                </b>
              </div>
            )}
          </div>
          {(incident.parentIncidentId != null || childSpreadRows.length > 0) && (
            <div className="inc-simultaneous-box">
              <small>Cadena causal del incendio:</small>
              <div className="inc-sim-chips">
                {incident.parentIncidentId != null && (
                  <button
                    type="button"
                    className="inc-sim-chip"
                    style={{borderColor: '#D94841'}}
                    onClick={() => onSelectSimultaneous(incident.parentIncidentId!)}
                  >
                    Foco origen: {incident.parentCode || `#${incident.parentIncidentId}`}
                  </button>
                )}
                {childSpreadRows.map((ch) => (
                  <button
                    key={ch.id}
                    type="button"
                    className="inc-sim-chip"
                    style={{borderColor: '#D94841'}}
                    onClick={() => onSelectSimultaneous(ch.id)}
                  >
                    Propagado a: {ch.code || `#${ch.id}`}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="inc-view-toggles">
            <div className="inc-seg-group" role="group" aria-label="Modo de visualización">
              <button
                type="button"
                className={viewMode === 'focus' ? 'is-active' : ''}
                onClick={() => onChangeViewMode('focus')}
              >
                Foco en incidencia
              </button>
              <button
                type="button"
                className={viewMode === 'context' ? 'is-active' : ''}
                onClick={() => onChangeViewMode('context')}
              >
                Contexto completo
              </button>
            </div>

            {cat === 'violet_point' && (
              <div className="inc-seg-group" role="group" aria-label="Privacidad Punto Violeta">
                <button
                  type="button"
                  className={privacyMode === 'public' ? 'is-active' : ''}
                  onClick={() => onChangePrivacyMode('public')}
                >
                  Modo público (reservado)
                </button>
                <button
                  type="button"
                  className={
                    privacyMode === 'authorized_synthetic' ? 'is-active' : ''
                  }
                  onClick={() => onChangePrivacyMode('authorized_synthetic')}
                >
                  Prueba sintética autorizada
                </button>
              </div>
            )}
          </div>

          {simultaneousRows.length > 0 && (
            <div className="inc-simultaneous-box">
              <small>
                Incidencias simultáneas en el entorno ({simultaneousRows.length}):
              </small>
              <div className="inc-sim-chips">
                {simultaneousRows.map((sr) => {
                  const sCat = sr.category || categoryForIncidentType(sr.type);
                  const sCode =
                    sr.code || formatIncidentCode(sCat, Number(sr.id) || 1);
                  return (
                    <button
                      key={sr.id}
                      type="button"
                      className="inc-sim-chip"
                      style={{borderColor: INCIDENT_CATEGORIES[sCat].color}}
                      onClick={() => onSelectSimultaneous(sr.id)}
                    >
                      {sCode} · {INCIDENT_CATEGORIES[sCat].label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* C. Reproductor */}
        <div className="inc-section inc-player-box">
          <div className="inc-section-title">C. REPRODUCTOR TEMPORAL</div>
          <div className="inc-clocks-banner">
            <div>
              <small>HORA GLOBAL DEL EVENTO</small>
              <b id="inc-global-clock">{globalCurrentClock}</b>
            </div>
            <div>
              <small>TIEMPO DE INCIDENCIA</small>
              <b id="inc-rel-clock">{formatRelativeTime(relCurrent)}</b>
            </div>
            <div>
              <small>INSTANTE DE PAUSA</small>
              <b>
                {formatEventTimeOfDay(savedMainTime, win.from, win.to)} (
                {formatRelativeTime(Math.max(0, savedMainTime - originTime))})
              </b>
            </div>
          </div>

          <div className="inc-slider-wrap">
            <input
              type="range"
              id="inc-timeline-slider"
              min={originTime}
              max={maxPlaybackTime}
              step={0.5}
              value={Math.min(maxPlaybackTime, Math.max(originTime, currentTime))}
              onChange={(e) => onSeekTime(Number(e.target.value))}
              aria-label="Posición temporal de la incidencia"
            />
            <div className="inc-milestone-dots" aria-hidden="true">
              {timeline.map((ev) => {
                const pct = Math.max(
                  0,
                  Math.min(100, ((ev.time - originTime) / relMax) * 100)
                );
                return (
                  <span
                    key={ev.id}
                    className="inc-milestone-dot"
                    style={{left: `${pct}%`, background: catMeta.color}}
                    title={`${formatRelativeTime(ev.relTime)} · ${ev.label}`}
                  />
                );
              })}
            </div>
          </div>

          <div className="inc-player-controls">
            <button
              type="button"
              id="inc-btn-origin"
              onClick={() => onSeekTime(originTime)}
              title="Volver al origen T+00:00"
            >
              T+00:00
            </button>
            <button
              type="button"
              onClick={() => onSeekTime(Math.max(originTime, currentTime - 15))}
            >
              -15 s
            </button>
            <button
              type="button"
              id="inc-btn-play"
              className="dark"
              onClick={onTogglePlay}
            >
              {playing ? 'Pausar' : 'Reproducir'}
            </button>
            <button
              type="button"
              onClick={() =>
                onSeekTime(Math.min(maxPlaybackTime, currentTime + 5))
              }
            >
              +5 s
            </button>
            <button
              type="button"
              disabled={!nextMilestone}
              onClick={() =>
                nextMilestone && onSeekTime(nextMilestone.time)
              }
            >
              Siguiente hito
            </button>
            <button
              type="button"
              onClick={() => onSeekTime(savedMainTime)}
              title="Volver al instante en que se pausó la simulación"
            >
              Instante apertura
            </button>
            <select
              aria-label="Velocidad de reproducción de incidencia"
              value={playbackSpeed}
              onChange={(e) =>
                onChangeSpeed(Number(e.target.value) as 1 | 2 | 5 | 10 | 50)
              }
            >
              {[1, 2, 5, 10, 50].map((v) => (
                <option key={v} value={v}>
                  {v}×
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* B. Línea temporal de la incidencia */}
        <div className="inc-section">
          <div className="inc-section-title">
            B. LÍNEA TEMPORAL DE LA INCIDENCIA ({timeline.length} hitos)
          </div>
          {!incident.hasPreDetectionData && (
            <p className="inc-warning-note">
              Aviso: no existe registro previo a la detección; se muestra desde el primer dato disponible sin reconstrucción inventada.
            </p>
          )}
          <ol className="inc-timeline-list">
            {timeline.map((ev) => {
              const isPast = ev.time <= currentTime + 0.5;
              const isCurrent = Math.abs(ev.time - currentTime) <= 2;
              return (
                <li
                  key={ev.id}
                  className={`${isPast ? 'is-reached' : ''} ${
                    isCurrent ? 'is-current' : ''
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSeekTime(ev.time)}
                    title="Saltar a este instante en el mapa"
                  >
                    <span className="inc-tl-time">
                      {formatRelativeTime(ev.relTime)}
                    </span>
                    <div>
                      <b>{ev.label}</b>
                      <small>
                        {isRedactedViolet
                          ? 'Registro reservado de servicio.'
                          : ev.detail}
                      </small>
                    </div>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>

        {/* D. Evaluación de la gestión */}
        <div className="inc-section">
          <div className="inc-section-title">D. EVALUACIÓN DE LA GESTIÓN</div>
          <div className="inc-metrics-grid">
            <div>
              <span>Detección</span>
              <b>{fmtSeconds(metrics.detectionSeconds)}</b>
            </div>
            <div>
              <span>Asignación</span>
              <b>{fmtSeconds(metrics.assignmentSeconds)}</b>
            </div>
            <div>
              <span>Llegada</span>
              <b>{fmtSeconds(metrics.arrivalSeconds)}</b>
            </div>
            <div>
              <span>Intervención</span>
              <b>{fmtSeconds(metrics.interventionSeconds)}</b>
            </div>
            <div>
              <span>Resolución total</span>
              <b>{fmtSeconds(metrics.totalResolutionSeconds)}</b>
            </div>
            <div>
              <span>Distancia recursos</span>
              <b>{metrics.distanceMeters} m</b>
            </div>
            <div>
              <span>Espera recurso ocupado</span>
              <b>{fmtSeconds(metrics.waitForBusySeconds)}</b>
            </div>
            <div>
              <span>Entorno afectado (est.)</span>
              <b>{metrics.affectedVisitorsEstimate} pers.</b>
            </div>
            <div>
              <span>Coste (estimación no calibrada)</span>
              <b>~{metrics.estimatedCostEur} €</b>
            </div>
          </div>
          {metrics.firePhaseSummary && (
            <p className="small-note">
              <b>Estado operativo del incendio:</b> {metrics.firePhaseSummary}
            </p>
          )}
          {metrics.obstacles.length > 0 && (
            <p className="small-note">
              <b>Obstáculos/desvíos:</b> {metrics.obstacles.join(' · ')}
            </p>
          )}

          <div className="inc-actions-footer">
            <button
              type="button"
              id="inc-better-btn"
              className="dark"
              onClick={() => setShowCompareBox((v) => !v)}
            >
              ¿Cómo podría haberse gestionado mejor?
            </button>
            <div className="inc-export-row">
              <button type="button" onClick={handleExportJson}>
                JSON
              </button>
              <button type="button" onClick={handleExportCsv}>
                CSV
              </button>
              <button type="button" onClick={handleExportPdf}>
                PDF / Imprimir
              </button>
            </div>
          </div>

          {showCompareBox && (
            <div className="inc-compare-box" id="inc-compare-box">
              <b>Simular escenario alternativo (sin alterar el ensayo original)</b>
              <div className="inc-alt-buttons">
                {(
                  [
                    ['add_extra_unit', 'Añadir auxiliar / dotación'],
                    ['move_closer', 'Acercar recurso / carpa'],
                    ['boost_capacity', 'Aumentar capacidad operativa'],
                    ['clear_corridor', 'Despejar corredores'],
                  ] as Array<[AlternativeChangeKind, string]>
                ).map(([kind, lbl]) => (
                  <button
                    key={kind}
                    type="button"
                    className={
                      selectedAlt === kind && comparison ? 'is-active' : ''
                    }
                    onClick={() => handleRunAlternative(kind)}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
              {comparison && (
                <div className="inc-compare-results">
                  <small>{comparison.changeLabel}</small>
                  <table className="inc-compare-table">
                    <thead>
                      <tr>
                        <th>Indicador</th>
                        <th>Original</th>
                        <th>Alternativo</th>
                        <th>Diferencia</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Llegada</td>
                        <td>{fmtSeconds(comparison.original.arrivalSeconds)}</td>
                        <td>{fmtSeconds(comparison.alternative.arrivalSeconds)}</td>
                        <td>
                          {comparison.deltaResponseSec != null
                            ? `${comparison.deltaResponseSec > 0 ? '-' : '+'}${Math.abs(
                                comparison.deltaResponseSec
                              )} s`
                            : '—'}
                        </td>
                      </tr>
                      <tr>
                        <td>Resolución</td>
                        <td>
                          {fmtSeconds(comparison.original.totalResolutionSeconds)}
                        </td>
                        <td>
                          {fmtSeconds(comparison.alternative.totalResolutionSeconds)}
                        </td>
                        <td>
                          {comparison.deltaResolutionSec != null
                            ? `${comparison.deltaResolutionSec > 0 ? '-' : '+'}${Math.abs(
                                comparison.deltaResolutionSec
                              )} s`
                            : '—'}
                        </td>
                      </tr>
                      <tr>
                        <td>Distancia</td>
                        <td>{comparison.original.distanceMeters} m</td>
                        <td>{comparison.alternative.distanceMeters} m</td>
                        <td>
                          {comparison.deltaDistanceM > 0 ? '+' : ''}
                          {comparison.deltaDistanceM} m
                        </td>
                      </tr>
                      <tr>
                        <td>Coste (est.)</td>
                        <td>~{comparison.original.estimatedCostEur} €</td>
                        <td>~{comparison.alternative.estimatedCostEur} €</td>
                        <td>
                          {comparison.deltaCostEur > 0 ? '+' : ''}
                          {comparison.deltaCostEur} €
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <small className="inc-caveat">{comparison.caveat}</small>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
