/**
 * Inline SVG icon set for the logistics UI. Stroke icons on a 24 px grid that
 * inherit `currentColor`, so they follow every palette.
 */
import React from 'react';
import {BrandSymbol} from '../../components/common/BrandSymbol';

export type IconName =
  | 'today'
  | 'calendar'
  | 'inventory'
  | 'contacts'
  | 'catalog'
  | 'dayClose'
  | 'plus'
  | 'edit'
  | 'eye'
  | 'close'
  | 'chevronLeft'
  | 'chevronRight'
  | 'chevronDown'
  | 'logout'
  | 'back'
  | 'refresh'
  | 'alert'
  | 'check'
  | 'pin'
  | 'clock'
  | 'lock'
  | 'server'
  | 'cloudOff'
  | 'trash'
  | 'user'
  | 'activity'
  | 'menu'
  | 'flask'
  | 'minus'
  | 'task'
  | 'assembly'
  | 'dismantling'
  | 'activityKind'
  | 'transport'
  | 'delivery'
  | 'other'
  | 'link'
  | 'weight'
  | 'list'
  | 'month'
  | 'columns'
  | 'bell'
  | 'search'
  | 'phone'
  | 'chat'
  | 'mail'
  | 'share'
  | 'copy'
  | 'globe'
  | 'tag'
  | 'building'
  | 'offer'
  | 'scale'
  | 'budget'
  | 'warehouse'
  | 'note'
  | 'decision'
  | 'question'
  | 'idea'
  | 'history'
  | 'play'
  | 'print'
  | 'send'
  | 'order'
  | 'camera'
  | 'tent'
  | 'fence'
  | 'table'
  | 'chair'
  | 'stage'
  | 'bolt'
  | 'speaker'
  | 'sign';

