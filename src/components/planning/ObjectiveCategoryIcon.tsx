import React from 'react';
import type {ObjectiveCategoryKey} from '../../types';

export interface ObjectiveCategoryIconProps {
  category: ObjectiveCategoryKey;
  size?: number;
  className?: string;
}

/**
 * Icono vectorial SVG para cada categoría del catálogo de objetivos SMART.
 */
export const ObjectiveCategoryIcon: React.FC<ObjectiveCategoryIconProps> = ({
  category,
  size = 14,
  className = 'smart-cat-svg',
}) => {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    'aria-hidden': true as const,
  };

  switch (category) {
    case 'families':
      return (
        <svg {...common}>
          <circle cx="8" cy="7" r="2.7" />
          <circle cx="16.5" cy="8.5" r="2.2" />
          <path d="M3.5 19c0-2.8 2-4.8 4.5-4.8s4.5 2 4.5 4.8" />
          <path d="M13.5 19c.2-2.2 1.6-3.7 3.5-3.7 1.9 0 3.3 1.5 3.5 3.7" />
        </svg>
      );
    case 'local_commerce':
      return (
        <svg {...common}>
          <path d="M4 9l1.5-4.5h13L20 9" />
          <path d="M4 9a2.5 2.5 0 0 0 4 2 2.5 2.5 0 0 0 4 0 2.5 2.5 0 0 0 4 0 2.5 2.5 0 0 0 4-2" />
          <path d="M5.5 12v7.5h13V12" />
          <path d="M10 19.5v-4h4v4" />
        </svg>
      );
    case 'gastronomy':
      return (
        <svg {...common}>
          <path d="M6 3v7a2.5 2.5 0 0 0 5 0V3" />
          <path d="M8.5 3v18" />
          <path d="M16.5 3v18" />
          <path d="M16.5 3c2 0 3.5 2.2 3.5 5.5 0 2.2-1.4 3.5-3.5 3.5" />
        </svg>
      );
    case 'culture':
      return (
        <svg {...common}>
          <path d="M3 9l9-5 9 5" />
          <path d="M4 19.5h16" />
          <path d="M6.5 9.5v7.5" />
          <path d="M12 9.5v7.5" />
          <path d="M17.5 9.5v7.5" />
        </svg>
      );
    case 'music':
      return (
        <svg {...common}>
          <path d="M9 17.5V6l10-2v11.5" />
          <circle cx="6.5" cy="17.5" r="2.5" />
          <circle cx="16.5" cy="15.5" r="2.5" />
        </svg>
      );
    case 'accessibility':
      return (
        <svg {...common}>
          <circle cx="12" cy="5.5" r="2" />
          <path d="M6.5 10h11" />
          <path d="M12 10v4.5l3.5 5" />
          <path d="M12 14.5l-3.5 5" />
        </svg>
      );
    case 'safety':
      return (
        <svg {...common}>
          <path d="M12 3l7 3v5.5c0 4.5-3 7.8-7 9.5-4-1.7-7-5-7-9.5V6l7-3z" />
          <path d="M9.5 12l1.8 1.8 3.5-3.8" />
        </svg>
      );
    case 'logistics':
      return (
        <svg {...common}>
          <rect x="2.5" y="6.5" width="12.5" height="9" rx="1.5" />
          <path d="M15 9.5h4l2.5 3v3H15" />
          <circle cx="7" cy="17.5" r="2" />
          <circle cx="18" cy="17.5" r="2" />
        </svg>
      );
    case 'economy':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M14.8 8.8A4 4 0 0 0 9 12a4 4 0 0 0 5.8 3.2" />
          <path d="M7.5 10.8h5" />
          <path d="M7.5 13.2h5" />
        </svg>
      );
    case 'sustainability':
      return (
        <svg {...common}>
          <path d="M5 19c8 0 14-5 14-14-9 0-14 6-14 14z" />
          <path d="M5 19c3-4 6.5-7.5 10.5-10.5" />
        </svg>
      );
  }
};
