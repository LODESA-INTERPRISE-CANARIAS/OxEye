/**
 * Small line icons for the hub (24 × 24, `currentColor`, decorative).
 * Hub-local on purpose: the hub does not depend on the Gestor's internals.
 */
import React from 'react';

const Svg: React.FC<{children: React.ReactNode; size?: number}> = ({
  children,
  size = 20,
}) => (
  <svg
    className="hub-icon"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {children}
  </svg>
);

export const IconArrowRight: React.FC = () => (
  <Svg>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Svg>
);

export const IconArrowLeft: React.FC = () => (
  <Svg>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Svg>
);

export const IconChevronRight: React.FC = () => (
  <Svg>
    <path d="M9 6l6 6-6 6" />
  </Svg>
);

export const IconSettings: React.FC = () => (
  <Svg>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </Svg>
);

export const IconPlus: React.FC = () => (
  <Svg>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const IconUpload: React.FC = () => (
  <Svg>
    <path d="M12 15V4M7 9l5-5 5 5M5 15v4h14v-4" />
  </Svg>
);

export const IconSave: React.FC = () => (
  <Svg>
    <path d="M5 4h11l3 3v13H5z" />
    <path d="M8 4v5h7V4M8 20v-6h8v6" />
  </Svg>
);

export const IconDownload: React.FC = () => (
  <Svg>
    <path d="M12 4v11M7 10l5 5 5-5M5 19h14" />
  </Svg>
);

export const IconCheck: React.FC<{size?: number}> = ({size}) => (
  <Svg size={size}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Svg>
);

export const IconPlay: React.FC = () => (
  <Svg>
    <path d="M8 5.5v13l10-6.5z" />
  </Svg>
);

export const IconInfo: React.FC = () => (
  <Svg>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </Svg>
);
