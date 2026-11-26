/**
 * Centred layout for the screens before the workspace: server states and
 * login. Same editorial header as the workspace, with the contour texture.
 */
import React from 'react';
import {ContourTexture, EyeMark, Icon} from '../ui';
import {EYEBROW} from '../shell/Shell';

export const GateLayout: React.FC<{
  onExit: () => void;
  children: React.ReactNode;
  id?: string;
  wide?: boolean;
}> = ({onExit, children, id, wide = false}) => (
  <div className="lx-gate" id={id}>
    <ContourTexture />
    <div className="lx-gate__bar">
      <div className="lx-brand">
        <EyeMark size={36} />
        <div className="lx-brand__text">
          <strong>Gestor logístico</strong>
          <span>OxEye · Ojo de Buey</span>
        </div>
      </div>
      <button
        type="button"
        className="lx-btn lx-btn--ghost lx-btn--md"
        id="lx-gate-exit"
        onClick={onExit}
      >
        <Icon name="back" size={18} />
        <span className="lx-btn__label">Volver a OxEye</span>
      </button>
    </div>
    <main className={`lx-gate__card${wide ? ' lx-gate__card--wide' : ''}`}>
      <p className="lx-eyebrow">{EYEBROW}</p>
      {children}
    </main>
  </div>
);
