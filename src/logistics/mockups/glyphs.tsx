/**
 * Category glyphs for the mock-ups' big choice cards. Same grammar as the
 * Gestor's icon set (24 px grid, 1.8 stroke, `currentColor`), so they follow
 * every palette. If the cards are approved, these move to `ui/icons.tsx`.
 */
import React from 'react';
import type {CategoryId} from './data';

const GLYPHS: Record<CategoryId, React.ReactNode> = {
  carpas: (
    <>
      <path d="M3 18 12 5l9 13" />
      <path d="M3 18h18M7.5 18v-4M16.5 18v-4M12 5v13" />
    </>
  ),
  limpieza: (
    <>
      <path d="M14 3 9.5 12" />
      <path d="M6 12h7.5l2 9H4Z" />
      <path d="M8 16.5v4.5M11.5 16.5v4.5" />
      <path d="M18 5.5v3M16.5 7h3" />
    </>
  ),
  sonido: (
    <>
      <rect x="6" y="3" width="12" height="18" rx="2.5" />
      <circle cx="12" cy="14.5" r="3.2" />
      <path d="M12 7.5h.01" />
    </>
  ),
  iluminacion: (
    <>
      <path d="M9 17h6M10 20.5h4" />
      <path d="M12 3a6 6 0 0 0-3.5 10.9c.5.4.5.9.5 1.6V17h6v-1.5c0-.7 0-1.2.5-1.6A6 6 0 0 0 12 3Z" />
    </>
  ),
  vallas: (
    <>
      <path d="M3 8h18M3 14h18" />
      <path d="M5 5v15M10 5v15M14 5v15M19 5v15" />
    </>
  ),
  ocio: (
    <>
      <path d="M4 20V9l2.5-3L9 9V7l3-3 3 3v2l2.5-3L20 9v11Z" />
      <path d="M10 20v-4a2 2 0 0 1 4 0v4" />
    </>
  ),
  aseos: (
    <>
      <rect x="6" y="3" width="12" height="18" rx="2" />
      <path d="M6 7h12M14.5 13v2" />
    </>
  ),
  catering: (
    <>
      <path d="M4 15a8 8 0 0 1 16 0Z" />
      <path d="M3 18h18M12 5v2" />
    </>
  ),
  transporte: (
    <>
      <path d="M2.5 6.5h11v10h-11ZM13.5 10h4l3 3.5v3h-7" />
      <circle cx="6.5" cy="17.5" r="1.8" />
      <circle cx="17" cy="17.5" r="1.8" />
    </>
  ),
  personal: (
    <>
      <circle cx="12" cy="7.5" r="3.5" />
      <path d="M5 20c.8-3.6 3.6-6 7-6s6.2 2.4 7 6" />
    </>
  ),
  seguridad: (
    <>
      <path d="M12 3 4.5 6v5.5c0 4.5 3.2 8 7.5 9.5 4.3-1.5 7.5-5 7.5-9.5V6Z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </>
  ),
  otros: (
    <>
      <circle cx="6" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="18" cy="12" r="1.6" />
    </>
  ),
};

export const Glyph: React.FC<{name: CategoryId; size?: number}> = ({
  name,
  size = 28,
}) => (
  <svg
    className="lx-icon"
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
    {GLYPHS[name]}
  </svg>
);