const PATHS: Record<IconName, React.ReactNode> = {
  today: (
    <>
      <path d="M12 3v2M5.6 6.6l1.4 1.4M3 13h2M19 13h2M17 8l1.4-1.4" />
      <path d="M7.5 17a4.5 4.5 0 1 1 9 0" />
      <path d="M3 20h18" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
      <path d="M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01" />
    </>
  ),
  inventory: (
    <>
      <path d="M3.5 8 12 4l8.5 4v8.5L12 20.5 3.5 16.5Z" />
      <path d="M3.5 8 12 12l8.5-4M12 12v8.5" />
    </>
  ),
  contacts: (
    <>
      <circle cx="9" cy="8.5" r="3.5" />
      <path d="M2.5 19.5c.8-3.4 3.4-5.5 6.5-5.5s5.7 2.1 6.5 5.5" />
      <path d="M16 5.2a3.5 3.5 0 0 1 0 6.6M18 14.4c1.8.8 3 2.6 3.5 5.1" />
    </>
  ),
  catalog: (
    <>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5Z" />
      <path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5" />
      <path d="M9 8h7M9 11.5h5" />
    </>
  ),
  dayClose: (
    <>
      <rect x="5" y="3.5" width="14" height="17.5" rx="2.5" />
      <path d="M9 3.5V2.5h6v1M8.5 12.5l2.3 2.3 4.7-4.8" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  edit: (
    <>
      <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16Z" />
      <path d="m13.5 6.5 4 4" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  chevronLeft: <path d="m15 5-7 7 7 7" />,
  chevronRight: <path d="m9 5 7 7-7 7" />,
  chevronDown: <path d="m5 9 7 7 7-7" />,
  logout: (
    <>
      <path d="M14 4h4.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14" />
      <path d="M10 8l-4 4 4 4M6 12h10" />
    </>
  ),
  back: <path d="M19 12H5M11 6l-6 6 6 6" />,
  refresh: (
    <>
      <path d="M20 11a8 8 0 0 0-14.6-4.5L4 8" />
      <path d="M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5L20 16" />
      <path d="M20 20v-4h-4" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3.5 2.5 20h19Z" />
      <path d="M12 10v4.5M12 17.2h.01" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  pin: (
    <>
      <path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11Z" />
      <circle cx="12" cy="10" r="2.3" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </>
  ),
  server: (
    <>
      <rect x="3.5" y="4" width="17" height="7" rx="2" />
      <rect x="3.5" y="13" width="17" height="7" rx="2" />
      <path d="M7.5 7.5h.01M7.5 16.5h.01M11 7.5h5M11 16.5h5" />
    </>
  ),
  cloudOff: (
    <>
      <path d="M7 18.5h10.5a3.5 3.5 0 0 0 1-6.9 6 6 0 0 0-9.8-3.4" />
      <path d="M6.2 9.2A4.7 4.7 0 0 0 7 18.5" />
      <path d="m3 3 18 18" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M10 11v6M14 11v6" />
      <path d="M6 7l1 13h10l1-13M9 7V4h6v3" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.5" r="4" />
      <path d="M4.5 20.5c1-3.8 3.9-6 7.5-6s6.5 2.2 7.5 6" />
    </>
  ),
  activity: <path d="M3 12h4l3-7 4 14 3-7h4" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  flask: (
    <>
      <path d="M9.5 3.5h5M10.5 3.5v5.5L5 19a1.5 1.5 0 0 0 1.3 2.2h11.4A1.5 1.5 0 0 0 19 19l-5.5-10V3.5" />
      <path d="M7.5 15h9" />
    </>
  ),
  minus: <path d="M5 12h14" />,
  task: (
    <>
      <rect x="4" y="3.5" width="16" height="17" rx="2.5" />
      <path d="m7.5 9 1.5 1.5L11.5 8M7.5 15l1.5 1.5 2.5-2.5M14 9.5h3M14 15.5h3" />
    </>
  ),
  // Scaffold with an arrow up: putting a structure up.
  assembly: (
    <>
      <path d="M4.5 21V10M12.5 21V10M4.5 13.5h8M4.5 17.5h8M2.5 21h12" />
      <path d="M18.5 15V4M15.5 7l3-3 3 3" />
    </>
  ),
  // Same scaffold, arrow down: taking it apart.
  dismantling: (
    <>
      <path d="M4.5 21V10M12.5 21V10M4.5 13.5h8M4.5 17.5h8M2.5 21h12" />
      <path d="M18.5 4v11M15.5 12l3 3 3-3" />
    </>
  ),
  activityKind: (
    <path d="M12 3.5 14.4 8.7l5.6.7-4.2 3.8 1.1 5.6L12 16l-4.9 2.8 1.1-5.6L4 9.4l5.6-.7Z" />
  ),
  transport: (
    <>
      <path d="M2.5 6.5h11v9.5h-11Z" />
      <path d="M13.5 10h4l3.5 3.5V16h-7.5" />
      <circle cx="6.5" cy="17.5" r="1.8" />
      <circle cx="17" cy="17.5" r="1.8" />
    </>
  ),
  // A box with an arrow going into it.
  delivery: (
    <>
      <path d="M4 10.5 12 7l8 3.5V18l-8 3.5L4 18Z" />
      <path d="M4 10.5 12 14l8-3.5M12 14v7.5" />
      <path d="M12 1.5v3.8M10 3.5l2 2 2-2" />
    </>
  ),
  other: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8 12h.01M12 12h.01M16 12h.01" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </>
  ),
  weight: (
    <>
      <path d="M9 8a3 3 0 1 1 6 0" />
      <path d="M6.5 8h11l2.5 12.5H4Z" />
    </>
  ),
  list: <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />,
  month: (
    <>
      <rect x="3.5" y="4" width="17" height="16.5" rx="3" />
      <path d="M3.5 9.5h17M3.5 15h17M9.2 9.5v11M14.8 9.5v11" />
    </>
  ),
  columns: (
    <>
      <rect x="3.5" y="4" width="17" height="16.5" rx="3" />
      <path d="M9.2 4v16.5M14.8 4v16.5M3.5 8.5h17" />
    </>
  ),
  bell: (
    <>
      <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15Z" />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 5 5" />
    </>
  ),
  phone: (
    <path d="M5 3.5h3.2l1.6 4.3-2.2 1.5a11 11 0 0 0 5.1 5.1l1.5-2.2 4.3 1.6V17a3 3 0 0 1-3.2 3A15.5 15.5 0 0 1 2 6.7 3 3 0 0 1 5 3.5Z" />
  ),
  chat: (
    <>
      <path d="M4.5 19.5 5.6 16A8 8 0 1 1 8.4 18.6Z" />
      <path d="M9 10.5h.01M12.5 10.5h.01M16 10.5h.01" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m4 7 8 6 8-6" />
    </>
  ),
  share: (
    <>
      <path d="M12 3.5v11M8 7.5l4-4 4 4" />
      <path d="M6 11H5a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 5 21h14a1.5 1.5 0 0 0 1.5-1.5v-7A1.5 1.5 0 0 0 19 11h-1" />
    </>
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="12" height="12" rx="2.5" />
      <path d="M15.5 5.5v-.5A1.5 1.5 0 0 0 14 3.5H5A1.5 1.5 0 0 0 3.5 5v9A1.5 1.5 0 0 0 5 15.5h.5" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.4 2.3 3.5 5.2 3.5 8.5s-1.1 6.2-3.5 8.5c-2.4-2.3-3.5-5.2-3.5-8.5S9.6 5.8 12 3.5Z" />
    </>
  ),
  tag: (
    <>
      <path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.5 1.5 0 0 1 0 2.1l-6.4 6.4a1.5 1.5 0 0 1-2.1 0Z" />
      <path d="M8 8h.01" />
    </>
  ),
  building: (
    <>
      <path d="M4.5 20.5V5A1.5 1.5 0 0 1 6 3.5h8A1.5 1.5 0 0 1 15.5 5v15.5" />
      <path d="M15.5 9.5H18a1.5 1.5 0 0 1 1.5 1.5v9.5M3 20.5h18" />
      <path d="M8 7.5h1M11 7.5h1M8 11h1M11 11h1M8 14.5h1M11 14.5h1" />
    </>
  ),
  offer: (
    <>
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5Z" />
      <path d="M14.5 9a3.2 3.2 0 1 0 0 6M8 11h5M8 13.2h5" />
    </>
  ),
  // E5: a purse with a coin, for an event's budget.
  budget: (
    <>
      <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6H18a2 2 0 0 1 2 2v9.5a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5Z" />
      <path d="M6.5 6 15 3.5a1.5 1.5 0 0 1 2 1.4V6" />
      <path d="M20 11h-4a2 2 0 0 0 0 4h4" />
      <circle cx="16.2" cy="13" r=".6" />
    </>
  ),
  scale: (
    <>
      <path d="M12 4v16M7 20h10M5 7h14" />
      <path d="m5 7-2.5 6a3 3 0 0 0 5 0Zm14 0-2.5 6a3 3 0 0 0 5 0Z" />
    </>
  ),
  // A shed with a roller door: where material is kept.
  warehouse: (
    <>
      <path d="M3 20.5V9.5L12 4l9 5.5v11" />
      <path d="M6.5 20.5v-8h11v8M6.5 15h11M6.5 17.8h11" />
    </>
  ),
  // A sheet with a folded corner.
  note: (
    <>
      <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3h11A1.5 1.5 0 0 1 19 4.5V15l-5 5.5H6.5A1.5 1.5 0 0 1 5 19Z" />
      <path d="M19 15h-3.5a1.5 1.5 0 0 0-1.5 1.5v4M8.5 8h7M8.5 11.5h5" />
    </>
  ),
  // A signpost: a direction was chosen.
  decision: (
    <>
      <path d="M12 21v-9M12 6V3" />
      <path d="M5 6h12l2.5 3L17 12H5Z" />
    </>
  ),
  question: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.6M12 16.8h.01" />
    </>
  ),
  idea: (
    <>
      <path d="M9 17.5h6M10 20.5h4" />
      <path d="M12 3.5a5.5 5.5 0 0 0-3.2 10c.5.4.7 1 .7 1.6v.4h5v-.4c0-.6.3-1.2.8-1.6A5.5 5.5 0 0 0 12 3.5Z" />
    </>
  ),
  // A clock with an arrow running back: what happened before.
  history: (
    <>
      <path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5" />
      <path d="M4 4v4.5h4.5M12 8v4.2l3 1.8" />
    </>
  ),
  // «Empezar»: a task starts now.
  play: (
    <path d="M8 5.5v13a1 1 0 0 0 1.5.9l10-6.5a1 1 0 0 0 0-1.7l-10-6.5A1 1 0 0 0 8 5.5Z" />
  ),
  print: (
    <>
      <path d="M7 8.5V4h10v4.5" />
      <rect x="3.5" y="8.5" width="17" height="8" rx="2" />
      <path d="M7 14h10v6H7Z" />
    </>
  ),
  send: (
    <>
      <path d="M20.5 3.5 10 14" />
      <path d="m20.5 3.5-6.5 17-4-6.5-6.5-4Z" />
    </>
  ),
  // A clipboard with lines: a work order.
  order: (
    <>
      <path d="M9 4.5H6.5A1.5 1.5 0 0 0 5 6v13.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H15" />
      <rect x="9" y="3" width="6" height="3" rx="1" />
      <path d="M8.5 11h7M8.5 14.5h7M8.5 18h4" />
    </>
  ),
  // «Hacer foto»: a camera body with its lens.
  camera: (
    <>
      <path d="M3.5 9A1.5 1.5 0 0 1 5 7.5h2.5L9 5h6l1.5 2.5H19A1.5 1.5 0 0 1 20.5 9v9a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18Z" />
      <circle cx="12" cy="13.2" r="3.4" />
    </>
  ),
  // Material categories, for a resource without a photo.
  // A marquee: peaked roof on four posts, open front.
  tent: (
    <>
      <path d="M2.5 11 12 4.5l9.5 6.5M3 11h18" />
      <path d="M5 11v9M19 11v9M3 20h18M10 20v-4.5h4V20" />
    </>
  ),
  // A crowd barrier: two feet, rails and bars.
  fence: (
    <>
      <path d="M5 5.5v14M19 5.5v14M3 19.5h4M17 19.5h4" />
      <path d="M5 8h14M5 15h14M9.5 8v7M14.5 8v7" />
    </>
  ),
  table: (
    <>
      <rect x="3" y="7" width="18" height="3" rx="1" />
      <path d="M5.5 10v10M18.5 10v10M5.5 14.5h13" />
    </>
  ),
  chair: <path d="M7 3.5v17M7 12.5h10v8M7 7h6.5" />,
  // A stage: platform under a curtained frame.
  stage: (
    <>
      <path d="M2.5 14h19v6h-19Z" />
      <path d="M4.5 14V4h15v10M4.5 4c2 3.2 4.3 4.5 7.5 4.5S17.5 7.2 19.5 4" />
    </>
  ),
  bolt: <path d="M13 2.5 5 13.5h6l-1 8 8-11h-6Z" />,
  speaker: (
    <>
      <rect x="6" y="3" width="12" height="18" rx="2" />
      <circle cx="12" cy="14" r="3.5" />
      <path d="M12 7h.01" />
    </>
  ),
  // A sign board on a post.
  sign: (
    <>
      <rect x="4" y="3.5" width="16" height="9.5" rx="1.5" />
      <path d="M12 13v8M8.5 21h7M8 8.2h8" />
    </>
  ),
};

export interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  /** Accessible label; without it the icon is decorative. */
  label?: string;
}

