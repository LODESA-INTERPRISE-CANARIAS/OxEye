import React from 'react';

export interface InventoryIconProps {
  name: string;
  size?: number;
  className?: string;
}

/**
 * Iconos vectoriales limpios (SVG 24×24, `currentColor`) para categorías y piezas
 * del menú de inventario y condiciones de respuesta. Se adaptan automáticamente a
 * cualquier paleta activa (Ox Eye, Atlas, Noctis, Territorio, Vector, Bendy).
 */
export const InventoryIcon: React.FC<InventoryIconProps> = ({
  name,
  size = 18,
  className,
}) => {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    'aria-hidden': true,
  };

  switch (name) {
    // --- Categorías y utilidades ---
    case 'all':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
      );
    case 'emergency':
      return (
        <svg {...common}>
          <path d="M12 3l8 3.5v5.2c0 4.6-3.4 8.5-8 9.8-4.6-1.3-8-5.2-8-9.8V6.5L12 3z" />
          <path d="M12 8.5v7M8.5 12h7" />
        </svg>
      );
    case 'commerce':
      return (
        <svg {...common}>
          <path d="M3 9l1.5-5h15L21 9" />
          <path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" />
          <path d="M5 12v8h14v-8" />
          <path d="M10 20v-5h4v5" />
        </svg>
      );
    case 'comfort':
      return (
        <svg {...common}>
          <path d="M3 13a9 9 0 0 1 18 0H3z" />
          <path d="M12 13v8M8 21h8" />
        </svg>
      );
    case 'logistics':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3h.1a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8v.1a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.4 1z" />
        </svg>
      );
    case 'response':
      return (
        <svg {...common}>
          <circle cx="12" cy="13" r="8" />
          <path d="M12 9v4l2.5 2" />
          <path d="M9 2h6M12 2v3" />
        </svg>
      );
    case 'search':
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.8-3.8" />
        </svg>
      );
    case 'detection':
      return (
        <svg {...common}>
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
      );

    // --- Emergencias y seguridad ---
    case 'fire':
      return (
        <svg {...common}>
          <rect x="2" y="9" width="13" height="8" rx="1.5" />
          <path d="M15 11h4l3 3v3h-7" />
          <circle cx="6.5" cy="18.5" r="1.8" />
          <circle cx="18" cy="18.5" r="1.8" />
          <path d="M4 9V6h9M7 6v3M10 6v3" />
        </svg>
      );
    case 'patrol':
      return (
        <svg {...common}>
          <path d="M3 14l2-5h14l2 5v4H3v-4z" />
          <path d="M9 9V7h6v2" />
          <circle cx="7" cy="18" r="1.6" />
          <circle cx="17" cy="18" r="1.6" />
          <path d="M7 14h10" />
        </svg>
      );
    case 'security':
      return (
        <svg {...common}>
          <circle cx="12" cy="6.5" r="3" />
          <path d="M6.5 20v-2.5a5.5 5.5 0 0 1 11 0V20" />
          <path d="M12 12l2 1.2v2.2c0 1.2-.9 2.2-2 2.6-1.1-.4-2-1.4-2-2.6v-2.2L12 12z" />
        </svg>
      );
    case 'ambulance':
      return (
        <svg {...common}>
          <rect x="2" y="8" width="13" height="9" rx="1.5" />
          <path d="M15 11h4l3 3v3h-7" />
          <path d="M8.5 10.5v4M6.5 12.5h4" />
          <circle cx="6.5" cy="18.5" r="1.8" />
          <circle cx="18" cy="18.5" r="1.8" />
        </svg>
      );
    case 'medical':
      return (
        <svg {...common}>
          <rect x="4" y="4" width="16" height="16" rx="3" />
          <path d="M12 8v8M8 12h8" />
        </svg>
      );
    case 'steward':
      return (
        <svg {...common}>
          <circle cx="12" cy="6.5" r="2.8" />
          <path d="M6 20v-2a6 6 0 0 1 12 0v2" />
          <path d="M9 13.5h6M12 11.5v4" />
        </svg>
      );
    case 'extinguisher':
      return (
        <svg {...common}>
          <rect x="8" y="8" width="8" height="12" rx="3" />
          <path d="M12 8V5m-2 0h4l2 2" />
          <path d="M8 11H5v4" />
        </svg>
      );

    // --- Comercio y actividad ---
    case 'craft':
      return (
        <svg {...common}>
          <path d="M9 4h6l-1 4c2.5 1.5 3.5 4 3 7.5-.4 2.5-2.2 4.5-5 4.5s-4.6-2-5-4.5C6.5 12 7.5 9.5 10 8L9 4z" />
          <path d="M8.5 13h7" />
        </svg>
      );
    case 'books':
      return (
        <svg {...common}>
          <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H12v17H6.5A2.5 2.5 0 0 0 4 21V5.5z" />
          <path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H12v17h5.5a2.5 2.5 0 0 1 2.5 1V5.5z" />
        </svg>
      );
    case 'local':
      return (
        <svg {...common}>
          <path d="M5 10h14l-1.5 9h-11L5 10z" />
          <path d="M8 10l3-5M16 10l-3-5M9 14v2M12 14v2M15 14v2" />
        </svg>
      );
    case 'ventorrillo':
      return (
        <svg {...common}>
          <path d="M4 10h16v9H4z" />
          <path d="M3 10l2-5h14l2 5" />
          <path d="M8 14h8M12 14v5" />
        </svg>
      );
    case 'food':
      return (
        <svg {...common}>
          <rect x="2" y="7" width="13" height="10" rx="1.5" />
          <path d="M15 11h4l3 3v3h-7" />
          <rect x="5" y="9.5" width="7" height="3.5" rx=".5" />
          <circle cx="6.5" cy="18.5" r="1.8" />
          <circle cx="18" cy="18.5" r="1.8" />
        </svg>
      );
    case 'workshop':
      return (
        <svg {...common}>
          <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.2 2.2-2.8-2.8 2-2.4z" />
        </svg>
      );
    case 'stage':
      return (
        <svg {...common}>
          <path d="M3 16h18v4H3z" />
          <path d="M5 16V6l7-2 7 2v10" />
          <circle cx="12" cy="10.5" r="2" />
        </svg>
      );

    // --- Confort y mobiliario ---
    case 'cover':
      return (
        <svg {...common}>
          <path d="M3 12l9-7 9 7" />
          <path d="M5 12v8M19 12v8M3 20h18" />
        </svg>
      );
    case 'picnic':
      return (
        <svg {...common}>
          <path d="M4 9h16M7 9l-2 10M17 9l2 10M2 15h20" />
        </svg>
      );
    case 'rest':
      return (
        <svg {...common}>
          <path d="M4 11V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3" />
          <path d="M2 11h20v6H2zM5 17v3M19 17v3" />
        </svg>
      );
    case 'toilet':
      return (
        <svg {...common}>
          <circle cx="8" cy="6" r="1.8" />
          <path d="M6 10h4v5H9v4H7v-4H6v-5z" />
          <circle cx="16" cy="6" r="1.8" />
          <path d="M14 10h4l1 5h-2v4h-2v-4h-2l1-5z" />
        </svg>
      );

    // --- Accesos y logística ---
    case 'gate':
      return (
        <svg {...common}>
          <path d="M4 20V5h6v15M14 5h6v15" />
          <path d="M9 12h6M13 9.5L15.5 12 13 14.5" />
        </svg>
      );
    case 'bin':
      return (
        <svg {...common}>
          <path d="M4 7h16M9 7V4h6v3" />
          <path d="M6 7l1 13h10l1-13M10 11v5M14 11v5" />
        </svg>
      );
    case 'ballast':
      return (
        <svg {...common}>
          <path d="M6 19h12l-2-10H8l-2 10z" />
          <circle cx="12" cy="6.5" r="2.2" />
        </svg>
      );
    case 'power':
      return (
        <svg {...common}>
          <path d="M13 2L5 13h6l-1 9 9-12h-6l0-8z" />
        </svg>
      );
    case 'loading':
      return (
        <svg {...common}>
          <rect x="4" y="4" width="16" height="16" rx="2.5" />
          <path d="M9.5 16V8h3.5a2.5 2.5 0 0 1 0 5H9.5" />
        </svg>
      );
    case 'turning':
      return (
        <svg {...common}>
          <path d="M9 14L4 9l5-5" />
          <path d="M4 9h10a5 5 0 0 1 0 10h-3" />
        </svg>
      );
    case 'storage':
      return (
        <svg {...common}>
          <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />
          <path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" />
        </svg>
      );

    default:
      return (
        <svg {...common}>
          <rect x="4" y="4" width="16" height="16" rx="2.5" />
        </svg>
      );
  }
};
