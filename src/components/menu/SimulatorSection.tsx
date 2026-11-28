/**
 * Simulador (`/simulador`): everything the old main menu offered for the
 * simulation. The last model leads; creating, loading and saving follow.
 * «Guardar y salir» swaps the screen for an in-place «Sesión guardada» panel.
 */
import React, {useEffect, useRef, useState} from 'react';
import {downloadFile} from '../../db/repository';
import {useProjectStore} from '../../store/useProjectStore';
import type {HubRoute} from './hubRoute';
import {HubPage} from './HubLayout';
import {
  IconArrowLeft,
  IconCheck,
  IconDownload,
  IconPlay,
  IconPlus,
  IconSave,
  IconUpload,
} from './HubIcons';

export interface SimulatorSectionProps {
  canContinue: boolean;
  modelTitle: string;
  onContinue: () => void;
  onNewModel: () => void;
  onNavigate: (r: HubRoute) => void;
}

export const SimulatorSection: React.FC<SimulatorSectionProps> = ({
  canContinue,
  modelTitle,
  onContinue,
  onNewModel,
  onNavigate,
}) => {
  const [saved, setSaved] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const firstRun = useRef(true);

  // The panel swap is not a route change, so move focus to its title here.
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    titleRef.current?.focus({preventScroll: true});
  }, [saved]);

  const saveAndExit = () => {
    const store = useProjectStore.getState();
    store.save();
    // `save()` reports through `saveStatusText` and does not mark the project
    // as saved (autosave uses it too, so the flag is set only here, on an
    // explicit save): «Volver» then offers «Continuar» without a reload.
    if (
      useProjectStore.getState().saveStatusText === 'Guardado en este navegador'
    ) {
      useProjectStore.setState({hasSavedProject: true});
    }
    setSaved(true);
  };

  const exportProject = () => {
    const {save, project, showToast} = useProjectStore.getState();
    save();
    downloadFile('Ojo_de_Buey_Proyecto.json', JSON.stringify(project, null, 2));
    showToast('Proyecto exportado con los tres espacios y sus observaciones.');
  };

  if (saved) {
    return (
      <HubPage className="hub-page--narrow" onHome={() => onNavigate('home')}>
        <section
          className="hub-panel hub-done"
          aria-labelledby="hub-done-title"
        >
          <span className="hub-done__mark" aria-hidden="true">
            <IconCheck size={28} />
          </span>
          <h1
            className="hub-title hub-title--page"
            id="hub-done-title"
            tabIndex={-1}
            ref={titleRef}
          >
            Sesión guardada
          </h1>
          <p className="hub-lede hub-lede--sm">
            Puedes cerrar esta pestaña. Exporta una copia para trasladar el
            proyecto a otro equipo.
          </p>
          <div className="hub-actions">
            <button
              type="button"
              id="game-export"
              className="hub-btn hub-btn--primary"
              onClick={exportProject}
            >
              <IconDownload />
              Exportar proyecto
            </button>
            <button
              type="button"
              id="game-back"
              className="hub-btn hub-btn--secondary"
              onClick={() => setSaved(false)}
            >
              <IconArrowLeft />
              Volver
            </button>
          </div>
        </section>
      </HubPage>
    );
  }

  return (
    <HubPage className="hub-page--simulator" onHome={() => onNavigate('home')}>
      <header className="hub-head">
        <p className="hub-eyebrow">Módulo</p>
        <h1 className="hub-title hub-title--page" tabIndex={-1} ref={titleRef}>
          Simulador
        </h1>
        <p className="hub-lede hub-lede--sm">
          Ensaya multitudes, emergencias y logística sobre el terreno real antes
          del evento. Sus resultados son estimaciones para apoyar decisiones; no
          certifican nada.
        </p>
      </header>

      <section
        className={`hub-model ${canContinue ? 'is-ready' : 'is-empty'}`}
        aria-label="Último modelo"
      >
        <div className="hub-model__info">
          <p className="hub-model__label">Último modelo</p>
          {canContinue ? (
            <>
              <p className="hub-model__title">{modelTitle}</p>
              <p className="hub-model__meta">
                <span className="hub-dot" aria-hidden="true" />
                Guardado en este dispositivo
              </p>
            </>
          ) : (
            <>
              <p className="hub-model__title">Sin modelos todavía</p>
              <p className="hub-model__meta" id="game-continue-hint">
                Crea o carga primero un modelo
              </p>
            </>
          )}
        </div>
        <button
          type="button"
          id="game-continue"
          className={`hub-btn hub-btn--lg ${canContinue ? 'hub-btn--primary' : 'hub-btn--secondary'}`}
          disabled={!canContinue}
          aria-describedby={canContinue ? undefined : 'game-continue-hint'}
          title={
            canContinue
              ? 'Retomar la última sesión guardada'
              : 'Crea o carga primero un modelo para poder continuar'
          }
          onClick={onContinue}
        >
          <IconPlay />
          Continuar
          {canContinue && (
            <span className="hub-visually-hidden">: {modelTitle}</span>
          )}
        </button>
      </section>

      <div className="hub-tiles" role="group" aria-label="Otros modelos">
        <button
          type="button"
          id="game-new"
          className={`hub-tile ${canContinue ? '' : 'hub-tile--primary'}`}
          onClick={onNewModel}
        >
          <span className="hub-tile__icon" aria-hidden="true">
            <IconPlus />
          </span>
          <span className="hub-tile__title">Crear nuevo modelo</span>
          <span className="hub-tile__text">
            Cinco pasos: objetivos, lugar, fechas, carácter y revisión.
          </span>
        </button>
        <button
          type="button"
          id="game-load"
          className="hub-tile"
          onClick={() => document.getElementById('file')?.click()}
        >
          <span className="hub-tile__icon" aria-hidden="true">
            <IconUpload />
          </span>
          <span className="hub-tile__title">Cargar modelo (JSON)</span>
          <span className="hub-tile__text">
            Abre un proyecto exportado desde OxEye en otro equipo.
          </span>
        </button>
        <button
          type="button"
          id="game-exit"
          className="hub-tile"
          onClick={saveAndExit}
        >
          <span className="hub-tile__icon" aria-hidden="true">
            <IconSave />
          </span>
          <span className="hub-tile__title">Guardar y salir</span>
          <span className="hub-tile__text">
            Guarda la sesión en este dispositivo para retomarla después.
          </span>
        </button>
      </div>
    </HubPage>
  );
};
