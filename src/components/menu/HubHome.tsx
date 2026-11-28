/**
 * Portada (`/`): presents OxEye and its two modules. The Gestor logístico is
 * the main way in; the Simulador and Ajustes follow in order of weight.
 */
import React from 'react';
import type {HubRoute} from './hubRoute';
import {HubVersion} from './HubLayout';
import {IconArrowRight, IconChevronRight, IconSettings} from './HubIcons';
import {HubSymbol} from './HubSymbol';

export interface HubHomeProps {
  canContinue: boolean;
  modelTitle: string;
  onOpenLogistics: () => void;
  onNavigate: (r: HubRoute) => void;
}

/** Set after the first Portada mount of this page load. */
let introPlayed = false;

/** Faint contour texture inside the Gestor card (decorative). */
const CardContours: React.FC = () => (
  <svg
    className="hub-entry__contours"
    viewBox="0 0 400 220"
    preserveAspectRatio="xMaxYMid slice"
    aria-hidden="true"
    focusable="false"
  >
    <g fill="none" stroke="currentColor">
      <path d="M330 40c44 6 70 40 66 80-4 44-44 72-92 66-50-6-80-44-74-86 6-40 50-66 100-60Z" />
      <path d="M326 4c68 8 112 62 106 122-6 66-70 110-142 100-74-10-122-70-112-132 10-62 76-100 148-90Z" />
      <path d="M322-32c92 10 154 84 146 166-8 90-96 150-194 136-100-14-164-96-150-180 14-84 102-136 198-122Z" />
      <path d="M318-68c116 12 196 106 186 210-10 114-122 190-246 172C132 296 52 192 70 86 88-20 200-82 318-68Z" />
    </g>
  </svg>
);

export const HubHome: React.FC<HubHomeProps> = ({
  canContinue,
  modelTitle,
  onOpenLogistics,
  onNavigate,
}) => {
  // Each card is named by its title and described by its text, so a screen
  // reader announces «Gestor logístico, botón» and not the whole card.
  const id = React.useId();
  // The arrival animation plays once per page load, not on every return.
  const [intro] = React.useState(() => !introPlayed);
  React.useEffect(() => {
    introPlayed = true;
  }, []);
  return (
    <div className={`hub-page hub-home ${intro ? 'hub-home--intro' : ''}`}>
      <main className="hub-home__grid">
        <div className="hub-home__intro">
          <p className="hub-eyebrow">San Cristóbal de La Laguna</p>
          <h1 className="hub-title hub-title--brand" tabIndex={-1}>
            OxEye
          </h1>
          <p className="hub-lede">
            Un plano para conversar, un modelo para ensayar.
          </p>

          <nav className="hub-entries" aria-label="Módulos de OxEye">
            <button
              type="button"
              id="game-logistics"
              className="hub-entry hub-entry--primary"
              onClick={onOpenLogistics}
              aria-labelledby={`${id}lx`}
              aria-describedby={`${id}lxd`}
            >
              <CardContours />
              <span className="hub-entry__kicker">Módulo principal</span>
              <span className="hub-entry__title" id={`${id}lx`}>
                Gestor logístico
              </span>
              <span className="hub-entry__text" id={`${id}lxd`}>
                Eventos, tareas, inventarios, contactos y proveedores: qué
                llega, cuándo, quién lo monta y si está hecho.
              </span>
              <span className="hub-entry__tags">
                <span>Montaje y desmontaje</span>
                <span>Multiusuario</span>
                <span>Funciona sin cobertura</span>
              </span>
              <span className="hub-entry__cta">
                Entrar
                <IconArrowRight />
              </span>
            </button>

            <button
              type="button"
              id="game-simulator"
              className="hub-entry hub-entry--secondary"
              onClick={() => onNavigate('simulator')}
              aria-labelledby={`${id}sim`}
              aria-describedby={`${id}simd ${id}sims`}
            >
              <span className="hub-entry__body">
                <span className="hub-entry__title" id={`${id}sim`}>
                  Simulador
                </span>
                <span className="hub-entry__text" id={`${id}simd`}>
                  Ensaya multitudes, emergencias y logística sobre el terreno
                  real.
                </span>
                <span
                  id={`${id}sims`}
                  className={`hub-entry__status ${canContinue ? 'is-ready' : ''}`}
                >
                  <span className="hub-dot" aria-hidden="true" />
                  {canContinue
                    ? `${modelTitle} · guardado en este dispositivo`
                    : 'Sin modelos todavía'}
                </span>
              </span>
              <span className="hub-entry__go" aria-hidden="true">
                <IconChevronRight />
              </span>
            </button>

            <button
              type="button"
              id="game-settings"
              className="hub-entry hub-entry--quiet"
              onClick={() => onNavigate('settings')}
            >
              <span className="hub-entry__icon" aria-hidden="true">
                <IconSettings />
              </span>
              <span className="hub-entry__body">
                <span className="hub-entry__title">Ajustes</span>
                <span className="hub-entry__text">
                  Paleta de color, movimiento reducido y simulador
                </span>
              </span>
              <span className="hub-entry__go" aria-hidden="true">
                <IconChevronRight />
              </span>
            </button>
          </nav>
        </div>

        <div className="hub-home__hero">
          <HubSymbol />
        </div>
      </main>

      <footer className="hub-foot">
        <button
          type="button"
          id="game-about"
          className="hub-link"
          onClick={() => onNavigate('about')}
        >
          Acerca de OxEye
        </button>
        <HubVersion />
      </footer>
    </div>
  );
};
