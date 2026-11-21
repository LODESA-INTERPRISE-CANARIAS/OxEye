import React, {useCallback, useEffect, useState} from 'react';
import {useProjectStore} from '../../store/useProjectStore';

interface TourStep {
  id: string;
  selector: string;
  title: string;
  body: string;
  directive: string;
}

const TOUR_STEPS: TourStep[] = [
  {
    id: 'map',
    selector: '#map',
    title: 'El plano editable del evento',
    body: 'Aquí trabajarás sobre la cartografía vectorial de tu zona. Usa la rueda para ampliar o alejar y arrastra con el botón central del ratón para mover la cámara en cualquier momento, incluso mientras dibujas.',
    directive: 'Observa el lienzo principal y continúa cuando quieras.',
  },
  {
    id: 'phases',
    selector: '.phase-strip',
    title: 'Fases operativas y recinto',
    body: 'Alterna entre Pre-evento (montaje), Evento (apertura al público), Postevento (desmontaje y limpieza) y la vista Compuesta para comprobar solapamientos. A la derecha verás el recinto activo.',
    directive: 'Cada pieza puede mostrarse en una o varias fases.',
  },
  {
    id: 'workspace-bar',
    selector: '.workspace-bar',
    title: 'Plano, Ortofoto y Capas',
    body: 'Cambia entre el plano vectorial limpio y la imagen aérea en Ortofoto. El botón «Capas» permite activar la cuadrícula métrica, los nombres de calles y la capa de Rayos X del subsuelo.',
    directive: 'Continúa para conocer los espacios de trabajo.',
  },
  {
    id: 'rail',
    selector: '.rail',
    title: 'Diseñar, Simular y Revisar',
    body: 'El raíl izquierdo organiza tu flujo en tres momentos: Diseñar la distribución, Simular la afluencia e incidencias en vivo, y Revisar fricciones, notas y propuestas de mejora.',
    directive: 'Ahora estás en el espacio 01 · Diseñar.',
  },
  {
    id: 'sidebar',
    selector: '#sidebar',
    title: 'Inventario, catálogo y recorridos',
    body: 'Desde este panel lateral gestionas el inventario de piezas, el autoconfigurador automático, el catálogo de estructuras, el perímetro, las zonas excluidas y la detección de accesos desde las vías reales.',
    directive: 'Las herramientas se desbloquearán en cuanto traces el perímetro.',
  },
  {
    id: 'map-tools',
    selector: '.map-tools',
    title: 'Herramientas rápidas y deshacer',
    body: 'Alterna entre selección libre, medición de distancias en metros y observaciones georreferenciadas por celda, además de deshacer y rehacer cambios (Ctrl+Z / Ctrl+Y).',
    directive: 'Lee el indicador y continúa cuando quieras.',
  },
  {
    id: 'sim-strip',
    selector: '.sim-strip',
    title: 'Control de simulación en vivo',
    body: 'Cuando tengas tu montaje listo, pulsa Iniciar para simular asistentes, colas, clima y emergencias. Puedes cambiar la velocidad (1× a 1200×) y moverte por la línea temporal.',
    directive: 'Observa los indicadores de ocupación y tiempo simulado.',
  },
  {
    id: 'header-actions',
    selector: '.header-actions',
    title: 'Herramientas de gestión y guardado',
    body: 'En la barra superior encontrarás el Menú principal, la calculadora de servicios, el Inventario, la Revisión de riesgos, el Programa por días, Contactos, Empresas y la exportación/importación del proyecto en JSON.',
    directive: 'Tu proyecto se guarda automáticamente en el navegador.',
  },
  {
    id: 'draw-confirm',
    selector: '#draw-confirm',
    title: 'Primer paso: delimita el perímetro',
    body: 'Al terminar este tutorial empezarás trazando el perímetro operativo sobre el mapa (mínimo 3 puntos) y pulsando «Terminar». El sistema detectará los accesos peatonales y vehiculares y abrirá el inventario.',
    directive: 'Pulsa «Terminar tutorial» para empezar a diseñar tu evento.',
  },
];

