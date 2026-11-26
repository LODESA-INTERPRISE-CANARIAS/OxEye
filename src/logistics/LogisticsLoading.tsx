/**
 * Small, eagerly loaded pieces the hub needs around the lazy Logistics
 * Manager: a calm loading layer and an error boundary for a chunk that fails
 * to load (e.g. no coverage). Kept tiny so the simulator bundle barely grows.
 */
import React from 'react';
import '../styles/logistics/loading.css';

const Mark: React.FC = () => (
  <svg
    width="44"
    height="44"
    viewBox="0 0 64 64"
    aria-hidden="true"
    focusable="false"
  >
    <rect width="64" height="64" rx="19" className="lx-boot__mark-bg" />
    <path
      d="M9 32Q32 6 55 32Q32 58 9 32Z"
      fill="none"
      className="lx-boot__mark-lid"
      strokeWidth="3"
    />
    <circle cx="32" cy="32" r="11" className="lx-boot__mark-iris" />
    <circle cx="32" cy="32" r="4" className="lx-boot__mark-bg" />
  </svg>
);

export const LogisticsLoading: React.FC = () => (
  <div
    className="lx-boot"
    id="logistics-loading"
    role="status"
    aria-live="polite"
  >
    <Mark />
    <p className="lx-boot__title">Gestor logístico</p>
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
