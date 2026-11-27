/**
 * Logistics Manager shell: sidebar on desktop/tablet (≥ 900 px), compact top
 * bar, bottom tab bar and floating «+ Añadir» on phones. Both layouts are
 * rendered and switched in CSS, so resizing never loses state.
 */
import React, {useCallback, useRef, useState} from 'react';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {AddMenu, type AddOption} from './AddMenu';
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
import {roleSummary} from '../account/access';
import {AccountBanner} from '../account/AccountBanner';
import {PhoneAccountActions, SidebarAccount} from '../account/AccountEntry';
import {useAccess} from '../account/useAccess';
import {UserAvatar} from '../account/UserAvatar';
import {OrganizationSheet} from './OrganizationSheet';
import {OrgSelector} from './OrgSelector';
import {
  MAIN_SPACES,
  neighbourSpace,
  PHONE_TABS,
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
  /** What «+ Añadir» offers (desktop button and phone floating button). */
  addOptions: AddOption[];
  /** Opens the universal search. */
  onSearch: () => void;
  /** Disables the swipe between spaces (e.g. inside the day timeline). */
  swipeLocked?: boolean;
  onExit: () => void;
  /** «Maquetas»: given only in development builds. */
  onMockups?: () => void;
  children: React.ReactNode;
}

export const Shell: React.FC<ShellProps> = ({
  space,
  onSpace,
  direction,
  title,
  subtitle,
  canWrite,
  addOptions,
  onSearch,
  swipeLocked = false,
  onExit,
  onMockups,
  children,
}) => {
  const session = useLogisticsStore(s => s.session);
  const logout = useLogisticsStore(s => s.logout);
  const [accountOpen, setAccountOpen] = useState(false);
  const [orgOpen, setOrgOpen] = useState(false);
  const contentRef = useRef<HTMLElement>(null);
  const user = session?.user;
  const access = useAccess();
  const roleLabel = roleSummary(access);

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
  useSpaceSwipe(contentRef, {canGo, onSwipe, enabled: !swipeLocked});

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
            <span>Ox Eye</span>
          </div>
        </div>
        <OrgSelector onOpen={() => setOrgOpen(true)} />
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
        {onMockups && (
          <>
            <p className="lx-sidebar__group">Desarrollo</p>
            <button
              type="button"
              id="lx-nav-maquetas"
              className="lx-sidenav__item"
              onClick={onMockups}
            >
              <Icon name="flask" size={20} />
              <span>Maquetas</span>
            </button>
          </>
        )}
        <div className="lx-sidebar__spacer" />
        <SidebarAccount />
        <button
          type="button"
          id="lx-back-to-oxeye"
          className="lx-sidenav__item lx-sidenav__item--exit"
          onClick={onExit}
        >
          <Icon name="back" size={20} />
          <span>Volver a Ox Eye</span>
        </button>
      </aside>

      <div className="lx-main">
        {/* E4: the banners stay in view on every screen, under the phone bar. */}
        <div className="lx-mainbar">
          <div className="lx-topbar">
            <EyeMark size={32} />
            <span className="lx-topbar__title">Gestor logístico</span>
            <SyncChip compact id="lx-sync-chip-phone" />
            <button
              type="button"
              id="lx-search-phone"
              className="lx-iconbtn lx-iconbtn--secondary"
              aria-label="Buscar"
              title="Buscar"
              aria-haspopup="dialog"
              onClick={onSearch}
            >
              <Icon name="search" size={20} />
            </button>
            <button
              type="button"
              id="lx-account-button"
              className="lx-avatar-button"
              aria-label={`Menú de ${user?.displayName ?? 'usuario'}`}
              aria-haspopup="dialog"
              onClick={() => setAccountOpen(true)}
            >
              {user ? (
                <UserAvatar
                  name={user.displayName}
                  avatarId={user.avatarId}
                  accent={user.accent}
                />
              ) : (
                <Icon name="user" size={18} />
              )}
            </button>
          </div>
          <AccountBanner />
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
            <button
              type="button"
              id="lx-search"
              className="lx-searchbtn lx-desktop-only"
              aria-haspopup="dialog"
              aria-keyshortcuts="/ Control+K"
              onClick={onSearch}
            >
              <Icon name="search" size={18} />
              <span className="lx-searchbtn__label">Buscar</span>
              <kbd className="lx-searchbtn__key" aria-hidden="true">
                /
              </kbd>
            </button>
            <span className="lx-desktop-only">
              <SyncChip />
            </span>
            {readOnlyChip}
            {canWrite && (
              <AddMenu
                id="lx-add"
                className="lx-desktop-only"
                options={addOptions}
              />
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
        items={PHONE_TABS}
        active={space as MainSpace}
        onSelect={onSpace}
        label="Espacios"
        idPrefix="lx-tab"
      />

      {canWrite && (
        <AddMenu
          id="lx-fab"
          size="lg"
          className="lx-fab"
          placement="above"
          options={addOptions}
        />
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
          <PhoneAccountActions onDone={() => setAccountOpen(false)} />
          <OrgSelector
            id="lx-org-select-phone"
            onOpen={() => setOrgOpen(true)}
          />
          <SyncChip id="lx-sync-chip-account" />
          <Button
            block
            size="lg"
            icon="dayClose"
            id="lx-account-cierre"
            onClick={() => {
              setAccountOpen(false);
              onSpace('cierre');
            }}
          >
            Cierre de jornada
          </Button>
          {/* No tab on phones (`PHONE_TABS`): offers are desk work. E4:
              only for those who may read it. */}
          {access.can('directory.read') && (
            <Button
              block
              size="lg"
              icon="catalog"
              id="lx-account-catalogo"
              aria-current={space === 'catalogo' ? 'page' : undefined}
              onClick={() => {
                setAccountOpen(false);
                onSpace('catalogo');
              }}
            >
              Catálogo
            </Button>
          )}
          {onMockups && (
            <Button
              block
              size="lg"
              variant="ghost"
              icon="flask"
              id="lx-account-maquetas"
              onClick={() => {
                setAccountOpen(false);
                onMockups();
              }}
            >
              Maquetas (desarrollo)
            </Button>
          )}
          <Button block size="lg" icon="back" onClick={onExit}>
            Volver a Ox Eye
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

      <OrganizationSheet open={orgOpen} onClose={() => setOrgOpen(false)} />
    </>
  );
};
