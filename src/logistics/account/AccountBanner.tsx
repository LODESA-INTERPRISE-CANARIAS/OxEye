/**
 * Banners at the top of every screen of the workspace (Revisión 1 · E4):
 * - a support session or «Ver como Invitado» in progress: whose account,
 *   who opened it and why, the time left and «Terminar» (back to the
 *   administrator's own session);
 * - a provisional password: what it holds back and «Cambiar contraseña».
 *   Shown at every sign-in until the password is changed; «Ahora no» hides
 *   it for this session only.
 */
import React, {useEffect, useState} from 'react';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Button, Icon} from '../ui';
import {countdown, secondsLeft} from './access';
import {useAccountUi} from './accountUi';
import {useAccess} from './useAccess';

/** Sessions (tokens) whose provisional banner was put off. */
const putOff = new Set<string>();

export const AccountBanner: React.FC = () => {
  const user = useLogisticsStore(s => s.session?.user ?? null);
  const token = useLogisticsStore(s => s.session?.token ?? null);
  const supportReturn = useLogisticsStore(s => s.supportReturn);
  const endSupport = useLogisticsStore(s => s.endSupport);
  const logout = useLogisticsStore(s => s.logout);
  const openPasswordChange = useAccountUi(s => s.openPasswordChange);
  const shared = useAccess().shared;
  const [, setHidden] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [ending, setEnding] = useState(false);
  const support = user?.support ?? null;

  useEffect(() => {
    if (!support) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [support]);

  // This device's deadline when known (`beginSupport`), else the server's.
  const endsAt = supportReturn?.endsAt ?? support?.endsAt ?? null;
  const left = endsAt ? secondsLeft(endsAt, now) : 0;

  // Time is up: go back now rather than waiting for the next 401.
  useEffect(() => {
    if (support && left === 0 && supportReturn && !ending) {
      setEnding(true);
      void endSupport().finally(() => setEnding(false));
    }
  }, [support, left, supportReturn, ending, endSupport]);

  if (!user) return null;

  if (support) {
    const guest = support.kind === 'view_as_guest';
    return (
      <div
        className="lx-acct-banner lx-acct-banner--support"
        id="lx-support-banner"
        role="region"
        aria-label={guest ? 'Vista como Invitado' : 'Sesión de soporte'}
      >
        <Icon name={guest ? 'eye' : 'user'} size={20} />
        <p className="lx-acct-banner__text">
          {guest ? (
            <>
              <strong>Estás viendo el Gestor como Invitado.</strong> Lo mismo
              que ve quien entra con ese usuario: solo lectura, sin Contactos ni
              Catálogo.
            </>
          ) : (
            <>
              <strong>
                Sesión de soporte en la cuenta de {user.displayName}.
              </strong>{' '}
              Abierta por {support.by.displayName}
              {support.reason ? <> · Motivo: «{support.reason}»</> : null}.
              Queda registrada en su historial de seguridad.
            </>
          )}
        </p>
        <span
          className="lx-acct-banner__time lx-num"
          id="lx-support-left"
          aria-label={`Quedan ${Math.ceil(left / 60)} minutos`}
        >
          <Icon name="clock" size={16} /> {countdown(left)}
        </span>
        <Button
          size="sm"
          variant="secondary"
          id="lx-support-end"
          busy={ending}
          onClick={() => {
            setEnding(true);
            // Without the own session at hand (another tab), signing out
            // of this one ends it on the server too.
            void (supportReturn ? endSupport() : logout()).finally(() =>
              setEnding(false),
            );
          }}
        >
          Terminar
        </Button>
      </div>
    );
  }

  // A shared account (Equipo) is never asked: one person following the
  // prompt on the field would lock the whole team out.
  if (
    user.passwordProvisional === true &&
    !shared &&
    token &&
    !putOff.has(token)
  ) {
    return (
      <div
        className="lx-acct-banner lx-acct-banner--provisional"
        id="lx-provisional-banner"
        role="region"
        aria-label="Contraseña provisional"
      >
        <Icon name="lock" size={20} />
        <p className="lx-acct-banner__text">
          <strong>Tu contraseña es provisional.</strong> Puedes trabajar con
          normalidad; solo lo sensible (presupuestos, aprobaciones, usuarios)
          espera a que elijas una tuya.
        </p>
        <Button
          size="sm"
          variant="primary"
          id="lx-provisional-change"
          onClick={openPasswordChange}
        >
          Cambiar contraseña
        </Button>
        <Button
          size="sm"
          variant="ghost"
          id="lx-provisional-later"
          onClick={() => {
            putOff.add(token);
            setHidden(n => n + 1);
          }}
        >
          Ahora no
        </Button>
      </div>
    );
  }
  return null;
};
