/**
 * Navigable mock-ups for Yeray's two features (Revisión 1): the supplier
 * offer form with its admin panel (F1) and personal access with profiles and
 * the users panel (F2). Development builds only, fictitious data, no server.
 *
 * Contract with LogisticsApp: default export, rendered lazily for
 * `#logistica/maquetas` when `import.meta.env.DEV`; `onExit` returns to the
 * Gestor.
 *
 * State lives in React only: nothing is stored, sent or fetched. A ribbon on
 * every screen says so, leads back to the index and switches the palette
 * (restored when leaving) so every screen can be judged in all six.
 */
import React, {useEffect, useRef, useState} from 'react';
import {
  applyPalette,
  COLOR_PALETTES,
  normalizePaletteId,
} from '../../data/palettes';
import type {PaletteId} from '../../types';
import '../../styles/logistics/index.css';
import '../../styles/logistics/mockups.css';
import {Chip, Icon, SelectField} from '../ui';
import {LoginMock} from './access/LoginMock';
import {meFor, type Me} from './access/me';
import {ProfileMock, type ProfileTab} from './access/ProfileMock';
import {RecoveryMock} from './access/RecoveryMock';
import {UsersAdmin, type UsersView} from './access/UsersAdmin';
import {WelcomeMock} from './access/WelcomeMock';
import {MockToasts} from './kit';
import {MockIndex, type IndexEntry} from './MockIndex';
import {OffersAdmin, type OffersView} from './offers/OffersAdmin';
import {SupplierForm, type SupplierMode} from './offers/SupplierForm';

export interface MockupsAppProps {
  onExit: () => void;
}

type Screen =
  | {id: 'index'}
  | {id: 'supplier'; mode: SupplierMode}
  | {id: 'offers'; view: OffersView}
  | {id: 'login'; notice?: string}
  | {id: 'recovery'}
  | {id: 'welcome'}
  | {id: 'profile'; tab?: ProfileTab}
  | {id: 'users'; view: UsersView};

const SCREEN_NAME: Record<Screen['id'], string> = {
  index: 'Índice',
  supplier: 'F1 · Formulario del proveedor',
  offers: 'F1 · Panel de ofertas',
  login: 'F2 · Inicio de sesión',
  recovery: 'F2 · Recuperar contraseña',
  welcome: 'F2 · Bienvenida',
  profile: 'F2 · Perfil',
  users: 'F2 · Usuarios',
};

function currentPalette(): PaletteId {
  return normalizePaletteId(document.documentElement.dataset.palette);
}

