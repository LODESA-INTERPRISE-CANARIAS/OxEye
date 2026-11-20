import React, {useEffect, useRef} from 'react';
import {CARTO_DATA, MAPS_DATA} from '../../data/geodata';
import {initialScene} from '../../engine/crowd/presets';
import {smallExample} from '../../engine/crowd/small-example';
import {addResponseExample} from '../../engine/emergency/response-example';
import {useProjectStore} from '../../store/useProjectStore';

export interface SmallExampleDialogProps {
  onApplied: () => void;
}

/**
 * Confirmation dialog (`Cargar ejemplo operativo`) to replace the Cristo montage with the compact operational baseline.
 */
export const SmallExampleDialog: React.FC<SmallExampleDialogProps> = ({
  onApplied,
}) => {
  const dlgRef = useRef<HTMLDialogElement | null>(null);
  const activeModal = useProjectStore((s) => s.activeModal);
  const activeVenue = useProjectStore((s) => s.activeVenue);
  const currentScene = useProjectStore((s) => s.currentScene);
  const setActiveModal = useProjectStore((s) => s.setActiveModal);
  const setVenue = useProjectStore((s) => s.setVenue);
  const setPhase = useProjectStore((s) => s.setPhase);
  const setPanel = useProjectStore((s) => s.setPanel);
  const replaceProject = useProjectStore((s) => s.replaceProject);
  const project = useProjectStore((s) => s.project);

  const isOpen = activeModal === 'small-example';

  useEffect(() => {
    const dlg = dlgRef.current;
    if (!dlg) return;
    if (isOpen && !dlg.open) {
      dlg.showModal();
    } else if (!isOpen && dlg.open) {
      dlg.close();
    }
  }, [isOpen]);

  const handleApply = () => {
    const s = currentScene();
    const source = initialScene('cristo', MAPS_DATA.cristo, CARTO_DATA);
    const next = addResponseExample(smallExample(source));
    if (activeVenue === 'cristo') {
      next.infrastructure.push(
        ...s.infrastructure.filter(
          (o) =>
            o.role === 'emergency' &&
            !next.infrastructure.some((q) => q.id === o.id)
        )
      );
    }
    const nextProject = structuredClone(project);
    nextProject.scenes.cristo = next;
    nextProject.active = 'cristo';
    replaceProject(nextProject, true);
    setVenue('cristo');
    setPhase('event');
    setPanel('design');
    onApplied();
    setActiveModal('risk');
  };

  return (
    <dialog
      id="small-example-dialog"
      ref={dlgRef}
      onClose={() => {
        if (isOpen) setActiveModal(null);
      }}
    >
      <h2>Aplicar la propuesta inicial</h2>
      <p>
        Se sustituirá el montaje del Cristo por 1 puesto de comida, 1 mesa de
        seis plazas, 1 cubierta, 1 comercio y 1 cabina. Se conservan los equipos
        de emergencia del modelo actual y se vuelve a revisar su cobertura.
      </p>
      <button
        id="small-apply"
        type="button"
        className="dark"
        onClick={handleApply}
      >
        Aplicar y revisar riesgos
      </button>{' '}
      <button
        id="small-close"
        type="button"
        onClick={() => setActiveModal(null)}
      >
        Volver
      </button>
    </dialog>
  );
};