interface RectBox {
  top: number;
  left: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

/**
 * Visita guiada interactiva con foco luminoso (spotlight) y tarjeta flotante
 * inspirada en `event-tutorial.mjs`. Se ejecuta al crear el proyecto si el usuario
 * activó la opción en el asistente, previo a cualquier otra interacción.
 */
export const TutorialOverlay: React.FC = () => {
  const tutorialActive = useProjectStore((s) => s.tutorialActive);
  const menuOpen = useProjectStore((s) => s.menuOpen);
  const setTutorialActive = useProjectStore((s) => s.setTutorialActive);

  const [stepIndex, setStepIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [targetRect, setTargetRect] = useState<RectBox | null>(null);

  const step = TOUR_STEPS[stepIndex] || TOUR_STEPS[0];

  const measureTarget = useCallback(() => {
    if (!tutorialActive || menuOpen || paused) {
      setTargetRect(null);
      return;
    }
    const el = document.querySelector<HTMLElement>(step.selector);
    if (!el) {
      setTargetRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) {
      setTargetRect(null);
      return;
    }
    const pad = 6;
    const top = Math.max(4, r.top - pad);
    const left = Math.max(4, r.left - pad);
    const right = Math.min(window.innerWidth - 4, r.right + pad);
    const bottom = Math.min(window.innerHeight - 4, r.bottom + pad);
    setTargetRect({
      top,
      left,
      width: Math.max(24, right - left),
      height: Math.max(24, bottom - top),
      right,
      bottom,
    });
  }, [tutorialActive, menuOpen, paused, step.selector]);

  useEffect(() => {
    if (tutorialActive) {
      setStepIndex(0);
      setPaused(false);
    }
  }, [tutorialActive]);

  useEffect(() => {
    if (!tutorialActive || menuOpen || paused) return;
    const el = document.querySelector<HTMLElement>(step.selector);
    if (el) {
      const reduced = window.matchMedia?.(
        '(prefers-reduced-motion: reduce)'
      ).matches;
      el.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
        behavior: reduced ? 'auto' : 'smooth',
      });
    }
    measureTarget();
    const raf = requestAnimationFrame(measureTarget);
    window.addEventListener('resize', measureTarget);
    window.addEventListener('scroll', measureTarget, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', measureTarget);
      window.removeEventListener('scroll', measureTarget, true);
    };
  }, [tutorialActive, menuOpen, paused, step.selector, measureTarget]);

