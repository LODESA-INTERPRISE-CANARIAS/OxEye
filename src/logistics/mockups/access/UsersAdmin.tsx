/**
 * F2 · Users panel for administrators and developers: people with their
 * roles per organization and account state, provisional passwords (never
 * showing the current one), «Ver como Invitado», audited support sessions
 * with a banner for their whole duration, the security log and the roles.
 */
import React, {useEffect, useRef, useState} from 'react';
import {
  Button,
  Chip,
  EmptyState,
  Field,
  Icon,
  Segmented,
  Sheet,
  Textarea,
} from '../../ui';
import {
  ADMIN_LOG,
  ORG_SHORT,
  ROLE_HINT,
  ROLE_LABEL,
  USERS,
  type MockUser,
  type RoleId,
  type SecurityEvent,
} from '../data';
import {
  Avatar,
  ChoiceCards,
  MockShell,
  PasswordInput,
  SectionTitle,
  useNotify,
} from '../kit';
import {RolesTable} from './RolesTable';

export type UsersView = 'people' | 'log' | 'roles';

interface Support {
  user: MockUser;
  reason: string;
  endsAt: number;
}

const ROLE_ORDER: RoleId[] = ['admin', 'developer', 'team', 'guest'];

function recoveryText(u: MockUser): string {
  if (u.kind === 'guest') {
    return 'Sin recuperación: la contraseña la pone un desarrollador';
  }
  if (u.kind === 'shared') return 'Buzón del proyecto (cuenta compartida)';
  if (u.email?.verified) return 'Su correo personal verificado';
  return 'Buzón del proyecto hasta que verifique su correo';
}

const PROVISIONAL_SAMPLE = 'plaza-tinerfe-47';

