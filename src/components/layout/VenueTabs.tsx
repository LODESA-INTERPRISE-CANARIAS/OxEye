import React from 'react';
import {VENUES} from '../../data/catalog';
import {useProjectStore} from '../../store/useProjectStore';
import type {VenueKey} from '../../types';

export interface VenueTabsProps {
  onVenueChanged: () => void;
}

/**
 * Venue selector tab bar (`El Cristo`, `La Constitución`, `La Vega`).
 */
export const VenueTabs: React.FC<VenueTabsProps> = ({onVenueChanged}) => {
  const activeVenue = useProjectStore((s) => s.activeVenue);
  const setVenue = useProjectStore((s) => s.setVenue);

  const venues: Array<{key: VenueKey; num: string; label: string; em?: string}> =
    [
      {
        key: 'cristo',
        num: '01',
        label: 'Plaza del Cristo',
      },
      {
        key: 'constitucion',
        num: '02',
        label: 'Parque de la Constitución',
        em: 'Camino Largo',
      },
      {
        key: 'vega',
        num: '03',
        label: 'Parque de La Vega',
      },
    ];

  return (
    <nav className="venue-tabs" aria-label="Seleccionar recinto">
      {venues.map((v) => (
        <button
          key={v.key}
          type="button"
          className={activeVenue === v.key ? 'active' : ''}
          data-venue={v.key}
          onClick={() => {
            setVenue(v.key);
            onVenueChanged();
          }}
        >
          <small>{v.num}</small>
          <span>
            {VENUES[v.key].name || v.label}
            {v.em && <em>{v.em}</em>}
          </span>
          <i>↗</i>
        </button>
      ))}
    </nav>
  );
};
