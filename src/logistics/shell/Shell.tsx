/**
 * Logistics Manager shell: sidebar on desktop/tablet (≥ 900 px), compact top
 * bar, bottom tab bar and floating «+ Añadir» on phones. Both layouts are
 * rendered and switched in CSS, so resizing never loses state.
 */
import React, {useCallback, useRef, useState} from 'react';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {
  Button,
  Chip,
  ContourTexture,
  EyeMark,
  HelpTip,
  Icon,
  Sheet,
  SidebarNav,
  TabBar,
} from '../ui';
import {initials} from '../lib/format';
import {OrgSelector} from './OrgSelector';
import {
  MAIN_SPACES,
  neighbourSpace,
  type MainSpace,
  type Space,
} from './spaces';
import {SyncChip} from './SyncChip';
import {useSpaceSwipe} from './useSpaceSwipe';

export const EYEBROW = 'San Cristóbal de La Laguna · 28°29′ N 16°19′ O';

const READ_ONLY_HELP =
  'Has entrado como Invitado: puedes consultar todo, pero no crear ni cambiar datos. Para registrar información, entra con tu usuario.';

export interface ShellProps {
  space: Space;
  onSpace: (space: Space) => void;
  /** Direction of the last change, for the entry animation. */
  direction: 1 | -1 | 0;
  title: React.ReactNode;
  subtitle: React.ReactNode;
  canWrite: boolean;
  onAdd: () => void;
  onExit: () => void;
  children: React.ReactNode;
}