const UserSheet: React.FC<{
  user: MockUser | null;
  meId: string;
  onClose: () => void;
  onChange: (u: MockUser) => void;
  onSupport: (u: MockUser) => void;
  log: (e: Omit<SecurityEvent, 'id' | 'when'>) => void;
}> = ({user, meId, onClose, onChange, onSupport, log}) => {
  const notify = useNotify();
  const [confirmPw, setConfirmPw] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  if (!user) return <Sheet open={false} onClose={onClose} title="" />;
  const self = user.id === meId;
  const toggleRole = (r: RoleId) => {
    const roles = user.roles.includes(r)
      ? user.roles.filter(x => x !== r)
      : [...user.roles, r];
    if (!roles.length) return;
    onChange({...user, roles});
    log({
      kind: 'role',
      text: `${user.displayName}: ${roles.map(x => ROLE_LABEL[x]).join(' + ')}`,
      who: 'Fabián',
    });
  };
  return (
    <Sheet
      open
      onClose={onClose}
      id="mk-user-sheet"
      eyebrow={`Usuario · ${ORG_SHORT}`}
      title={user.displayName}
      meta={
        <>
          <Chip size="sm" tag tone="neutral">
            Usuario: {user.username}
          </Chip>
          <span className="lx-muted">Último acceso: {user.lastSeen}</span>
        </>
      }
      footer={
        <>
          <Button onClick={onClose}>Cerrar</Button>
          <span className="lx-sheet__foot-spacer" />
          {user.kind === 'personal' && !self && (
            <Button
              variant="primary"
              icon="eye"
              id="mk-start-support"
              onClick={() => onSupport(user)}
            >
              Sesión de soporte
            </Button>
          )}
        </>
      }
    >
      <div className="lx-mk-stack">
        <fieldset className="lx-mk-rolepick">
          <legend className="lx-mk-legend">Roles en {ORG_SHORT}</legend>
          {ROLE_ORDER.map(r => {
            const locked = self && r === 'admin';
            return (
              <span
                className="lx-mk-check lx-mk-check--row"
                key={r}
                data-disabled={locked || undefined}
              >
                <input
                  type="checkbox"
                  id={`mk-role-${user.id}-${r}`}
                  checked={user.roles.includes(r)}
                  disabled={locked || user.kind !== 'personal'}
                  onChange={() => toggleRole(r)}
                />
                <label htmlFor={`mk-role-${user.id}-${r}`}>
                  <strong>{ROLE_LABEL[r]}</strong>
                  <span>
                    {locked
                      ? 'No puedes quitarte tu propio rol de administrador.'
                      : ROLE_HINT[r]}
                  </span>
                </label>
              </span>
            );
          })}
        </fieldset>

        <dl className="lx-mk-facts">
          <div className="lx-mk-facts__row">
            <dt>Contraseña</dt>
            <dd>
              {user.provisional ? (
                <Chip size="sm" certainty="planned" tone="danger">
                  Provisional
                </Chip>
              ) : (
                <Chip size="sm" certainty="confirmed">
                  Privada
                </Chip>
              )}{' '}
              <span className="lx-muted">Nadie puede verla</span>
            </dd>
          </div>
          <div className="lx-mk-facts__row">
            <dt>Correo</dt>
            <dd>
              {user.email ? (
                user.email.verified ? (
                  <Chip size="sm" certainty="confirmed">
                    Verificado
                  </Chip>
                ) : (
                  <Chip size="sm" certainty="pending">
                    Sin verificar
                  </Chip>
                )
              ) : (
                <span className="lx-muted">Sin correo</span>
              )}
            </dd>
          </div>
          <div className="lx-mk-facts__row">
            <dt>Si olvida la contraseña</dt>
            <dd>{recoveryText(user)}</dd>
          </div>
          <div className="lx-mk-facts__row">
            <dt>Sesiones abiertas</dt>
            <dd className="lx-num">{user.sessions}</dd>
          </div>
        </dl>

        <section className="lx-mk-actionbox" aria-labelledby="mk-prov-h">
          <h3 id="mk-prov-h">Contraseña provisional</h3>
          {shown ? (
            <div className="lx-mk-provisional" role="status">
              <p>Dásela en persona o por teléfono. No se volverá a mostrar.</p>
              <code className="lx-mk-provisional__pw">{shown}</code>
              <p className="lx-muted">
                {user.displayName} tendrá que cambiarla al entrar, antes de ver
                información sensible. Sus sesiones abiertas se han cerrado.
              </p>
              <Button size="sm" onClick={() => setShown(null)}>
                Ya la he anotado
              </Button>
            </div>
          ) : confirmPw ? (
            <div className="lx-confirm-strip">
              <p>
                ¿Poner una provisional a {user.displayName}? Su contraseña
                actual dejará de servir.
              </p>
              <div className="lx-confirm-strip__actions">
                <Button size="sm" onClick={() => setConfirmPw(false)}>
                  No
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  id="mk-prov-confirm"
                  onClick={() => {
                    setConfirmPw(false);
                    setShown(PROVISIONAL_SAMPLE);
                    onChange({...user, provisional: true, sessions: 0});
                    log({
                      kind: 'password',
                      text: `Contraseña provisional puesta en la cuenta ${user.displayName}`,
                      who: 'Fabián',
                    });
                    notify('Contraseña provisional creada.');
                  }}
                >
                  Sí, poner provisional
                </Button>
              </div>
            </div>
          ) : (
            <>
              <p className="lx-mk-card-lead">
                Para desbloquear a alguien rápido. Nunca verás su contraseña
                actual; la provisional se muestra una sola vez.
              </p>
              <Button
                size="sm"
                icon="lock"
                id="mk-prov"
                onClick={() => setConfirmPw(true)}
              >
                Poner contraseña provisional
              </Button>
            </>
          )}
        </section>
      </div>
    </Sheet>
  );
};

const REASONS = [
  {value: 'bug', label: 'Revisar un error que ve'},
  {value: 'help', label: 'Ayudarle a configurar algo'},
  {value: 'data', label: 'Comprobar unos datos'},
  {value: 'other', label: 'Otro motivo'},
];

