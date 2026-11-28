/**
 * Shared frame of the hub screens (Simulador, Ajustes, Acerca de): a top bar
 * with the way back to the Portada and the brand, and a centred column.
 * The Portada and the wizard have their own frames.
 */
import React from 'react';
import {version} from '../../../package.json';
import {BrandSymbol} from '../common/BrandSymbol';
import {IconArrowLeft} from './HubIcons';

export const HUB_VERSION = version;

export interface HubPageProps {
  /** Modifier for the page, e.g. `hub-page--settings`. */
  className?: string;
  /** «Portada» button in the top bar (`#hub-back`). */
  onHome: () => void;
  children: React.ReactNode;
}

export const HubPage: React.FC<HubPageProps> = ({
  className,
  onHome,
  children,
}) => (
  <div className={['hub-page', className].filter(Boolean).join(' ')}>
    <header className="hub-topbar">
      <button type="button" id="hub-back" className="hub-back" onClick={onHome}>
        <IconArrowLeft />
        Portada
      </button>
      <span className="hub-topbar__brand" aria-hidden="true">
        <BrandSymbol size={22} variant="glyph" />
        OxEye
      </span>
    </header>
    <main className="hub-main">{children}</main>
  </div>
);

/** «v0.16.0», with tabular figures. */
export const HubVersion: React.FC<{className?: string}> = ({className}) => (
  <span
    className={['hub-version', className].filter(Boolean).join(' ')}
    title={`Versión ${HUB_VERSION}`}
  >
    v{HUB_VERSION}
  </span>
);
