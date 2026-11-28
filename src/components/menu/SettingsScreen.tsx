/**
 * Ajustes (`/ajustes`). Every change applies and persists at once through
 * `updatePreferences` (same `preferences` store as before, so the Gestor
 * keeps following the palette); «Listo» only returns to the Portada.
 */
import React, {useEffect, useRef, useState} from 'react';
import {
  applyPalette,
  COLOR_PALETTES,
  normalizePaletteId,
} from '../../data/palettes';
import {useProjectStore} from '../../store/useProjectStore';
import type {PaletteId, UserPreferences} from '../../types';
import type {HubRoute} from './hubRoute';
import {HubPage, HubVersion} from './HubLayout';
import {IconCheck, IconPlay} from './HubIcons';

export interface SettingsScreenProps {
  canContinue: boolean;
  onOpenTutorial: () => void;
  onNavigate: (r: HubRoute) => void;
}

const SPEEDS = [1, 5, 10, 60, 120, 600, 1200] as const;

const DEFAULT_PREFERENCES: Required<UserPreferences> = {
  speed: 60,
  reduceMotion: false,
  help: true,
  palette: 'oxeye',
};

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  canContinue,
  onOpenTutorial,
  onNavigate,
}) => {
  const preferences = useProjectStore(s => s.preferences);
  const updatePreferences = useProjectStore(s => s.updatePreferences);
  const palette = normalizePaletteId(preferences.palette);

  const [status, setStatus] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const resetRef = useRef<HTMLButtonElement>(null);
  const cancelResetRef = useRef<HTMLButtonElement>(null);

  useEffect(() => () => clearTimeout(statusTimer.current), []);

  const announce = (message: string) => {
    clearTimeout(statusTimer.current);
    setStatus(message);
    statusTimer.current = setTimeout(() => setStatus(''), 4000);
  };

  const change = (partial: Partial<UserPreferences>) => {
    updatePreferences(partial);
    announce('Cambios guardados en este dispositivo');
  };

  const choosePalette = (id: PaletteId) => {
    applyPalette(id);
    change({palette: id});
  };

  // Arrow keys move through the palette radiogroup, as in native radios.
  const onPaletteKey = (e: React.KeyboardEvent, index: number) => {
    const step =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0;
    if (!step) return;
    e.preventDefault();
    const n = COLOR_PALETTES.length;
    const next = COLOR_PALETTES[(index + step + n) % n];
    choosePalette(next.id);
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(`[data-palette-choice="${next.id}"]`)
        ?.focus(),
    );
  };

  const openConfirm = () => {
    setConfirmReset(true);
    requestAnimationFrame(() => cancelResetRef.current?.focus());
  };

  const closeConfirm = () => {
    setConfirmReset(false);
    requestAnimationFrame(() => resetRef.current?.focus());
  };

  const reset = () => {
    applyPalette(DEFAULT_PREFERENCES.palette);
    updatePreferences({...DEFAULT_PREFERENCES});
    closeConfirm();
    announce('Ajustes restablecidos · tus modelos y eventos siguen intactos');
  };

  return (
    <HubPage className="hub-page--settings" onHome={() => onNavigate('home')}>
      <header className="hub-head">
        <h1 className="hub-title hub-title--page" tabIndex={-1}>
          Ajustes
        </h1>
        <p className="hub-lede hub-lede--sm">
          Se guardan al momento en este dispositivo.
        </p>
      </header>

      <section className="hub-group" aria-labelledby="hub-set-look">
        <h2 className="hub-group__title" id="hub-set-look">
          Apariencia
        </h2>

        <div
          className="palette-picker"
          role="radiogroup"
          aria-labelledby="hub-set-palette"
        >
          <p className="hub-field__label" id="hub-set-palette">
            Paleta de color
          </p>
          <div className="palette-grid">
            {COLOR_PALETTES.map((pal, index) => {
              const selected = palette === pal.id;
              return (
                <button
                  key={pal.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  tabIndex={selected ? 0 : -1}
                  data-palette-choice={pal.id}
                  className={`palette-card ${selected ? 'is-selected' : ''}`}
                  onClick={() => choosePalette(pal.id)}
                  onKeyDown={e => onPaletteKey(e, index)}
                >
                  <span className="palette-swatches" aria-hidden="true">
                    {pal.swatches.map((hex, i) => (
                      // Swatch colours are the palette's own sample data.
                      <i key={i} style={{background: hex}} />
                    ))}
                  </span>
                  <span className="palette-card-name">
                    <span className="hub-num">{pal.code}</span> · {pal.name}
                  </span>
                  <span className="palette-card-status">
                    {selected ? (
                      <>
                        <IconCheck size={14} />
                        Seleccionada
                      </>
                    ) : pal.dark ? (
                      'Oscura'
                    ) : (
                      'Clara'
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <label className="hub-toggle">
          <span className="hub-toggle__text">
            <span className="hub-toggle__title">Movimiento reducido</span>
            <span className="hub-toggle__hint">
              Quita las animaciones de la portada y del mapa del simulador. El
              Gestor logístico sigue la preferencia de tu sistema.
            </span>
          </span>
          <input
            id="game-motion"
            type="checkbox"
            role="switch"
            className="hub-switch"
            checked={!!preferences.reduceMotion}
            onChange={e => change({reduceMotion: e.target.checked})}
          />
        </label>
      </section>

      <section className="hub-group" aria-labelledby="hub-set-sim">
        <h2 className="hub-group__title" id="hub-set-sim">
          Simulador
        </h2>

        <label className="hub-field hub-field--row">
          <span className="hub-toggle__text">
            <span className="hub-toggle__title">Velocidad inicial</span>
            <span className="hub-toggle__hint">
              Con la que arranca cada simulación; puedes cambiarla mientras
              corre.
            </span>
          </span>
          <select
            id="game-speed"
            className="hub-select"
            value={preferences.speed ?? DEFAULT_PREFERENCES.speed}
            onChange={e => change({speed: Number(e.target.value)})}
          >
            {SPEEDS.map(n => (
              <option key={n} value={n}>
                {n}×
              </option>
            ))}
          </select>
        </label>

        <label className="hub-toggle">
          <span className="hub-toggle__text">
            <span className="hub-toggle__title">Mostrar guía al entrar</span>
            <span className="hub-toggle__hint">
              Al continuar un modelo, recuerda el recorrido Inventario → Diseñar
              → Simular → Revisar.
            </span>
          </span>
          <input
            id="game-help"
            type="checkbox"
            role="switch"
            className="hub-switch"
            checked={preferences.help !== false}
            onChange={e => change({help: e.target.checked})}
          />
        </label>

        <div className="hub-field hub-field--row">
          <span className="hub-toggle__text">
            <span className="hub-toggle__title">Guía de uso</span>
            <span className="hub-toggle__hint" id="hub-tutorial-hint">
              {canContinue
                ? 'Visita guiada por el plano, las fases y la simulación del modelo actual.'
                : 'Crea o carga primero un modelo para abrir la guía.'}
            </span>
          </span>
          <button
            type="button"
            id="game-open-tutorial"
            className="hub-btn hub-btn--secondary"
            disabled={!canContinue}
            aria-describedby="hub-tutorial-hint"
            title={
              canContinue
                ? 'Abrir el tutorial interactivo sobre el proyecto actual'
                : 'Crea o carga primero un modelo para abrir la guía de uso'
            }
            onClick={onOpenTutorial}
          >
            <IconPlay />
            Guía de uso (iniciar tutorial)
          </button>
        </div>
      </section>

      <section
        className="hub-group hub-group--quiet"
        aria-labelledby="hub-set-reset"
      >
        <h2 className="hub-group__title" id="hub-set-reset">
          Restablecer
        </h2>
        {confirmReset ? (
          <div
            className="hub-confirm"
            role="group"
            aria-labelledby="hub-reset-q"
          >
            <p className="hub-confirm__text" id="hub-reset-q">
              ¿Volver a la paleta OxEye, velocidad 60× y la guía activada? No se
              borra ningún modelo, evento ni dato.
            </p>
            <div className="hub-actions">
              <button
                type="button"
                id="prefs-reset-confirm"
                className="hub-btn hub-btn--primary"
                onClick={reset}
              >
                Restablecer ajustes
              </button>
              <button
                type="button"
                id="prefs-reset-cancel"
                className="hub-btn hub-btn--secondary"
                ref={cancelResetRef}
                onClick={closeConfirm}
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <div className="hub-field hub-field--row">
            <span className="hub-toggle__hint">
              Devuelve los ajustes a los valores de fábrica. No borra datos.
            </span>
            <button
              type="button"
              id="prefs-reset"
              className="hub-btn hub-btn--secondary"
              ref={resetRef}
              onClick={openConfirm}
            >
              Restablecer ajustes
            </button>
          </div>
        )}
      </section>

      <footer className="hub-savebar">
        <p className="hub-status" role="status" aria-live="polite">
          {status && (
            <>
              <IconCheck size={16} />
              {status}
            </>
          )}
        </p>
        <HubVersion />
        <button
          type="button"
          id="prefs-save"
          className="hub-btn hub-btn--primary"
          onClick={() => onNavigate('home')}
        >
          Listo
        </button>
      </footer>
    </HubPage>
  );
};
