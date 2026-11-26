/**
 * Half-donut gauge in SVG. The value arc uses the palette accent; the centre
 * shows the figure with tabular numerals.
 */
import React, {useId} from 'react';

export interface GaugeProps {
  /** 0–100, or null when there is nothing to measure. */
  value: number | null;
  /** Big figure in the centre (defaults to «NN %»). */
  display?: React.ReactNode;
  caption?: React.ReactNode;
  /** Accessible description, e.g. «32 % de eventos validados». */
  label: string;
}

export const Gauge: React.FC<GaugeProps> = ({
  value,
  display,
  caption,
  label,
}) => {
  const gradientId = `lx-gauge-${useId().replace(/:/g, '')}`;
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <figure className="lx-gauge" role="img" aria-label={label}>
      <svg viewBox="0 0 220 120" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={gradientId} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" className="lx-gauge__stop-a" />
            <stop offset="1" className="lx-gauge__stop-b" />
          </linearGradient>
        </defs>
        <path
          className="lx-gauge__track"
          d="M20 110 A90 90 0 0 1 200 110"
          pathLength={100}
        />
        {pct > 0 && (
          <path
            className="lx-gauge__value"
            d="M20 110 A90 90 0 0 1 200 110"
            pathLength={100}
            stroke={`url(#${gradientId})`}
            strokeDasharray={`${pct} 100`}
          />
        )}
      </svg>
      <figcaption className="lx-gauge__center">
        <span className="lx-gauge__figure">
          {display ?? (value == null ? '—' : `${Math.round(pct)} %`)}
        </span>
        {caption && <span className="lx-gauge__caption">{caption}</span>}
      </figcaption>
    </figure>
  );
};