const SupportSheet: React.FC<{
  user: MockUser | null;
  onClose: () => void;
  onStart: (s: Support) => void;
}> = ({user, onClose, onStart}) => {
  const [reason, setReason] = useState<string | null>(null);
  const [detail, setDetail] = useState('');
  const [minutes, setMinutes] = useState<'15' | '30'>('15');
  const [pw, setPw] = useState('');
  const ready = !!reason && detail.trim().length >= 5 && pw.length >= 4;
  return (
    <Sheet
      open={!!user}
      onClose={onClose}
      id="mk-support-sheet"
      eyebrow="Sesión de soporte"
      title={user ? `Entrar en la cuenta de ${user.displayName}` : ''}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <span className="lx-sheet__foot-spacer" />
          <Button
            variant="primary"
            icon="eye"
            disabled={!ready}
            id="mk-support-go"
            onClick={() =>
              user &&
              onStart({
                user,
                reason: `${REASONS.find(r => r.value === reason)?.label}: ${detail.trim()}`,
                endsAt: Date.now() + Number(minutes) * 60_000,
              })
            }
          >
            Iniciar
          </Button>
        </>
      }
    >
      {user && (
        <div className="lx-mk-stack">
          <ul className="lx-mk-promises">
            <li>
              <Icon name="bell" size={16} /> {user.displayName} lo verá en su
              perfil y recibirá un aviso.
            </li>
            <li>
              <Icon name="history" size={16} /> Queda registrado quién, cuándo,
              en qué cuenta y por qué.
            </li>
            <li>
              <Icon name="lock" size={16} /> No verás su contraseña ni la parte
              privada de su perfil.
            </li>
            <li>
              <Icon name="clock" size={16} /> Dura poco (30 minutos como
              máximo); tú o la persona podéis terminarla cuando queráis.
            </li>
          </ul>
          <ChoiceCards
            name="mk-support-reason"
            legend="¿Para qué?"
            columns={2}
            value={reason}
            onChange={setReason}
            options={REASONS}
          />
          <Field
            id="mk-support-detail"
            label="Explícalo en una frase"
            hint="Obligatorio. Lo verá también la persona."
          >
            <Textarea
              id="mk-support-detail"
              rows={2}
              value={detail}
              placeholder="Por ejemplo: el calendario no le carga"
              onChange={e => setDetail(e.target.value)}
              aria-describedby="mk-support-detail-hint"
            />
          </Field>
          <Segmented<'15' | '30'>
            name="mk-support-min"
            legend="Duración"
            value={minutes}
            onChange={v => v && setMinutes(v)}
            options={[
              {value: '15', label: '15 minutos'},
              {value: '30', label: '30 minutos'},
            ]}
          />
          <Field
            id="mk-support-pw"
            label="Tu contraseña, para confirmar que eres tú"
          >
            <PasswordInput
              id="mk-support-pw"
              value={pw}
              onChange={setPw}
              autoComplete="current-password"
            />
          </Field>
        </div>
      )}
    </Sheet>
  );
};

/** Countdown in whole minutes, refreshed every second. */
function useRemaining(endsAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!endsAt) return;
    const tick = () => setNow(Date.now());
    // Refresh at once: `now` may date from when the screen first opened.
    const first = window.setTimeout(tick, 0);
    const t = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(t);
    };
  }, [endsAt]);
  return endsAt ? Math.max(0, endsAt - now) : 0;
}

