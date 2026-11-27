/**
 * Small, eagerly loaded pieces the hub needs around the lazy Logistics
 * Manager: a calm loading layer and an error boundary for a chunk that fails
 * to load (e.g. no coverage). Kept tiny so the simulator bundle barely grows.
 */
import React from 'react';
import {BrandSymbol} from '../components/common/BrandSymbol';
import '../styles/logistics/loading.css';

const Mark: React.FC = () => (
  <BrandSymbol size={64} className="lx-boot__mark" />
);

/**
 * Faint isolines around the centre and a coordinate line: the cartographic
 * backdrop of the module, drawn inline so the hub bundle stays small.
 */
const Backdrop: React.FC = () => (
  <>
    <svg
      className="lx-boot__contours"
      viewBox="0 0 800 800"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <g fill="none" stroke="currentColor">
        <path d="M400 250c96 2 168 58 172 146 4 92-70 160-170 158-104-2-176-64-174-152 2-90 72-154 172-152Z" />
        <path d="M398 190c132 4 236 84 240 206 4 128-100 222-238 220-142-4-246-92-242-214 4-124 104-216 240-212Z" />
        <path d="M402 128c170 6 300 112 302 268 2 162-128 284-306 282-182-2-312-120-306-280 6-158 136-276 310-270Z" />
        <path d="M396 62c206 8 366 140 368 336 2 198-158 346-372 344-218-2-378-148-370-344 8-196 168-344 374-336Z" />
        <path d="M404 -6c242 10 432 170 430 404-2 236-190 412-440 408-254-4-444-180-430-414C-22 162 160-14 404-6Z" />
        <path d="M60 690c120-40 220-30 330 10s210 50 350 0" />
        <path d="M40 120c110 30 190 20 280-20s200-60 340-20" />
      </g>
    </svg>
    <p className="lx-boot__coords" aria-hidden="true">
      La Laguna · 28°29′ N 16°19′ O
    </p>
  </>
);

export const LogisticsLoading: React.FC = () => (
  <div
    className="lx-boot lx-boot--loading"
    id="logistics-loading"
    role="status"
    aria-live="polite"
  >
    <Backdrop />
    <Mark />
    <p className="lx-boot__title">OxEye</p>
    <p className="lx-boot__eyebrow">Gestor logístico</p>
    <span className="lx-boot__progress" aria-hidden="true" />
    <p className="lx-boot__text">Abriendo…</p>
  </div>
);

interface BoundaryProps {
  onClose: () => void;
  children: React.ReactNode;
}

interface BoundaryState {
  failed: boolean;
}

/**
 * Catches a failed lazy import or a render error inside the module and offers
 * to reload (a rejected lazy import is cached until reload; the `#logistica`
 * hash reopens the module) or go back, instead of leaving a blank screen.
 */
export class LogisticsBoundary extends React.Component<
  BoundaryProps,
  BoundaryState
> {
  state: BoundaryState = {failed: false};

  static getDerivedStateFromError(): BoundaryState {
    return {failed: true};
  }

  componentDidCatch(error: unknown): void {
    console.error('[logistics] module failed', error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="lx-boot" id="logistics-load-error" role="alert">
        <Backdrop />
        <Mark />
        <p className="lx-boot__title">
          No se ha podido abrir el Gestor logístico
        </p>
        <p className="lx-boot__text">
          Puede que falte conexión o que la web se haya actualizado. Vuelve a
          intentarlo; si sigue fallando, recarga la página.
        </p>
        <div className="lx-boot__actions">
          <button
            type="button"
            className="lx-boot__btn lx-boot__btn--primary"
            onClick={() => window.location.reload()}
          >
            Recargar
          </button>
          <button
            type="button"
            className="lx-boot__btn"
            onClick={this.props.onClose}
          >
            Volver a OxEye
          </button>
        </div>
      </div>
    );
  }
}
