/**
 * Account sheets over the workspace (Revisión 1 · E4), mounted once by
 * `LogisticsApp` while signed in: the first-login welcome, «Tu espacio en
 * OxEye», «Usuarios», and an account link opened inside a session.
 */
import React, {useEffect, useState, useSyncExternalStore} from 'react';
import {UsersSheet} from '../admin/UsersSheet';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Sheet} from '../ui';
import {ownsAccountSpace} from './access';
import {AccountLinkPanel} from './AccountLinkPanel';
import {useAccountUi} from './accountUi';
import {
  clearAccountLink,
  pendingAccountLink,
  subscribeAccountLink,
} from './links';
import {ProfileSheet} from './ProfileSheet';
import {useAccess} from './useAccess';
import {WelcomeSheet} from './WelcomeSheet';

/** On the login screen after a reset link used inside a session. */
const RESET_SIGNED_OUT =
  'Contraseña cambiada. Se han cerrado todas las sesiones de la cuenta, también esta: entra con la contraseña nueva.';

export const AccountLayer: React.FC = () => {
  const user = useLogisticsStore(s => s.session?.user ?? null);
  const logout = useLogisticsStore(s => s.logout);
  const access = useAccess();
  const view = useAccountUi(s => s.view);
  const seq = useAccountUi(s => s.seq);
  const close = useAccountUi(s => s.close);
  const link = useSyncExternalStore(subscribeAccountLink, pendingAccountLink);
  // «Ahora no» on the welcome: again at the next sign-in, not now.
  const [welcomeLater, setWelcomeLater] = useState<string | null>(null);
  const own = ownsAccountSpace(access);
  const userId = user?.id ?? null;

  // Another account (sign-out, support session): nothing stays open.
  useEffect(() => {
    close();
  }, [userId, close]);

  if (!user) return null;

  if (link) {
    return (
      <Sheet
        open
        onClose={clearAccountLink}
        title={
          link.purpose === 'reset'
            ? 'Elige una contraseña nueva'
            : 'Correo de recuperación'
        }
        eyebrow="Enlace de tu cuenta"
        size="sm"
        id="lx-account-link-sheet"
      >
        <AccountLinkPanel
          link={link}
          headingLevel={2}
          hideTitle
          onDone={clearAccountLink}
          onResetDone={() => {
            clearAccountLink();
            void logout({notice: RESET_SIGNED_OUT});
          }}
        />
      </Sheet>
    );
  }

  // `=== false`: a server before E4 sends nothing, which is no welcome.
  if (own && user.welcomed === false && welcomeLater !== user.id) {
    return <WelcomeSheet onClose={() => setWelcomeLater(user.id)} />;
  }

  if (view?.kind === 'profile' && own) {
    return (
      <ProfileSheet
        key={seq}
        tab={view.tab}
        focus={view.focus}
        onClose={close}
      />
    );
  }
  if (view?.kind === 'users' && !access.support) {
    return <UsersSheet key={seq} onClose={close} />;
  }
  return null;
};