const MockupsApp: React.FC<MockupsAppProps> = ({onExit}) => {
  const [screen, setScreenState] = useState<Screen>({id: 'index'});
  const [seq, setSeq] = useState(0);
  const [me, setMeState] = useState<Me>(() => meFor('Yeray'));
  const original = useRef<PaletteId>(currentPalette());
  const [palette, setPaletteState] = useState<PaletteId>(original.current);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const initial = original.current;
    return () => applyPalette(initial);
  }, []);

  const setPalette = (id: PaletteId) => {
    setPaletteState(id);
    applyPalette(id);
  };
  const go = (next: Screen) => {
    setScreenState(next);
    setSeq(s => s + 1);
    rootRef.current?.focus({preventScroll: true});
  };
  const setMe = (patch: Partial<Me>) => setMeState(m => ({...m, ...patch}));
  const toIndex = () => go({id: 'index'});

  const f1: IndexEntry[] = [
    {
      id: 'supplier-request',
      title: 'El proveedor responde a una solicitud',
      text: '«3 carpas de 6 × 6 m · 4 jornadas · 11–14 dic» ya rellenado; contesta solo lo suyo.',
      who: 'Proveedor · móvil',
      icon: 'phone',
      go: () => go({id: 'supplier', mode: 'request'}),
    },
    {
      id: 'supplier-open',
      title: 'Una empresa nueva presenta su oferta',
      text: 'Elige sus actividades y añade varios productos en la misma oferta.',
      who: 'Proveedor · móvil',
      icon: 'tag',
      go: () => go({id: 'supplier', mode: 'open'}),
    },
    {
      id: 'requests',
      title: 'Pedir presupuesto desde el catálogo',
      text: 'Necesidad, cantidad y jornadas; una o varias empresas; enviar desde tu correo.',
      who: 'Equipo',
      icon: 'send',
      go: () => go({id: 'offers', view: 'requests'}),
    },
    {
      id: 'inbox',
      title: 'Recibidas: aprobar o rechazar',
      text: 'Pendientes, aprobadas y rechazadas. Solo los administradores deciden.',
      who: 'Administrador',
      icon: 'mail',
      go: () => go({id: 'offers', view: 'inbox'}),
    },
    {
      id: 'compare',
      title: 'Comparar por coste total',
      text: 'Cantidad × jornadas + extras + impuesto, con medallas y desglose.',
      who: 'Equipo',
      icon: 'scale',
      go: () => go({id: 'offers', view: 'compare'}),
    },
    {
      id: 'renewals',
      title: 'Renovar antes de que caduque',
      text: 'Tareas «Generada por Ox Eye» con aviso configurable; historial de caducadas.',
      who: 'Administrador',
      icon: 'refresh',
      go: () => go({id: 'offers', view: 'renewals'}),
    },
    {
      id: 'supplier-manual',
      title: 'Registrar una oferta a mano',
      text: 'Las mismas preguntas, rellenadas por nosotros tras una llamada.',
      who: 'Equipo',
      icon: 'edit',
      go: () => go({id: 'supplier', mode: 'manual'}),
    },
    {
      id: 'supplier-expired',
      title: 'Enlace caducado',
      text: 'Lo que ve una empresa que abre un enlace vencido.',
      who: 'Proveedor · móvil',
      icon: 'clock',
      go: () => go({id: 'supplier', mode: 'expired'}),
    },
  ];

  const f2: IndexEntry[] = [
    {
      id: 'login',
      title: 'Entrar con usuario y contraseña',
      text: 'Sin lista de personas; el error no dice si el usuario existe.',
      who: 'Cada persona',
      icon: 'user',
      go: () => go({id: 'login'}),
    },
    {
      id: 'welcome',
      title: 'Bienvenida del primer inicio',
      text: 'Mantener la contraseña provisional o elegir una propia; preparar el perfil.',
      who: 'Cada persona',
      icon: 'eye',
      go: () => {
        setMeState(meFor('Yeray'));
        go({id: 'welcome'});
      },
    },
    {
      id: 'profile',
      title: 'Tu espacio en Ox Eye',
      text: 'Foto, nombre, descripción, apariencia, correo de recuperación y actividad.',
      who: 'Cada persona',
      icon: 'contacts',
      go: () => go({id: 'profile', tab: 'perfil'}),
    },
    {
      id: 'security',
      title: 'Contraseña, sesiones e historial',
      text: 'Cambiar la contraseña, cerrar sesiones y ver quién ha entrado en tu cuenta.',
      who: 'Cada persona',
      icon: 'lock',
      go: () => go({id: 'profile', tab: 'seguridad'}),
    },
    {
      id: 'recovery',
      title: 'Recuperar la contraseña',
      text: 'Usuario → aviso neutro → correo con enlace → contraseña nueva.',
      who: 'Cada persona',
      icon: 'mail',
      go: () => go({id: 'recovery'}),
    },
    {
      id: 'users',
      title: 'Usuarios y sesión de soporte',
      text: 'Roles, contraseña provisional, «Ver como Invitado» y soporte con aviso.',
      who: 'Administrador',
      icon: 'contacts',
      go: () => go({id: 'users', view: 'people'}),
    },
    {
      id: 'log',
      title: 'Registro de seguridad',
      text: 'Quién hizo qué y a dónde llegan los enlaces de recuperación.',
      who: 'Administrador',
      icon: 'history',
      go: () => go({id: 'users', view: 'log'}),
    },
    {
      id: 'roles',
      title: 'Quién ve qué',
      text: 'Administrador, desarrollador, equipo e invitado; los roles se suman.',
      who: 'Todos',
      icon: 'tag',
      go: () => go({id: 'users', view: 'roles'}),
    },
  ];

  let body: React.ReactNode;
  switch (screen.id) {
    case 'supplier':
      body = (
        <SupplierForm
          initialMode={screen.mode}
          onInbox={() => go({id: 'offers', view: 'inbox'})}
        />
      );
      break;
    case 'offers':
      body = (
        <OffersAdmin
          initialView={screen.view}
          onBack={toIndex}
          onManual={() => go({id: 'supplier', mode: 'manual'})}
        />
      );
      break;
    case 'login':
      body = (
        <LoginMock
          onBack={toIndex}
          notice={screen.notice}
          onForgot={() => go({id: 'recovery'})}
          onLogin={username => {
            const next = meFor(username);
            setMeState(next);
            go(
              next.provisional
                ? {id: 'welcome'}
                : {id: 'profile', tab: 'perfil'},
            );
          }}
        />
      );
      break;
    case 'recovery':
      body = (
        <RecoveryMock
          onBack={toIndex}
          onLogin={notice => go({id: 'login', notice: notice || undefined})}
        />
      );
      break;
    case 'welcome':
      body = (
        <WelcomeMock
          me={me}
          setMe={setMe}
          onBack={toIndex}
          onDone={() => go({id: 'profile', tab: 'perfil'})}
        />
      );
      break;
    case 'profile':
      body = (
        <ProfileMock
          me={me}
          setMe={setMe}
          palette={palette}
          onPalette={setPalette}
          onBack={toIndex}
          onUsers={() => go({id: 'users', view: 'people'})}
          initialTab={screen.tab}
        />
      );
      break;
    case 'users':
      body = <UsersAdmin initialView={screen.view} onBack={toIndex} />;
      break;
    default:
      body = <MockIndex f1={f1} f2={f2} />;
  }

  return (
    <div
      className="lx lx-mk"
      id="lx-mockups"
      ref={rootRef}
      tabIndex={-1}
      role="region"
      aria-label="Maquetas de Ox Eye"
      data-screen={screen.id}
    >
      <MockToasts>
        <div className="lx-mk-ribbon">
          <Chip tag tone="neutral" size="sm">
            Maqueta
          </Chip>
          <span className="lx-mk-ribbon__what">
            <strong>{SCREEN_NAME[screen.id]}</strong>
            <span className="lx-mk-ribbon__note">
              {' '}
              · datos ficticios, nada se guarda ni se envía
            </span>
          </span>
          <span className="lx-mk-ribbon__palette">
            <Icon name="eye" size={16} />
            <SelectField
              id="mk-palette"
              aria-label="Paleta"
              value={palette}
              onChange={v => setPalette(normalizePaletteId(v))}
              options={COLOR_PALETTES.map(p => ({value: p.id, label: p.name}))}
            />
          </span>
          {screen.id !== 'index' && (
            <button
              type="button"
              className="lx-btn lx-btn--secondary lx-btn--sm"
              id="mk-to-index"
              onClick={toIndex}
            >
              <Icon name="list" size={16} />
              <span className="lx-btn__label">Índice</span>
            </button>
          )}
          <button
            type="button"
            className="lx-btn lx-btn--ghost lx-btn--sm"
            id="mk-exit"
            onClick={onExit}
          >
            <Icon name="back" size={16} />
            <span className="lx-btn__label">Volver al Gestor</span>
          </button>
        </div>
        <div className="lx-mk__stage" key={seq}>
          {body}
        </div>
      </MockToasts>
    </div>
  );
};

export default MockupsApp;
