import React, {useMemo, useState} from 'react';
import type {EventEngine} from '../../engine/crowd/event-engine';
import {
  analyzeSpatialCorrections,
  applySpatialCorrection,
  type SpatialCorrectionProposal,
} from '../../engine/planning/spatial-assistant';
import {useProjectStore} from '../../store/useProjectStore';

export interface SpatialAssistantPanelProps {
  engine: EventEngine | null;
  onSceneChanged: () => void;
}

const KIND_LABELS: Record<SpatialCorrectionProposal['incidentKind'], string> = {
  access_blocked: 'Acceso obstruido',
  element_conflict: 'Colisión',
  bottleneck: 'Cuello de botella',
  queue_congestion: 'Espera / cola',
  emergency_access: 'Emergencias',
  subsoil_load: 'Subsuelo',
};

/**
 * Panel del Asistente de corrección espacial inteligente en Evaluación → Incidencias.
 * Detecta incidencias espaciales, ofrece instrucciones ejecutables en metros/grados,
 * permite previsualizar la propuesta sobre el plano sin modificarlo y aplicarla con 1 clic.
 */
export const SpatialAssistantPanel: React.FC<SpatialAssistantPanelProps> = ({
  engine,
  onSceneChanged,
}) => {
  const currentScene = useProjectStore((s) => s.currentScene);
  const currentMap = useProjectStore((s) => s.currentMap);
  const revision = useProjectStore((s) => s.revision);
  const previewCorrection = useProjectStore((s) => s.previewCorrection);
  const setPreviewCorrection = useProjectStore((s) => s.setPreviewCorrection);
  const setPanel = useProjectStore((s) => s.setPanel);
  const setSelectedIds = useProjectStore((s) => s.setSelectedIds);
  const updateScene = useProjectStore((s) => s.updateScene);
  const showToast = useProjectStore((s) => s.showToast);

  const [dismissedIds, setDismissedIds] = useState<string[]>([]);

  const scene = currentScene();
  const map = currentMap();

  const proposals = useMemo(() => {
    void revision;
    return analyzeSpatialCorrections(scene, map, engine).filter(
      (p) => !dismissedIds.includes(p.id)
    );
  }, [scene, map, engine, revision, dismissedIds]);

  const handleApply = (proposal: SpatialCorrectionProposal) => {
    let applied = false;
    let warnings: string[] = [];
    updateScene((sc) => {
      const res = applySpatialCorrection(sc, proposal, map);
      applied = res.applied;
      warnings = res.warnings;
    }, true);
    setPreviewCorrection(null);
    if (applied) {
      onSceneChanged();
      showToast(
        warnings.length
          ? `Corrección aplicada con avisos: ${warnings[0]} (Ctrl+Z para deshacer)`
          : 'Corrección aplicada. Vuelve a simular para validar la mejora (Ctrl+Z para deshacer).'
      );
    } else {
      showToast(warnings[0] || 'No se pudo aplicar la corrección');
    }
  };

  return (
    <section
      className="panel-section"
      id="spatial-assistant-panel"
      aria-label="Asistente de corrección espacial"
    >
      <div className="section-label">
        PROPUESTAS DE CORRECCIÓN ESPACIAL
        <small>{proposals.length}</small>
      </div>
      {!proposals.length ? (
        <p className="small-note">
          No se detectan obstrucciones, colisiones ni incidencias espaciales
          pendientes. Ejecuta una simulación para detectar cuellos de botella en
          vivo.
        </p>
      ) : (
        <div className="review-list">
          {proposals.map((p) => {
            const isPreviewing = previewCorrection?.id === p.id;
            return (
              <article
                key={p.id}
                className="note-card"
                data-correction-id={p.id}
                style={{
                  borderLeft: isPreviewing
                    ? '3px solid #10b981'
                    : p.viable
                      ? '3px solid #57367b'
                      : '3px solid #b43c4c',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '6px',
                    alignItems: 'center',
                  }}
                >
                  <b>{p.title}</b>
                  <span className="cell-tag">{KIND_LABELS[p.incidentKind]}</span>
                </div>
                <p style={{marginTop: '4px'}}>{p.diagnosis}</p>
                <small style={{display: 'block', opacity: 0.85}}>
                  Criterio: {p.criterion}
                </small>
                <p
                  style={{
                    marginTop: '6px',
                    fontWeight: 700,
                    color: p.viable ? 'var(--purple)' : '#b43c4c',
                  }}
                >
                  {p.instruction}
                </p>
                {p.unviableReason ? (
                  <small style={{display: 'block', color: '#b43c4c'}}>
                    {p.unviableReason}
                  </small>
                ) : (
                  <small style={{display: 'block'}}>
                    Efecto esperado: {p.expectedEffect} (requiere nueva
                    simulación para validar).
                  </small>
                )}
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '6px',
                    marginTop: '8px',
                  }}
                >
                  {p.viable && (
                    <>
                      <button
                        type="button"
                        className={isPreviewing ? 'dark' : 'quiet'}
                        data-preview-correction={p.id}
                        onClick={() =>
                          setPreviewCorrection(isPreviewing ? null : p)
                        }
                      >
                        {isPreviewing
                          ? 'Ocultar vista previa'
                          : 'Previsualizar'}
                      </button>
                      <button
                        type="button"
                        className="dark"
                        data-apply-correction={p.id}
                        onClick={() => handleApply(p)}
                      >
                        Aplicar
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="quiet"
                    onClick={() => {
                      setPreviewCorrection(null);
                      setPanel('design');
                      if (p.affectedIds.length) setSelectedIds(p.affectedIds);
                    }}
                  >
                    Editar manual
                  </button>
                  <button
                    type="button"
                    className="quiet"
                    onClick={() => {
                      if (isPreviewing) setPreviewCorrection(null);
                      setDismissedIds((prev) => [...prev, p.id]);
                    }}
                  >
                    Descartar
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
};