export const Icon: React.FC<IconProps> = ({
  name,
  size = 20,
  className,
  label,
}) => (
  <svg
    className={['lx-icon', className].filter(Boolean).join(' ')}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    role={label ? 'img' : undefined}
    aria-label={label}
    aria-hidden={label ? undefined : true}
    focusable="false"
  >
    {PATHS[name]}
  </svg>
);

/**
 * OxEye symbol, drawn with palette variables. On a tile by default; at
 * 20 px or less it drops the tile (the fine swirl would vanish inside it).
 */
export const EyeMark: React.FC<{
  size?: number;
  className?: string;
  variant?: 'tile' | 'glyph';
}> = ({size = 36, className, variant}) => (
  <BrandSymbol
    size={size}
    variant={variant ?? (size <= 20 ? 'glyph' : 'tile')}
    className={['lx-eyemark', className].filter(Boolean).join(' ')}
  />
);

/**
 * Faint contour-line texture (cartographic isolines) for the sidebar and
 * header. Purely decorative.
 */
export const ContourTexture: React.FC<{className?: string}> = ({className}) => (
  <svg
    className={['lx-contours', className].filter(Boolean).join(' ')}
    viewBox="0 0 400 300"
    preserveAspectRatio="xMidYMid slice"
    aria-hidden="true"
    focusable="false"
  >
    <g fill="none" stroke="currentColor" strokeWidth="1">
      <path d="M318 58c34 6 58 34 52 66s-44 52-82 46-60-38-52-70 48-48 82-42Z" />
      <path d="M314 34c50 6 88 46 80 96s-66 78-120 70-92-56-80-104 70-68 120-62Z" />
      <path d="M306 8c66 8 120 62 108 128s-90 104-160 92-124-76-106-138S240 0 306 8Z" />
      <path d="M296-18c80 10 150 78 134 160s-112 132-200 116S74 166 96 88 216-28 296-18Z" />
      <path d="M326 84c14 3 24 16 21 30s-19 22-34 19-24-16-21-30 20-22 34-19Z" />
      <path d="M60 236c26-10 58-2 70 20s-2 46-30 54-58-4-66-28 0-36 26-46Z" />
      <path d="M44 210c40-16 88-4 106 30s-4 72-48 84-90-6-102-42 4-56 44-72Z" />
      <path d="M26 182c54-22 120-6 144 40s-6 98-64 114S-14 330-30 282s2-78 56-100Z" />
      <path d="M-20 120c60-30 160-20 220 10s120 10 220-30" />
      <path d="M-20 96c70-34 170-24 230 6s120 6 210-34" />
    </g>
  </svg>
);