  useEffect(() => {
    if (!tutorialActive || menuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setTutorialActive(false);
      } else if (e.key === 'ArrowRight' && !paused) {
        if (stepIndex < TOUR_STEPS.length - 1) setStepIndex((i) => i + 1);
      } else if (e.key === 'ArrowLeft' && !paused) {
        if (stepIndex > 0) setStepIndex((i) => i - 1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [tutorialActive, menuOpen, paused, stepIndex, setTutorialActive]);

  if (!tutorialActive || menuOpen) return null;

  // Cálculo de posición inteligente de la tarjeta flotante (derecha -> izquierda -> abajo -> arriba)
  const cardStyle: React.CSSProperties = {};
  if (paused) {
    cardStyle.right = '22px';
    cardStyle.bottom = '22px';
  } else if (targetRect) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cardW = Math.min(350, vw - 24);
    const cardH = 240;
    let left = 0;
    let top = 0;

    if (targetRect.right + 20 + cardW <= vw - 12) {
      left = targetRect.right + 20;
      top = Math.max(14, Math.min(vh - cardH - 14, targetRect.top));
    } else if (targetRect.left - 20 - cardW >= 12) {
      left = targetRect.left - 20 - cardW;
      top = Math.max(14, Math.min(vh - cardH - 14, targetRect.top));
    } else if (targetRect.bottom + 16 + cardH <= vh - 12) {
      left = Math.max(12, Math.min(vw - cardW - 12, targetRect.left));
      top = targetRect.bottom + 16;
    } else if (targetRect.top - 16 - cardH >= 12) {
      left = Math.max(12, Math.min(vw - cardW - 12, targetRect.left));
      top = targetRect.top - 16 - cardH;
    } else {
      left = Math.max(12, (vw - cardW) / 2);
      top = Math.max(14, Math.min(vh - cardH - 14, vh * 0.2));
    }
    cardStyle.left = `${Math.round(left)}px`;
    cardStyle.top = `${Math.round(top)}px`;
    cardStyle.width = `${Math.round(cardW)}px`;
  } else {
    cardStyle.left = '50%';
    cardStyle.top = '50%';
    cardStyle.transform = 'translate(-50%, -50%)';
    cardStyle.width = 'min(360px, calc(100vw - 24px))';
  }

  const isLast = stepIndex === TOUR_STEPS.length - 1;

  return (
    <div id="tutorial-overlay" className="tour-root">
      {!paused && targetRect && (
        <div
          id="tour-spot"
          className="tour-spot"
          style={{
            top: `${targetRect.top}px`,
            left: `${targetRect.left}px`,
            width: `${targetRect.width}px`,
            height: `${targetRect.height}px`,
          }}
        />
      )}
      {!paused && !targetRect && <div className="tour-backdrop-full" />}

      <aside
        id="tour-coach"
        className={`tour-coach ${paused ? 'is-paused' : ''}`}
        role="dialog"
        aria-label="Tutorial guiado de OxEye"
        style={cardStyle}
      >
        <div className="tour-coach-head">
          <span className="tour-coach-eyebrow">
            {paused
              ? 'GUÍA EN PAUSA'
              : `TUTORIAL · ${stepIndex + 1} / ${TOUR_STEPS.length}`}
          </span>
          <button
            type="button"
            id="tour-close"
            className="tour-close-btn"
            aria-label="Salir del tutorial"
            onClick={() => setTutorialActive(false)}
          >
            ×
          </button>
        </div>

        {paused ? (
          <>
            <h3>Guía en pausa</h3>
            <p>
              Tómate tu tiempo para observar la interfaz. Puedes reanudar el
              recorrido guiado en el paso {stepIndex + 1} cuando quieras.
            </p>
            <div className="tour-actions">
              <button
                type="button"
                id="tour-resume"
                className="dark"
                onClick={() => setPaused(false)}
              >
                Continuar guía
              </button>
              <button
                type="button"
                className="quiet"
                onClick={() => setTutorialActive(false)}
              >
                Salir
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 id="tour-title">{step.title}</h3>
            <p id="tour-body">{step.body}</p>
            <strong className="tour-directive">{step.directive}</strong>
            <div className="tour-progress-dots" aria-hidden="true">
              {TOUR_STEPS.map((st, idx) => (
                <span
                  key={st.id}
                  className={
                    idx === stepIndex
                      ? 'is-active'
                      : idx < stepIndex
                        ? 'is-done'
                        : ''
                  }
                />
              ))}
            </div>
            <div className="tour-actions">
              {stepIndex > 0 && (
                <button
                  type="button"
                  id="tour-prev"
                  className="quiet"
                  onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
                >
                  Anterior
                </button>
              )}
              <button
                type="button"
                id="tour-next"
                className="dark"
                onClick={() => {
                  if (isLast) {
                    setTutorialActive(false);
                  } else {
                    setStepIndex((i) => i + 1);
                  }
                }}
              >
                {isLast ? 'Terminar tutorial' : 'Entendido, continuar'}
              </button>
              <button
                type="button"
                id="tour-pause"
                className="quiet"
                onClick={() => setPaused(true)}
              >
                Pausar guía
              </button>
            </div>
          </>
        )}
      </aside>
    </div>
  );
};
