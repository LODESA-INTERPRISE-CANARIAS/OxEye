/**
 * Acerca de OxEye (`/acerca`): what OxEye is, its two modules, the sources
 * it draws its parameters from (with the honest note that it does not
 * certify) and the credits. Replaces the old «Créditos» screen.
 */
import React from 'react';
import type {HubRoute} from './hubRoute';
import {HubPage, HubVersion} from './HubLayout';
import {IconArrowLeft, IconInfo} from './HubIcons';

export interface AboutScreenProps {
  onNavigate: (r: HubRoute) => void;
}

const SOURCES: readonly {name: string; use: string}[] = [
  // Wording follows doc/claude/01_VISION_Y_DOMINIO.md, section 4.
  {
    name: 'PEMU La Laguna 2011',
    use: 'Plan de Emergencias Municipal de San Cristóbal de La Laguna.',
  },
  {
    name: 'Plan de autoprotección de la Plaza del Cristo 2021',
    use: 'El plan del recinto de referencia del simulador.',
  },
  {
    name: 'Directiva 89/391/CEE (art. 8)',
    use: 'Primeros auxilios, lucha contra incendios y evacuación.',
  },
  {
    name: 'INSST 2020',
    use: 'Manual de buenas prácticas de montaje y desmontaje.',
  },
];

export const AboutScreen: React.FC<AboutScreenProps> = ({onNavigate}) => (
  <HubPage className="hub-page--about" onHome={() => onNavigate('home')}>
    <header className="hub-head">
      <p className="hub-eyebrow">Ojo de Buey</p>
      <h1 className="hub-title hub-title--page" tabIndex={-1}>
        Acerca de OxEye
      </h1>
      <p className="hub-lede hub-lede--sm">
        OxEye es un espacio en el navegador para anticipar cómo funcionará un
        evento público antes de que ocurra: un plano para conversar, un modelo
        para ensayar. Lo usan equipos municipales, producción, seguridad y
        ciudadanía sobre el terreno real de La Laguna o de cualquier otro lugar.
      </p>
    </header>

    <section className="hub-group" aria-labelledby="hub-about-modules">
      <h2 className="hub-group__title" id="hub-about-modules">
        Dos módulos, un producto
      </h2>
      <div className="hub-modules">
        <article className="hub-module">
          <h3 className="hub-module__title">Gestor logístico</h3>
          <p>
            El montaje y desmontaje del evento: qué tiene que llegar, cuándo, de
            quién, quién lo instala y si ya está hecho. Eventos, tareas,
            inventarios, contactos y proveedores, compartidos por todo el
            equipo.
          </p>
        </article>
        <article className="hub-module">
          <h3 className="hub-module__title">Simulador</h3>
          <p>
            Coloca cada elemento sobre el terreno y ensaya multitudes,
            emergencias y logística: rutas de evacuación, servicios de
            accesibilidad y cargas sobre el subsuelo.
          </p>
        </article>
      </div>
    </section>

    <section className="hub-group" aria-labelledby="hub-about-sources">
      <h2 className="hub-group__title" id="hub-about-sources">
        Fuentes metodológicas
      </h2>
      <ul className="hub-sources">
        {SOURCES.map(s => (
          <li key={s.name}>
            <span className="hub-sources__name">{s.name}</span>
            <span className="hub-sources__use">{s.use}</span>
          </li>
        ))}
      </ul>
      <p className="hub-note">
        <IconInfo />
        <span>
          OxEye ayuda a decidir; no certifica. Los umbrales son orientativos y
          editables.
        </span>
      </p>
    </section>

    <section
      className="hub-group hub-group--quiet"
      aria-labelledby="hub-about-credits"
    >
      <h2 className="hub-group__title" id="hub-about-credits">
        Créditos
      </h2>
      <div className="hub-credits">
        <p>OxEye · proyecto de Yeray López de Saja.</p>
        <p>
          Cartografía © OpenStreetMap contributors, ODbL. Ortofotografía
          PNOA–IGN, CC BY 4.0.
        </p>
        <p>
          Prototipo independiente de planificación. Parámetros locales
          pendientes de contraste técnico.
        </p>
      </div>
    </section>

    <footer className="hub-savebar">
      <HubVersion />
      <button
        type="button"
        id="game-back"
        className="hub-btn hub-btn--secondary"
        onClick={() => onNavigate('home')}
      >
        <IconArrowLeft />
        Volver
      </button>
    </footer>
  </HubPage>
);