const SupportView: React.FC<{support: Support}> = ({support}) => (
  <div className="lx-mk-view" id="mk-support-view">
    <section className="lx-card">
      <p className="lx-eyebrow">Hoy · como lo ve {support.user.displayName}</p>
      <h2 className="lx-card__title">La jornada</h2>
      <ul className="lx-mk-mini-tasks">
        <li>
          <span className="lx-num">08:00</span> Descarga de carpas · Plaza del
          Cristo
          <Chip size="sm" certainty="confirmed">
            Hecha
          </Chip>
        </li>
        <li>
          <span className="lx-num">10:30</span> Montaje de carpas · Carpas Mario
          Demo
          <Chip size="sm" certainty="planned">
            Ahora
          </Chip>
        </li>
        <li>
          <span className="lx-num">13:00</span> Prueba de sonido
          <Chip size="sm" certainty="pending" />
        </li>
      </ul>
    </section>
    <EmptyState
      icon="lock"
      title="Su perfil privado no está disponible en soporte"
      compact
    >
      Ni su contraseña, ni su correo de recuperación, ni su historial de
      seguridad. Lo que cambies aquí quedará firmado como «Fabián en soporte de{' '}
      {support.user.displayName}».
    </EmptyState>
    <p className="lx-mk-reason">
      <strong>Motivo:</strong> {support.reason}
    </p>
  </div>
);

const GuestPreview: React.FC = () => (
  <div className="lx-mk-view" id="mk-guest-view">
    <div className="lx-mk-spaces">
      {[
        {label: 'Hoy', icon: 'today' as const, ok: true},
        {label: 'Calendario', icon: 'calendar' as const, ok: true},
        {label: 'Tareas', icon: 'task' as const, ok: true},
        {label: 'Inventarios', icon: 'inventory' as const, ok: true},
        {label: 'Contactos', icon: 'contacts' as const, ok: false},
        {label: 'Catálogo', icon: 'catalog' as const, ok: false},
      ].map(s => (
        <div key={s.label} className="lx-mk-space" data-ok={s.ok || undefined}>
          <Icon name={s.icon} size={22} />
          <strong>{s.label}</strong>
          <span>{s.ok ? 'Solo lectura' : 'Sin acceso'}</span>
          {!s.ok && <Icon name="lock" size={16} />}
        </div>
      ))}
    </div>
    <EmptyState icon="lock" title="Contactos · Sin acceso">
      El Invitado no ve Contactos ni Catálogo: teléfonos, correos y precios son
      solo para el equipo. El servidor tampoco se los envía.
    </EmptyState>
    <section className="lx-card">
      <p className="lx-eyebrow">Una tarea, como la ve el Invitado</p>
      <p className="lx-mk-guest-task">
        <strong>Montaje de carpas</strong> · 10:30 – 13:00 · Plaza del Cristo
        <span className="lx-mk-guest-task__company">
          <Icon name="building" size={14} /> Carpas Mario Demo · sin contacto
        </span>
      </p>
    </section>
  </div>
);