export const Shell: React.FC<ShellProps> = ({
  space,
  onSpace,
  direction,
  title,
  subtitle,
  canWrite,
  onAdd,
  onExit,
  children,
}) => {
  const session = useLogisticsStore(s => s.session);
  const logout = useLogisticsStore(s => s.logout);
  const [accountOpen, setAccountOpen] = useState(false);
  const contentRef = useRef<HTMLElement>(null);
  const user = session?.user;
  const roleLabel =
    user?.role === 'guest' ? 'Invitado · solo lectura' : 'Equipo';

  const canGo = useCallback(
    (step: 1 | -1) => neighbourSpace(space, step) !== null,
    [space],
  );
  const onSwipe = useCallback(
    (step: 1 | -1) => {
      const next = neighbourSpace(space, step);
      if (next) onSpace(next);
    },
    [space, onSpace],
  );
  useSpaceSwipe(contentRef, {canGo, onSwipe});

  const readOnlyChip = !canWrite && (
    <span className="lx-readonly" id="lx-readonly">
      <Chip tag tone="neutral" size="sm">
        <Icon name="lock" size={13} /> Solo lectura
      </Chip>
      <HelpTip label="solo lectura">{READ_ONLY_HELP}</HelpTip>
    </span>
  );

  return (
    <>
      <a className="lx-skip" href="#lx-main">
        Saltar al contenido
      </a>

      <aside className="lx-sidebar" aria-label="Gestor logístico">
        <ContourTexture />
        <div className="lx-brand">
          <EyeMark size={38} />
          <div className="lx-brand__text">
            <strong>Gestor logístico</strong>
            <span>OxEye · Ojo de Buey</span>
          </div>
        </div>
        <OrgSelector />
        <p className="lx-sidebar__group">Espacios</p>
        <SidebarNav<MainSpace>
          items={MAIN_SPACES}
          active={space as MainSpace}
          onSelect={onSpace}
          label="Espacios"
          idPrefix="lx-nav"
        />
        <p className="lx-sidebar__group">Jornada</p>
        <button
          type="button"
          id="lx-nav-cierre"
          className="lx-sidenav__item"
          aria-current={space === 'cierre' ? 'page' : undefined}
          onClick={() => onSpace('cierre')}
        >
          <Icon name="dayClose" size={20} />
          <span>Cierre de jornada</span>
        </button>
        <div className="lx-sidebar__spacer" />
        {user && (
          <div className="lx-user" id="lx-user">
            <span className="lx-avatar" aria-hidden="true">
              {initials(user.displayName)}
            </span>
            <span className="lx-user__text">
              <strong>{user.displayName}</strong>
              <span>{roleLabel}</span>
            </span>
            <button
              type="button"
              id="lx-logout"
              className="lx-iconbtn lx-iconbtn--ghost"
              aria-label="Cerrar sesión"
              title="Cerrar sesión"
              onClick={() => void logout()}
            >
              <Icon name="logout" size={20} />
            </button>
          </div>
        )}
        <button
          type="button"
          id="lx-back-to-oxeye"
          className="lx-sidenav__item lx-sidenav__item--exit"
          onClick={onExit}
        >
          <Icon name="back" size={20} />
          <span>Volver a OxEye</span>
        </button>
      </aside>

      <div className="lx-main">
        <div className="lx-topbar">
          <EyeMark size={32} />
          <span className="lx-topbar__title">Gestor logístico</span>
          <SyncChip compact id="lx-sync-chip-phone" />
          <button
            type="button"
            id="lx-account-button"
            className="lx-avatar lx-avatar--button"
            aria-label={`Menú de ${user?.displayName ?? 'usuario'}`}
            aria-haspopup="dialog"
            onClick={() => setAccountOpen(true)}
          >
            {user ? initials(user.displayName) : <Icon name="user" size={18} />}
          </button>
        </div>

        <header className="lx-header">
          <ContourTexture />
          <div className="lx-header__text">
            <p className="lx-eyebrow">{EYEBROW}</p>
            <h1 className="lx-header__title" id="lx-title">
              {title}
            </h1>
            <p className="lx-header__subtitle">{subtitle}</p>
          </div>
          <div className="lx-header__actions">
            <span className="lx-desktop-only">
              <SyncChip />
            </span>
            {readOnlyChip}
            {canWrite && (
              <Button
                variant="primary"
                icon="plus"
                id="lx-add"
                className="lx-desktop-only"
                onClick={onAdd}
              >
                Añadir
              </Button>
            )}
          </div>
        </header>

        <main
          id="lx-main"
          ref={contentRef}
          className="lx-content"
          tabIndex={-1}
          aria-labelledby="lx-title"
        >
          <div
            key={space}
            className={`lx-space lx-space--enter${
              direction === 1 ? '-next' : direction === -1 ? '-prev' : ''
            }`}
            data-space={space}
          >
            {children}
          </div>
        </main>
      </div>

      <TabBar<MainSpace>
        items={MAIN_SPACES}
        active={space as MainSpace}
        onSelect={onSpace}
        label="Espacios"
        idPrefix="lx-tab"
      />

      {canWrite && (
        <Button
          variant="primary"
          size="lg"
          icon="plus"
          id="lx-fab"
          className="lx-fab"
          onClick={onAdd}
        >
          Añadir
        </Button>
      )}

      <Sheet
        open={accountOpen}
        onClose={() => setAccountOpen(false)}
        title={user?.displayName ?? 'Tu cuenta'}
        eyebrow="Tu cuenta"
        meta={<span className="lx-muted">{roleLabel}</span>}
        size="sm"
        id="lx-account-sheet"
      >
        <div className="lx-account">
          <OrgSelector id="lx-org-select-phone" />
          <SyncChip id="lx-sync-chip-account" />
          <Button
            block
            size="lg"
            icon="dayClose"
            onClick={() => {
              setAccountOpen(false);
              onSpace('cierre');
            }}
          >
            Cierre de jornada
          </Button>
          <Button block size="lg" icon="back" onClick={onExit}>
            Volver a OxEye
          </Button>
          <Button
            block
            size="lg"
            variant="ghost"
            icon="logout"
            id="lx-logout-phone"
            onClick={() => {
              setAccountOpen(false);
              void logout();
            }}
          >
            Cerrar sesión
          </Button>
        </div>
      </Sheet>
    </>
  );
};
