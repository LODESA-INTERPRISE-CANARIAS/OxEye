import React, {useEffect, useRef, useState} from 'react';
import {
  ensureProjectObjectives,
  summarizeLegacySmartGoal,
} from '../../engine/planning/objectives';
import {redesign} from '../../engine/planning/layout';
import {useProjectStore} from '../../store/useProjectStore';
import type {ProjectObjectives} from '../../types';
import {ObjectivesConfigurator} from '../planning/ObjectivesConfigurator';

export interface ObjectivesDialogProps {
  onSceneChanged: () => void;
}

/**
 * Modal dialog (`#objectives-dialog`) for inspecting or updating `scene.objectives`
 * after project creation, with explicit handling of post-design modifications.
 */
export const ObjectivesDialog: React.FC<ObjectivesDialogProps> = ({
  onSceneChanged,
}) => {
  const dlgRef = useRef<HTMLDialogElement | null>(null);
  const activeModal = useProjectStore((s) => s.activeModal);
  const currentScene = useProjectStore((s) => s.currentScene);
  const currentMap = useProjectStore((s) => s.currentMap);
  const setActiveModal = useProjectStore((s) => s.setActiveModal);
  const updateScene = useProjectStore((s) => s.updateScene);
  const showToast = useProjectStore((s) => s.showToast);

  const isOpen = activeModal === 'objectives';
  const [draft, setDraft] = useState<ProjectObjectives>(() =>
    ensureProjectObjectives(currentScene())
  );
  const [pendingConfirm, setPendingConfirm] = useState(false);

  useEffect(() => {
    const dlg = dlgRef.current;
    if (!dlg) return;
    if (isOpen && !dlg.open) {
      setDraft(structuredClone(ensureProjectObjectives(currentScene())));
      setPendingConfirm(false);
      dlg.showModal();
    } else if (!isOpen && dlg.open) {
      dlg.close();
    }
  }, [isOpen, currentScene]);

  const commitObjectives = (
    mode: 'indicators_only' | 'recalculate' | 'redesign_preview' | 'compare'
  ) => {
    updateScene((sc) => {
      sc.objectives = structuredClone(draft);
      sc.eventGoals = [...draft.profile.activeAxes];
      sc.smartGoal = sc.smartGoal || summarizeLegacySmartGoal(draft);
      if (draft.confirmedHypotheses.confirmed) {
        sc.mix = {...draft.confirmedHypotheses.mix};
      }
      if (sc.simulationHistory?.length) {
        sc.simulationHistory = sc.simulationHistory.map((h) =>
          h.objectivesVersion < draft.version ? {...h, stale: true} : h
        );
      }
    }, true);

    onSceneChanged();

    if (mode === 'recalculate') {
      setActiveModal('demand');
      showToast('Prioridades aplicadas. Recalculando servicios con la nueva configuración.');
      return;
    }
    if (mode === 'compare') {
      setActiveModal('laboratory');
      showToast('Prioridades aplicadas al comparador de diseños.');
      return;
    }
    if (mode === 'redesign_preview') {
      const sc = currentScene();
      const m = currentMap();
      const focus =
        draft.profile.layoutFocus === 'gastronomy'
          ? 'gastronomy'
          : draft.profile.layoutFocus === 'commerce'
            ? 'commerce'
            : draft.profile.layoutFocus === 'family'
              ? 'family'
              : draft.profile.layoutFocus === 'music'
                ? 'music'
                : 'visitor_experience';
      const prop = redesign(sc, m, {
        space: 2.5,
        seed: (sc.seed || 2026) + draft.version * 17,
        onlyMove: true,
        strategy: 1,
        objectiveFocus: focus,
      });
      if (prop.moves.length) {
        setActiveModal('comparison');
        showToast('Propuesta de redistribución generada para revisión previa.');
      } else {
        setActiveModal(null);
        showToast('Objetivos actualizados; no fue necesario mover elementos existentes.');
      }
      return;
    }

    setActiveModal(null);
    showToast('Indicadores y prioridades SMART actualizados (simulaciones previas marcadas como anteriores).');
  };

  const handleSave = () => {
    if (!draft.selected.length) {
      showToast('Selecciona al menos un objetivo SMART.', 'error');
      return;
    }
    const sc = currentScene();
    const hasPlacedElements =
      sc.base.booths.length + sc.infrastructure.length > 0;
    if (hasPlacedElements && !pendingConfirm) {
      setPendingConfirm(true);
      return;
    }
    commitObjectives('indicators_only');
  };

  return (
    <dialog
      id="objectives-dialog"
      className="wide-modal"
      ref={dlgRef}
      onClose={() => {
        if (isOpen) setActiveModal(null);
      }}
    >
      <div className="modal-head">
        <div>
          <h2>¿Qué quieres conseguir con este evento?</h2>
          <p className="small-note">
            Selecciona tus prioridades. OxEye las utilizará para calcular
            recursos, organizar actividades, diseñar el recinto y comparar alternativas.
          </p>
        </div>
        <button
          type="button"
          className="quiet"
          onClick={() => setActiveModal(null)}
        >
          ✕
        </button>
      </div>

      {!pendingConfirm ? (
        <>
          <ObjectivesConfigurator value={draft} onChange={setDraft} compact />
          <div className="modal-actions" style={{marginTop: '14px'}}>
            <button type="button" onClick={() => setActiveModal(null)}>
              Cancelar
            </button>
            <button
              type="button"
              id="objectives-save-btn"
              className="dark"
              onClick={handleSave}
            >
              Continuar y aplicar objetivos
            </button>
          </div>
        </>
      ) : (
        <div className="smart-post-change-panel" id="smart-post-change-panel">
          <h3>Has cambiado las prioridades del evento. ¿Cómo quieres aplicar las modificaciones?</h3>
          <p className="small-note">
            Los elementos ya colocados en el plano se conservan intactos hasta que
            confirmes una acción. Las simulaciones anteriores quedarán marcadas como
            anteriores a este cambio.
          </p>
          <div className="smart-post-change-options">
            <button
              type="button"
              id="obj-apply-indicators"
              onClick={() => commitObjectives('indicators_only')}
            >
              1. Actualizar únicamente los indicadores de evaluación
            </button>
            <button
              type="button"
              id="obj-apply-recalc"
              onClick={() => commitObjectives('recalculate')}
            >
              2. Recalcular necesidades y servicios
            </button>
            <button
              type="button"
              id="obj-apply-redesign"
              onClick={() => commitObjectives('redesign_preview')}
            >
              3. Proponer una nueva distribución (con vista previa)
            </button>
            <button
              type="button"
              id="obj-apply-compare"
              className="dark"
              onClick={() => commitObjectives('compare')}
            >
              4. Comparar el diseño actual con nuevas alternativas
            </button>
            <button
              type="button"
              id="obj-apply-cancel"
              className="quiet"
              onClick={() => setPendingConfirm(false)}
            >
              5. Volver / Cancelar cambio
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
};
