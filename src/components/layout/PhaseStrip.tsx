import React, {useEffect} from 'react';
import {VENUES} from '../../data/catalog';
import {comparePhases, phases} from '../../engine/logistics/phases';
import {useProjectStore} from '../../store/useProjectStore';
import type {PhaseFilter, VenueKey} from '../../types';

export interface PhaseStripProps {
  onPhaseChanged: () => void;
  onVenueChanged: () => void;
}

const phaseCaptions: Record<PhaseFilter, string> = {
  pre: 'Limpieza, acondicionamiento y montaje',
  event: 'Apertura al público y servicios del evento',
  post: 'Desmontaje, retirada y limpieza',
  all: 'Los contornos indican la fase. Selecciona una pieza para consultar su vigencia.',
};

/**
 * Operational phase selector strip (`1. Preparar`, `2. Celebrar`, `3. Recuperar`, `Superponer fases`).
 */
export const PhaseStrip: React.FC<PhaseStripProps> = ({
  onPhaseChanged,
  onVenueChanged,
}) => {
  const phase = useProjectStore((s) => s.phase);
  const setPhase = useProjectStore((s) => s.setPhase);
  const activeVenue = useProjectStore((s) => s.activeVenue);
  const setVenue = useProjectStore((s) => s.setVenue);
  const currentScene = useProjectStore((s) => s.currentScene);
  const currentMap = useProjectStore((s) => s.currentMap);
  const revision = useProjectStore((s) => s.revision);

  const scene = currentScene();
  const map = currentMap();

  useEffect(() => {
    document.body.classList.toggle(
      'phase-planning',
      phase === 'pre' || phase === 'post'
    );
  }, [phase]);

  const overlapRows =
    phase === 'all' ? comparePhases(scene, map) : [];
  const sharedRows = overlapRows.filter((r) => r.shared.length > 0);

  void revision;

  return (
    <section className="phase-strip" aria-label="Fase de planificación">
      <div className="phase-strip-row">
        <div className="phase-strip-left">
          <div className="phase-buttons" role="group" aria-label="Vista del plano">
            {(
              [
                ['pre', 'Pre-evento'],
                ['event', 'Evento'],
                ['post', 'Postevento'],
                ['all', 'Compuesta'],
              ] as Array<[PhaseFilter, string]>
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                data-phase={k}
                aria-pressed={phase === k}
                onClick={() => {
                  setPhase(k);
                  onPhaseChanged();
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="phase-captions">
            <small id="phase-caption">{phaseCaptions[phase]}</small>
            {(phase === 'pre' || phase === 'post') && (
              <small id="shift-info">
                Ensayo logístico · trayectos esquemáticos · turno máximo de 8 h
              </small>
            )}
          </div>
        </div>
        <label className="venue-picker" htmlFor="venue-select">
          <span className="venue-picker-label">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            Recinto
          </span>
          <select
            id="venue-select"
            value={activeVenue}
            onChange={(e) => {
              setVenue(e.target.value as VenueKey);
              onVenueChanged();
            }}
          >
            <option value="cristo">
              01 · {VENUES.cristo.name || 'Plaza del Cristo'}
            </option>
          </select>
        </label>
      </div>
      <details id="phase-summary" hidden={phase !== 'all'}>
        <summary id="phase-readout">
          {phase === 'all'
            ? `${sharedRows.length} coincidencias en una misma fase · ${overlapRows.length - sharedRows.length} usos sucesivos`
            : ''}
        </summary>
        <small>
          Solapamientos geométricos de las reservas logísticas. Los usos
          sucesivos pueden compartir superficie.
        </small>
        <ul id="phase-pairs">
          {phase === 'all' &&
            (overlapRows.length ? (
              overlapRows.map((r, i) => (
                <li key={i}>
                  {r.a} / {r.b} ·{' '}
                  {r.shared.map((k) => phases[k]).join(', ') ||
                    'fases distintas'}
                </li>
              ))
            ) : (
              <li>Sin coincidencias entre huellas logísticas y piezas.</li>
            ))}
        </ul>
      </details>
    </section>
  );
};
