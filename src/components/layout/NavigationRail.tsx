import React from 'react';
import {useProjectStore} from '../../store/useProjectStore';
import type {ActivePanel} from '../../types';

/**
 * Left vertical navigation rail for switching between Diseñar (`design`),
 * Simular (`simulate`), and Revisar (`review`).
 */
export const NavigationRail: React.FC = () => {
  const panel = useProjectStore((s) => s.panel);
  const setPanel = useProjectStore((s) => s.setPanel);

  const items: Array<{id: ActivePanel; icon: string; label: string}> = [
    {id: 'design', icon: '▧', label: 'Diseñar'},
    {id: 'simulate', icon: '▷', label: 'Simular'},
    {id: 'review', icon: '◎', label: 'Revisar'},
  ];

  return (
    <nav className="rail" aria-label="Espacios de trabajo">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={panel === item.id ? 'active' : ''}
          data-panel={item.id}
          title={item.label}
          onClick={() => setPanel(item.id)}
        >
          <span>{item.icon}</span>
          {item.label}
        </button>
      ))}
    </nav>
  );
};
