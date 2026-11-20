import React, {useEffect, useRef} from 'react';
import {phaseScene} from '../../engine/logistics/phases';
import {useProjectStore} from '../../store/useProjectStore';

export interface SimulationStripProps {
  running: boolean;
  shiftRun: boolean;
  speed: number;
  onSpeedChange: (speed: number) => void;
  onTogglePlay: () => void;
  onResetSim: () => void;
  onTimelineInput: (seconds: number) => void;
  onTimelineChange: (seconds: number) => void;
}

/**
 * Bottom simulation control strip (`#play`, `#clock`, `#present`, `#waiting`,
 * `#object-count`, `#timeline`, `#speed`, `#reset-sim`), matching the original prototype.
 */
export const SimulationStrip: React.FC<SimulationStripProps> = ({
  running,
  shiftRun,
  speed,
  onSpeedChange,
  onTogglePlay,
  onResetSim,
  onTimelineInput,
  onTimelineChange,
}) => {
  const phase = useProjectStore((s) => s.phase);
  const currentScene = useProjectStore((s) => s.currentScene);
  const revision = useProjectStore((s) => s.revision);
  void revision;

  const timelineRef = useRef<HTMLInputElement | null>(null);
  const onTimelineChangeRef = useRef(onTimelineChange);
  onTimelineChangeRef.current = onTimelineChange;

  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return;
    const handleNativeChange = () => {
      onTimelineChangeRef.current(Number(el.value));
    };
    el.addEventListener('change', handleNativeChange);
    return () => el.removeEventListener('change', handleNativeChange);
  }, []);

  const shown = phaseScene(currentScene(), phase);
  const objectCount = shown.base.booths.length + shown.infrastructure.length;
  const isPlaying = running || shiftRun;

  return (
    <section className="simulation-strip" aria-label="Control de simulación">
      <button
        id="play"
        className="play"
        type="button"
        aria-label={isPlaying ? 'Pausar simulación' : 'Iniciar simulación'}
        onClick={onTogglePlay}
      >
        {isPlaying ? (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <rect x="6" y="4" width="4.5" height="16" rx="2" />
            <rect x="13.5" y="4" width="4.5" height="16" rx="2" />
          </svg>
        ) : (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="currentColor"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{marginLeft: '2px'}}
          >
            <polygon points="7 4 19 12 7 20 7 4" />
          </svg>
        )}
      </button>
      <div className="time">
        <b id="clock">00:00</b>
        <small>TIEMPO SIMULADO</small>
      </div>
      <div className="strip-stat">
        <b id="present">—</b>
        <small>PERSONAS DENTRO</small>
      </div>
      <div className="strip-stat">
        <b id="waiting">—</b>
        <small>EN COLA</small>
      </div>
      <div className="strip-stat">
        <b id="object-count">{objectCount}</b>
        <small>ESTRUCTURAS</small>
      </div>
      <div className="timeline-control">
        <div className="timeline-header">
          <label htmlFor="timeline">LÍNEA TEMPORAL</label>
          <output id="seek-time" htmlFor="timeline">
            00:00
          </output>
        </div>
        <input
          ref={timelineRef}
          id="timeline"
          type="range"
          min="0"
          max="28800"
          defaultValue="0"
          step="1"
          onChange={(e) => onTimelineInput(Number(e.target.value))}
        />
      </div>
      <label className="speed">
        Velocidad
        <select
          id="speed"
          value={speed}
          onChange={(e) => onSpeedChange(Number(e.target.value))}
        >
          <option value="1">1×</option>
          <option value="5">5×</option>
          <option value="10">10×</option>
          <option value="60">60×</option>
          <option value="120">120×</option>
          <option value="600">600×</option>
          <option value="1200">1200×</option>
        </select>
      </label>
      <button
        id="reset-sim"
        className="quiet"
        type="button"
        title="Reiniciar simulación"
        onClick={onResetSim}
      >
        ↺ Reiniciar
      </button>
      <span className="sim-note">
        Modelo exploratorio
        <br />
        Sin calibración local
      </span>
    </section>
  );
};
