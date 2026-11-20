import React from 'react';
import type {EventEngine} from '../../engine/crowd/event-engine';
import {
  buildPostSimDiagnostics,
  type GuidedAction,
} from '../../engine/experience/post-sim-diagnostics';
import {useProjectStore} from '../../store/useProjectStore';

export interface PostSimDiagnosticsViewProps {
  engine: EventEngine;
  compact?: boolean;
  onSceneChanged: () => void;
  onCloseModal?: () => void;
}

/**
 * Panel gráfico interactivo de satisfacción e incidencias post-simulación:
 * muestra gráfico circular (donut SVG) de tasa de satisfacción, gráfico de
 * barras horizontales de causas y tarjetas guiadas con acciones de corrección.
 */
export const PostSimDiagnosticsView: React.FC<PostSimDiagnosticsViewProps> = ({
  engine,
  compact = false,
  onSceneChanged,
  onCloseModal,
}) => {
  const currentScene = useProjectStore((s) => s.currentScene);
  const setPanel = useProjectStore((s) => s.setPanel);
  const setTool = useProjectStore((s) => s.setTool);
  const setSelectedId = useProjectStore((s) => s.setSelectedId);
  const setActiveModal = useProjectStore((s) => s.setActiveModal);
  const updateScene = useProjectStore((s) => s.updateScene);
  const showToast = useProjectStore((s) => s.showToast);

  const scene = currentScene();
  const report = buildPostSimDiagnostics(engine, scene);
  const sat = report.satisfaction;

  // Parámetros del donut SVG (radio = 42, circunferencia ≈ 263.89)
  const r = 42;
  const circ = 2 * Math.PI * r;
  const satLen = (sat.satisfiedPct / 100) * circ;
  const neuLen = (sat.neutralPct / 100) * circ;
  const disLen = (sat.dissatisfiedPct / 100) * circ;

  const executeAction = (action: GuidedAction) => {
    switch (action.kind) {
      case 'select-target':
        onCloseModal?.();
        setPanel('design');
        if (action.targetId) setSelectedId(action.targetId);
        showToast('Elemento seleccionado en el plano para editarlo');
        return;
      case 'switch-design-tool':
        onCloseModal?.();
        setPanel('design');
        if (action.tool) setTool(action.tool);
        showToast('Pulsa sobre el plano para colocar el elemento');
        return;
      case 'open-inventory':
        setPanel('design');
        setActiveModal('inventory');
        return;
      case 'open-demand':
        setActiveModal('demand');
        return;
      case 'open-parameters':
        setActiveModal('parameters');
        return;
      case 'open-org':
        setActiveModal('org');
        return;
      case 'open-comparison':
        setActiveModal('comparison');
        return;
      case 'apply-quick-fix': {
        if (action.fixType === 'lower-price' && action.targetId) {
          updateScene((sc) => {
            const b = sc.base.booths.find((o) => o.id === action.targetId);
            if (b) {
              b.price = Math.max(
                0,
                Math.round(Number(b.price || 8) * 0.85 * 2) / 2
              );
            }
          }, true);
          onSceneChanged();
          showToast('Precio reducido un 15 %. Vuelve a ensayar para comprobar.');
        } else if (action.fixType === 'add-slot' && action.targetId) {
          updateScene((sc) => {
            const b = sc.base.booths.find((o) => o.id === action.targetId);
            if (b) {
              const cur = Number(b.labCapacity || b.simultaneous || 1);
              b.labCapacity = cur + 1;
              b.simultaneous = cur + 1;
            }
          }, true);
          onSceneChanged();
          showToast('Añadida +1 plaza simultánea. Vuelve a ensayar para comprobar.');
        } else if (action.fixType === 'lower-sound' && action.targetId) {
          updateScene((sc) => {
            const st = sc.base.booths.find((o) => o.id === action.targetId);
            if (st) {
              const prev = Number(st.sound?.spl || 90);
              st.sound = {
                ...st.sound,
                spl: Math.max(0, prev - 3),
                reference: st.sound?.reference || 5,
                enabled: Math.max(0, prev - 3) > 0,
              };
            }
          }, true);
          onSceneChanged();
          showToast('Nivel sonoro del escenario reducido 3 dB.');
        } else if (action.fixType === 'add-dry-staff') {
          updateScene((sc) => {
            sc.dryStaff = Math.min(10, Number(sc.dryStaff || 1) + 1);
          }, true);
          onSceneChanged();
          showToast('Personal de secado incrementado (+1 operario).');
        }
        return;
      }
    }
  };

  const visibleIncidents = compact
    ? report.incidents.slice(0, 4)
    : report.incidents;

  return (
    <section
      className={`post-sim-diagnostics ${compact ? 'is-compact' : ''}`}
      aria-label="Diagnóstico gráfico de satisfacción e incidencias"
    >
      <div className="diag-header-grid">
        <div className="diag-donut-card">
          <svg
            className="diag-donut"
            viewBox="0 0 110 110"
            role="img"
            aria-label={`Tasa de satisfacción media: ${sat.averageScore} sobre 100`}
          >
            <circle
              cx="55"
              cy="55"
              r={r}
              fill="none"
              stroke="#ebe4f2"
              strokeWidth="12"
            />
            {satLen > 0 && (
              <circle
                cx="55"
                cy="55"
                r={r}
                fill="none"
                stroke="#6aa84f"
                strokeWidth="12"
                strokeDasharray={`${satLen} ${circ}`}
                strokeDashoffset="0"
                transform="rotate(-90 55 55)"
              />
            )}
            {neuLen > 0 && (
              <circle
                cx="55"
                cy="55"
                r={r}
                fill="none"
                stroke="#e0b53e"
                strokeWidth="12"
                strokeDasharray={`${neuLen} ${circ}`}
                strokeDashoffset={-satLen}
                transform="rotate(-90 55 55)"
              />
            )}
            {disLen > 0 && (
              <circle
                cx="55"
                cy="55"
                r={r}
                fill="none"
                stroke="#d9534f"
                strokeWidth="12"
                strokeDasharray={`${disLen} ${circ}`}
                strokeDashoffset={-(satLen + neuLen)}
                transform="rotate(-90 55 55)"
              />
            )}
            <text
              x="55"
              y="52"
              textAnchor="middle"
              className="diag-donut-score"
            >
              {sat.averageScore}%
            </text>
            <text
              x="55"
              y="67"
              textAnchor="middle"
              className="diag-donut-label"
            >
              Satisfacción
            </text>
          </svg>
          <div className="diag-donut-legend">
            <span className="legend-sat">
              ● Satisfecho: <b>{sat.satisfiedPct} %</b> ({sat.satisfied})
            </span>
            <span className="legend-neu">
              ● Neutral: <b>{sat.neutralPct} %</b> ({sat.neutral})
            </span>
            <span className="legend-dis">
              ● Descontento: <b>{sat.dissatisfiedPct} %</b> ({sat.dissatisfied})
            </span>
          </div>
        </div>

        <div className="diag-causes-card">
          <h4>¿Por qué se pierde satisfacción?</h4>
          <p className="diag-headline">{report.headline}</p>
          {report.incidents.length > 0 ? (
            <div className="diag-bars" role="list">
              {report.incidents.map((inc) => (
                <div key={inc.key} className="diag-bar-row" role="listitem">
                  <div className="diag-bar-meta">
                    <span>
                      {inc.icon} {inc.label}
                    </span>
                    <b>
                      {inc.sharePct} % ({inc.count})
                    </b>
                  </div>
                  <div className="diag-bar-track">
                    <div
                      className="diag-bar-fill"
                      style={{
                        width: `${Math.max(4, inc.sharePct)}%`,
                        background: inc.color,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="diag-clean-note">
              No se han registrado incidencias de experiencia ni bloqueos en
              este ensayo.
            </p>
          )}
        </div>
      </div>

      {visibleIncidents.length > 0 && (
        <div className="diag-guides">
          <h4>Guía para solucionar las incidencias detectadas</h4>
          <div className="diag-guide-list">
            {visibleIncidents.map((inc) => (
              <article
                key={inc.key}
                className={`diag-guide-card severity-${inc.severity}`}
                data-incident-category={inc.key}
              >
                <header className="diag-guide-head">
                  <span className="diag-guide-title">
                    <i style={{background: inc.color}} />
                    {inc.icon} {inc.label}
                  </span>
                  <span className={`diag-badge badge-${inc.severity}`}>
                    {inc.severity === 'high'
                      ? 'Impacto alto'
                      : inc.severity === 'medium'
                        ? 'Impacto medio'
                        : 'Impacto leve'}{' '}
                    · {inc.sharePct} %
                  </span>
                </header>
                <p className="diag-why">{inc.whyItHurts}</p>
                <p className="diag-evidence">
                  <b>Detectado:</b> {inc.evidence}
                </p>
                {!compact && (
                  <ul className="diag-steps">
                    {inc.steps.map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ul>
                )}
                <div className="diag-actions">
                  {inc.actions.map((act, i) => (
                    <button
                      key={i}
                      type="button"
                      className={act.primary ? 'dark' : 'quiet'}
                      onClick={() => executeAction(act)}
                    >
                      {act.label}
                    </button>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};