export const UsersAdmin: React.FC<{
  initialView?: UsersView;
  onBack: () => void;
}> = ({initialView = 'people', onBack}) => {
  const notify = useNotify();
  const [view, setView] = useState<UsersView>(initialView);
  const [users, setUsers] = useState(USERS);
  const [openId, setOpenId] = useState<string | null>(null);
  const [supportFor, setSupportFor] = useState<MockUser | null>(null);
  const [support, setSupport] = useState<Support | null>(null);
  const [guest, setGuest] = useState(false);
  const [log, setLog] = useState<SecurityEvent[]>(ADMIN_LOG);
  const [filter, setFilter] = useState<'all' | SecurityEvent['kind']>('all');
  const remaining = useRemaining(support?.endsAt ?? null);
  const meId = 'u-fabian';

  const addLog = (e: Omit<SecurityEvent, 'id' | 'when'>) =>
    setLog(l => [{...e, id: `al-${Date.now()}`, when: 'Ahora'}, ...l]);

  const endSupport = (expired = false) => {
    if (!support) return;
    addLog({
      kind: 'support',
      text: `Sesión de soporte en la cuenta de ${support.user.displayName} · motivo «${support.reason}» · ${expired ? 'caducó' : 'terminada por Fabián'}`,
      who: 'Fabián',
    });
    notify(
      `Sesión de soporte terminada. ${support.user.displayName} lo verá en su perfil.`,
    );
    setSupport(null);
  };

  // The session ends by itself when its time is up.
  const endRef = useRef(endSupport);
  useEffect(() => {
    endRef.current = endSupport;
  });
  useEffect(() => {
    if (support && remaining === 0) endRef.current(true);
  }, [remaining, support]);

  const minutesLeft = Math.ceil(remaining / 60_000);
  const banner = support ? (
    <div
      className="lx-mk-banner lx-mk-banner--support"
      role="status"
      id="mk-support-banner"
    >
      <Icon name="eye" size={18} />
      <span>
        <strong>
          Sesión de soporte en la cuenta de {support.user.displayName}
        </strong>{' '}
        · quedan <span className="lx-num">{minutesLeft}</span> min
      </span>
      <Button
        size="sm"
        variant="primary"
        id="mk-support-end"
        onClick={() => endSupport()}
      >
        Terminar
      </Button>
    </div>
  ) : guest ? (
    <div
      className="lx-mk-banner lx-mk-banner--guest"
      role="status"
      id="mk-guest-banner"
    >
      <Icon name="lock" size={18} />
      <span>
        <strong>Estás viendo Ox Eye como Invitado</strong> · solo lectura, sin
        Contactos ni Catálogo
      </span>
      <Button size="sm" onClick={() => setGuest(false)}>
        Salir
      </Button>
    </div>
  ) : null;

  const filtered = filter === 'all' ? log : log.filter(e => e.kind === filter);
  const open = users.find(u => u.id === openId) ?? null;

  let content: React.ReactNode;
  if (support) content = <SupportView support={support} />;
  else if (guest) content = <GuestPreview />;
  else if (view === 'roles') content = <RolesTable />;
  else if (view === 'log') {
    content = (
      <div className="lx-mk-view" id="mk-log">
        <section
          className="lx-card lx-mk-recovery"
          aria-labelledby="mk-recovery-h"
        >
          <h2 className="lx-card__title" id="mk-recovery-h">
            A dónde llegan los enlaces de recuperación
          </h2>
          <ul className="lx-mk-recovery__list">
            {users.map(u => (
              <li key={u.id}>
                <Avatar name={u.displayName} size="sm" />
                <strong>{u.displayName}</strong>
                <span>{recoveryText(u)}</span>
              </li>
            ))}
          </ul>
          <p className="lx-field__hint">
            El buzón del proyecto se configura en el servidor. Quien pide el
            enlace nunca ve a qué dirección se envía.
          </p>
        </section>
        <div
          className="lx-filterchips"
          role="group"
          aria-label="Filtrar el registro"
        >
          {(
            [
              ['all', 'Todo'],
              ['support', 'Soporte'],
              ['password', 'Contraseñas'],
              ['role', 'Roles'],
              ['failed', 'Accesos fallidos'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className="lx-filterchip"
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <ol className="lx-mk-timeline lx-mk-timeline--card">
          {filtered.map(e => (
            <li key={e.id} data-kind={e.kind}>
              <span className="lx-mk-timeline__icon" aria-hidden="true">
                <Icon
                  name={
                    e.kind === 'support'
                      ? 'eye'
                      : e.kind === 'failed'
                        ? 'alert'
                        : e.kind === 'role'
                          ? 'tag'
                          : e.kind === 'email'
                            ? 'mail'
                            : 'lock'
                  }
                  size={16}
                />
              </span>
              <span className="lx-mk-timeline__text">
                <span>{e.text}</span>
                <small className="lx-num">
                  {e.when}
                  {e.who && ` · ${e.who}`}
                </small>
              </span>
            </li>
          ))}
        </ol>
        <p className="lx-field__hint">
          Nunca se registra una contraseña, un enlace de recuperación ni el
          contenido privado de un perfil.
        </p>
      </div>
    );
  } else {
    content = (
      <div className="lx-mk-view" id="mk-people">
        <SectionTitle count={users.length}>Personas</SectionTitle>
        <ul className="lx-mk-users">
          {users.map(u => (
            <li key={u.id}>
              <button
                type="button"
                className="lx-mk-user"
                data-user={u.username}
                onClick={() => setOpenId(u.id)}
              >
                <Avatar name={u.displayName} />
                <span className="lx-mk-user__main">
                  <strong>
                    {u.displayName}
                    {u.id === meId && <span className="lx-muted"> · tú</span>}
                  </strong>
                  <span className="lx-mk-user__roles">
                    {u.roles.map(r => (
                      <Chip
                        key={r}
                        size="sm"
                        certainty={r === 'guest' ? 'planned' : 'confirmed'}
                        tone={r === 'guest' ? 'neutral' : 'accent'}
                      >
                        {ROLE_LABEL[r]}
                      </Chip>
                    ))}
                    {u.kind === 'shared' && (
                      <Chip size="sm" tag tone="neutral">
                        Cuenta compartida
                      </Chip>
                    )}
                  </span>
                </span>
                <span className="lx-mk-user__state">
                  {u.provisional && (
                    <Chip size="sm" certainty="planned" tone="danger">
                      Contraseña provisional
                    </Chip>
                  )}
                  {u.email?.verified && (
                    <Chip size="sm" certainty="confirmed">
                      Correo verificado
                    </Chip>
                  )}
                  {u.email && !u.email.verified && (
                    <Chip size="sm" certainty="pending">
                      Correo sin verificar
                    </Chip>
                  )}
                  <span className="lx-mk-user__seen">{u.lastSeen}</span>
                </span>
                <Icon
                  name="chevronRight"
                  size={18}
                  className="lx-offerrow__chev"
                />
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <>
      <MockShell<UsersView>
        id="mk-users"
        navLabel="Administración"
        nav={[
          {id: 'people', label: 'Usuarios', icon: 'contacts'},
          {id: 'log', label: 'Registro de seguridad', icon: 'history'},
          {id: 'roles', label: 'Roles', icon: 'tag'},
        ]}
        active={view}
        onNav={v => {
          setGuest(false);
          setView(v);
        }}
        title={
          support
            ? `Soporte · ${support.user.displayName}`
            : guest
              ? 'Vista de Invitado'
              : view === 'people'
                ? 'Usuarios'
                : view === 'log'
                  ? 'Registro de seguridad'
                  : 'Quién ve qué'
        }
        subtitle={
          support
            ? 'Ves su cuenta con sus permisos, durante poco tiempo y con registro'
            : guest
              ? 'Así ve Ox Eye la cuenta Invitado'
              : view === 'roles'
                ? 'Lo que ve y hace cada rol en la organización'
                : 'Administradores y desarrolladores'
        }
        actions={
          !support &&
          !guest && (
            <Button
              icon="eye"
              id="mk-view-guest"
              onClick={() => setGuest(true)}
            >
              Ver como Invitado
            </Button>
          )
        }
        user={{name: 'Fabián', role: 'Administrador · Desarrollador'}}
        onBack={onBack}
        banner={banner}
      >
        {content}
      </MockShell>
      <UserSheet
        key={openId ?? 'closed'}
        user={open}
        meId={meId}
        onClose={() => setOpenId(null)}
        onChange={u => setUsers(us => us.map(x => (x.id === u.id ? u : x)))}
        onSupport={u => {
          setOpenId(null);
          setSupportFor(u);
        }}
        log={addLog}
      />
      <SupportSheet
        key={supportFor?.id ?? 'closed'}
        user={supportFor}
        onClose={() => setSupportFor(null)}
        onStart={s => {
          setSupportFor(null);
          setSupport(s);
          addLog({
            kind: 'support',
            text: `Sesión de soporte iniciada en la cuenta de ${s.user.displayName} · motivo «${s.reason}»`,
            who: 'Fabián',
          });
          notify(
            `${s.user.displayName} recibirá un aviso de esta sesión de soporte.`,
            'info',
          );
        }}
      />
    </>
  );
};
