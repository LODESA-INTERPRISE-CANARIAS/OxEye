/**
 * Entry points to the own account and to «Usuarios» (Revisión 1 · E4):
 * the user block at the foot of the sidebar and the buttons of the phone
 * account sheet. Guests and support sessions have no account space.
 */
import React from 'react';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Button, Icon} from '../ui';
import {offersUsers, ownsAccountSpace, roleSummary} from './access';
import {useAccountUi} from './accountUi';
import {useAccess} from './useAccess';
import {UserAvatar} from './UserAvatar';

/** Sidebar: who is signed in (opens «Tu espacio»), «Usuarios», sign out. */
export const SidebarAccount: React.FC = () => {
  const user = useLogisticsStore(s => s.session?.user ?? null);
  const logout = useLogisticsStore(s => s.logout);
  const access = useAccess();
  const openProfile = useAccountUi(s => s.openProfile);
  const openUsers = useAccountUi(s => s.openUsers);
  if (!user) return null;
  const own = ownsAccountSpace(access);
  const who = (
    <>
      <UserAvatar
        name={user.displayName}
        avatarId={user.avatarId}
        accent={user.accent}
      />
      <span className="lx-user__text">
        <strong>{user.displayName}</strong>
        <span id="lx-user-role">{roleSummary(access)}</span>
      </span>
    </>
  );
  return (
    <div className="lx-user-block">
      {offersUsers(access) && (
        <button
          type="button"
          id="lx-nav-usuarios"
          className="lx-sidenav__item"
          onClick={() => openUsers()}
        >
          <Icon name="contacts" size={20} />
          <span>Usuarios</span>
          {!access.can('users.manage') && <Icon name="lock" size={16} />}
        </button>
      )}
      <div className="lx-user" id="lx-user">
        {own ? (
          <button
            type="button"
            className="lx-user__open"
            id="lx-user-open"
            aria-label={`Tu espacio en OxEye: ${user.displayName}`}
            title="Tu espacio en OxEye"
            onClick={() => openProfile()}
          >
            {who}
          </button>
        ) : (
          <span className="lx-user__open">{who}</span>
        )}
        <button
          type="button"
          id="lx-logout"
          className="lx-iconbtn lx-iconbtn--ghost"
          aria-label={access.support ? 'Terminar la sesión' : 'Cerrar sesión'}
          title={access.support ? 'Terminar la sesión' : 'Cerrar sesión'}
          onClick={() => void logout()}
        >
          <Icon name="logout" size={20} />
        </button>
      </div>
    </div>
  );
};

/** Phone account sheet: «Tu espacio» and «Usuarios». */
export const PhoneAccountActions: React.FC<{onDone: () => void}> = ({
  onDone,
}) => {
  const access = useAccess();
  const openProfile = useAccountUi(s => s.openProfile);
  const openUsers = useAccountUi(s => s.openUsers);
  const own = ownsAccountSpace(access);
  const users = offersUsers(access);
  if (!own && !users) return null;
  return (
    <>
      {own && (
        <Button
          block
          size="lg"
          variant="primary"
          icon="user"
          id="lx-account-profile"
          onClick={() => {
            onDone();
            openProfile();
          }}
        >
          Tu espacio en OxEye
        </Button>
      )}
      {users && (
        <Button
          block
          size="lg"
          icon="contacts"
          id="lx-account-usuarios"
          onClick={() => {
            onDone();
            openUsers();
          }}
        >
          Usuarios
        </Button>
      )}
    </>
  );
};
