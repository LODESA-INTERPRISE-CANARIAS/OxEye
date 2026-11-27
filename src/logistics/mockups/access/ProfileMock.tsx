/**
 * F2 · «Tu espacio en OxEye»: the personal profile. Photo, visible name,
 * short description and appearance; recovery e-mail with its state; own
 * security (password, open sessions, security history, support sessions on
 * the account) and own activity.
 */
import React, {useState} from 'react';
import {COLOR_PALETTES} from '../../../data/palettes';
import type {PaletteId} from '../../../types';
import {
  Button,
  Chip,
  ContourTexture,
  Field,
  HelpTip,
  Icon,
  Input,
  Segmented,
  Textarea,
} from '../../ui';
import {
  MY_ACTIVITY,
  MY_SECURITY,
  MY_SESSIONS,
  ROLE_LABEL,
  type SecurityEvent,
} from '../data';
import {Avatar, MockShell, SectionTitle, useNotify} from '../kit';
import {ACCENTS, type AccentId, type Me} from './me';
import {PasswordSheet, PhotoPicker} from './parts';

export type ProfileTab = 'perfil' | 'seguridad' | 'actividad' | 'usuarios';

const EVENT_ICON: Record<
  SecurityEvent['kind'],
  'lock' | 'user' | 'eye' | 'mail' | 'tag' | 'alert'
> = {
  password: 'lock',
  session: 'user',
  support: 'eye',
  email: 'mail',
  role: 'tag',
  failed: 'alert',
};

const WEEK = [
  {d: 'L', n: 4},
  {d: 'M', n: 7},
  {d: 'X', n: 3},
  {d: 'J', n: 9},
  {d: 'V', n: 6},
  {d: 'S', n: 1},
  {d: 'D', n: 0},
];

export const ProfileMock: React.FC<{
  me: Me;
  setMe: (patch: Partial<Me>) => void;
  palette: PaletteId;
  onPalette: (id: PaletteId) => void;
  onBack: () => void;
  onUsers: () => void;
  initialTab?: ProfileTab;
}> = ({
  me,
  setMe,
  palette,
  onPalette,
  onBack,
  onUsers,
  initialTab = 'perfil',
}) => {
  const notify = useNotify();
  const [tab, setTab] = useState<ProfileTab>(initialTab);
  const [pwOpen, setPwOpen] = useState(false);
  const [name, setName] = useState(me.displayName);
  const [about, setAbout] = useState(me.description);
  const [email, setEmail] = useState(me.email);
  const [sessions, setSessions] = useState(MY_SESSIONS);
  const [confirmOthers, setConfirmOthers] = useState(false);
  const [security, setSecurity] = useState(MY_SECURITY);
  const isAdmin = me.roles.includes('admin');
  const dirty =
    name.trim() !== me.displayName ||
    about.trim() !== me.description ||
    email.trim() !== me.email;

  const nav: {
    id: ProfileTab;
    label: string;
    icon: 'user' | 'lock' | 'activity' | 'contacts';
  }[] = [
    {id: 'perfil', label: 'Perfil', icon: 'user'},
    {id: 'seguridad', label: 'Seguridad', icon: 'lock'},
    {id: 'actividad', label: 'Actividad', icon: 'activity'},
  ];
  if (isAdmin) nav.push({id: 'usuarios', label: 'Usuarios', icon: 'contacts'});

  const banner = me.provisional && (
    <div
      className="lx-mk-banner lx-mk-banner--warn"
      role="status"
      id="mk-provisional-banner"
    >
      <Icon name="lock" size={18} />
      <span>
        <strong>Tu contraseña es provisional.</strong> Cámbiala para ver
        presupuestos, contactos y precios.
      </span>
      <Button size="sm" variant="primary" onClick={() => setPwOpen(true)}>
        Cambiar ahora
      </Button>
    </div>
  );

  return (
    <>
      <MockShell<ProfileTab>
        id="mk-profile"
        navLabel="Tu cuenta"
        nav={nav}
        active={tab}
        onNav={id => (id === 'usuarios' ? onUsers() : setTab(id))}
        title="Tu espacio en OxEye"
        subtitle="Cómo te ven los demás, cómo ves tú OxEye y quién entra en tu cuenta"
        user={{
          name: me.displayName,
          role: me.roles.map(r => ROLE_LABEL[r]).join(' · '),
          photo: me.photo,
        }}
        onBack={onBack}
        banner={banner}
      >
        <section
          className="lx-mk-hero"
          data-accent={me.accent}
          aria-label="Tu tarjeta"
        >
          <ContourTexture />
          <PhotoPicker me={me} onPhoto={photo => setMe({photo})} />
          <div className="lx-mk-hero__text">
            <p className="lx-eyebrow">Buenas tardes</p>
            <h2 className="lx-mk-hero__name">{me.displayName}</h2>
            <p className="lx-mk-hero__about">
              {me.description || (
                <span className="lx-muted">Sin descripción todavía</span>
              )}
            </p>
            <div className="lx-mk-hero__chips">
              {me.roles.map(r => (
                <Chip key={r} size="sm" certainty="confirmed">
                  {ROLE_LABEL[r]}
                </Chip>
              ))}
              <Chip size="sm" tag tone="neutral">
                Usuario: {me.username}
              </Chip>
            </div>
          </div>
          <div className="lx-mk-hero__seen" aria-label="Así apareces en OxEye">
            <p className="lx-eyebrow">Así apareces</p>
            <span className="lx-mk-seen">
              <span className="lx-mk-seen__task">Montaje de carpas</span>
              <Avatar name={me.displayName} photo={me.photo} size="sm" />
              <span>{me.displayName}</span>
            </span>
            <span className="lx-mk-seen lx-mk-seen--line">
              <Avatar name={me.displayName} photo={me.photo} size="sm" />
              <span>
                <strong>{me.displayName}</strong> cambió la hora · hace 5 min
              </span>
            </span>
          </div>
        </section>

        {tab === 'perfil' && (
          <div className="lx-mk-cols" id="mk-profile-perfil">
            <section className="lx-card" aria-labelledby="mk-p-data">
              <h2 className="lx-card__title" id="mk-p-data">
                Tus datos
              </h2>
              <div className="lx-mk-stack">
                <Field
                  id="mk-p-name"
                  label="Nombre visible"
                  hint="Tu usuario para entrar no cambia: tus tareas y registros siguen siendo tuyos."
                >
                  <Input
                    id="mk-p-name"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    aria-describedby="mk-p-name-hint"
                  />
                </Field>
                <Field
                  id="mk-p-about"
                  label="Una línea sobre ti"
                  optional
                  hint={`${about.length} / 140`}
                >
                  <Textarea
                    id="mk-p-about"
                    rows={2}
                    maxLength={140}
                    value={about}
                    onChange={e => setAbout(e.target.value)}
                    aria-describedby="mk-p-about-hint"
                  />
                </Field>
                <Field
                  id="mk-p-email"
                  label="Correo de recuperación"
                  help="Solo se usa para enviarte un enlace si olvidas tu contraseña. No lo ven las demás personas."
                >
                  <Input
                    id="mk-p-email"
                    type="email"
                    inputMode="email"
                    value={email}
                    placeholder="nombre@example.com"
                    onChange={e => setEmail(e.target.value)}
                  />
                </Field>
                <div className="lx-mk-emailstate" id="mk-email-state">
                  {me.emailState === 'verified' && email === me.email ? (
                    <Chip size="sm" certainty="confirmed">
                      Verificado
                    </Chip>
                  ) : me.emailState === 'pending' && email === me.email ? (
                    <>
                      <Chip size="sm" certainty="pending">
                        Sin verificar · revisa tu correo
                      </Chip>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          notify('Enlace de verificación reenviado.')
                        }
                      >
                        Reenviar enlace
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setMe({emailState: 'verified'});
                          notify('Maqueta: correo verificado.');
                        }}
                      >
                        Simular verificación
                      </Button>
                    </>
                  ) : (
                    <span className="lx-mk-warn">
                      <Icon name="alert" size={14} /> Sin correo verificado, si
                      olvidas la contraseña el enlace irá al buzón del proyecto.
                    </span>
                  )}
                </div>
                <div className="lx-mk-formactions">
                  <Button
                    variant="primary"
                    disabled={!dirty}
                    onClick={() => {
                      const emailChanged = email.trim() !== me.email;
                      setMe({
                        displayName: name.trim() || me.displayName,
                        description: about.trim(),
                        email: email.trim(),
                        emailState: emailChanged
                          ? email.trim()
                            ? 'pending'
                            : 'none'
                          : me.emailState,
                      });
                      notify(
                        emailChanged && email.trim()
                          ? 'Guardado. Te hemos enviado un enlace para verificar el correo nuevo.'
                          : 'Perfil guardado.',
                      );
                    }}
                  >
                    Guardar
                  </Button>
                </div>
              </div>
            </section>

            <section className="lx-card" aria-labelledby="mk-p-look">
              <h2 className="lx-card__title" id="mk-p-look">
                Apariencia
              </h2>
              <p className="lx-mk-card-lead">
                Cómo ves OxEye en tus dispositivos. No cambia lo que ven los
                demás.
              </p>
              <fieldset className="lx-mk-palettes">
                <legend className="lx-mk-legend">Paleta</legend>
                {COLOR_PALETTES.map(p => (
                  <span className="lx-mk-palette" key={p.id}>
                    <input
                      type="radio"
                      name="mk-palette"
                      id={`mk-pal-${p.id}`}
                      checked={palette === p.id}
                      onChange={() => onPalette(p.id)}
                    />
                    <label htmlFor={`mk-pal-${p.id}`}>
                      <span
                        className="lx-mk-palette__swatches"
                        aria-hidden="true"
                      >
                        {p.swatches.map((c, i) => (
                          // Swatches are the palette's own data, as in Ajustes.
                          <span key={i} style={{background: c}} />
                        ))}
                      </span>
                      <span className="lx-mk-palette__name">
                        {p.name}
                        {p.dark && <small> · oscura</small>}
                      </span>
                    </label>
                  </span>
                ))}
              </fieldset>
              <Segmented<AccentId>
                name="mk-accent"
                legend="Tono de tu tarjeta y tu foto"
                value={me.accent}
                options={ACCENTS.map(a => ({value: a.id, label: a.label}))}
                onChange={v => v && setMe({accent: v})}
              />
            </section>
          </div>
        )}

        {tab === 'seguridad' && (
          <div className="lx-mk-cols" id="mk-profile-seguridad">
            <div className="lx-mk-stack">
              <section className="lx-card" aria-labelledby="mk-s-pw">
                <h2 className="lx-card__title" id="mk-s-pw">
                  Contraseña
                </h2>
                <div className="lx-mk-pwstate">
                  {me.provisional ? (
                    <Chip size="sm" certainty="planned" tone="danger">
                      Provisional
                    </Chip>
                  ) : (
                    <Chip size="sm" certainty="confirmed">
                      Privada
                    </Chip>
                  )}
                  <span className="lx-muted">
                    {me.provisional
                      ? 'Puesta por Fabián el 20 nov'
                      : 'Cambiada por ti hoy'}
                  </span>
                </div>
                <p className="lx-mk-card-lead">
                  Nadie, ni los administradores, puede ver tu contraseña. Si la
                  olvidas, te enviamos un enlace a tu correo de recuperación.
                </p>
                <Button
                  variant={me.provisional ? 'primary' : 'secondary'}
                  icon="lock"
                  id="mk-change-pw"
                  onClick={() => setPwOpen(true)}
                >
                  Cambiar contraseña
                </Button>
              </section>

              <section className="lx-card" aria-labelledby="mk-s-sessions">
                <h2 className="lx-card__title" id="mk-s-sessions">
                  Sesiones abiertas
                  <HelpTip label="sesiones abiertas">
                    Cada dispositivo donde has entrado. Si no reconoces alguno,
                    ciérralo y cambia tu contraseña. Las sesiones sin uso se
                    cierran solas.
                  </HelpTip>
                </h2>
                <ul className="lx-mk-sessions">
                  {sessions.map(s => (
                    <li key={s.id} data-current={s.current || undefined}>
                      <Icon
                        name={s.device.includes('iPhone') ? 'phone' : 'server'}
                        size={20}
                      />
                      <span className="lx-mk-sessions__text">
                        <strong>
                          {s.device}
                          {s.current && (
                            <Chip size="sm" certainty="confirmed">
                              Este dispositivo
                            </Chip>
                          )}
                        </strong>
                        <span>
                          {s.where} · {s.when}
                        </span>
                      </span>
                      {!s.current && (
                        <Button
                          size="sm"
                          onClick={() => {
                            setSessions(ss => ss.filter(x => x.id !== s.id));
                            notify(`Sesión cerrada en ${s.device}.`);
                          }}
                        >
                          Cerrar esta
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
                {sessions.length > 1 &&
                  (confirmOthers ? (
                    <div className="lx-confirm-strip">
                      <p>¿Cerrar las otras {sessions.length - 1}?</p>
                      <div className="lx-confirm-strip__actions">
                        <Button
                          size="sm"
                          onClick={() => setConfirmOthers(false)}
                        >
                          No
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => {
                            setSessions(ss => ss.filter(x => x.current));
                            setConfirmOthers(false);
                            setSecurity(sec => [
                              {
                                id: `se-${Date.now()}`,
                                kind: 'session',
                                text: 'Cerraste tus sesiones en otros dispositivos',
                                when: 'Ahora',
                              },
                              ...sec,
                            ]);
                            notify('Hemos cerrado tus otras sesiones.');
                          }}
                        >
                          Sí, cerrarlas
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      icon="logout"
                      onClick={() => setConfirmOthers(true)}
                    >
                      Cerrar las demás
                    </Button>
                  ))}
              </section>
            </div>

            <section className="lx-card" aria-labelledby="mk-s-history">
              <h2 className="lx-card__title" id="mk-s-history">
                Tu historial de seguridad
              </h2>
              <p className="lx-mk-card-lead">
                Cambios de contraseña, accesos nuevos y sesiones de soporte en
                tu cuenta. Nunca se guarda ninguna contraseña.
              </p>
              <ol className="lx-mk-timeline">
                {security.map(e => (
                  <li key={e.id} data-kind={e.kind}>
                    <span className="lx-mk-timeline__icon" aria-hidden="true">
                      <Icon name={EVENT_ICON[e.kind]} size={16} />
                    </span>
                    <span className="lx-mk-timeline__text">
                      {e.kind === 'support' && (
                        <Chip size="sm" certainty="planned">
                          Sesión de soporte
                        </Chip>
                      )}
                      <span>{e.text}</span>
                      <small className="lx-num">{e.when}</small>
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        )}

        {tab === 'actividad' && (
          <div className="lx-mk-cols" id="mk-profile-actividad">
            <section className="lx-card" aria-labelledby="mk-a-week">
              <h2 className="lx-card__title" id="mk-a-week">
                Tu semana en OxEye
              </h2>
              <div className="lx-mk-tiles lx-num">
                <p>
                  <strong>42</strong> tareas creadas
                </p>
                <p>
                  <strong>18</strong> notas
                </p>
                <p>
                  <strong>7</strong> eventos
                </p>
                <p>
                  <strong>3</strong> ofertas aprobadas
                </p>
              </div>
              <figure
                className="lx-mk-week"
                aria-label="Cambios por día esta semana"
              >
                {WEEK.map(w => (
                  <span key={w.d} className="lx-mk-week__day">
                    <span
                      className="lx-mk-week__bar"
                      style={{height: `${(w.n / 9) * 100}%`}}
                    />
                    <span className="lx-mk-week__label">{w.d}</span>
                    <span className="lx-visually-hidden">{w.n} cambios</span>
                  </span>
                ))}
              </figure>
            </section>
            <section className="lx-card" aria-labelledby="mk-a-recent">
              <SectionTitle id="mk-a-recent">
                Lo último que has hecho
              </SectionTitle>
              <ol className="lx-mk-timeline">
                {MY_ACTIVITY.map(a => (
                  <li key={a.id}>
                    <span className="lx-mk-timeline__icon" aria-hidden="true">
                      <Icon name="activity" size={16} />
                    </span>
                    <span className="lx-mk-timeline__text">
                      <span>{a.text}</span>
                      <small className="lx-num">{a.when}</small>
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        )}
      </MockShell>
      <PasswordSheet
        open={pwOpen}
        provisional={me.provisional}
        onClose={() => setPwOpen(false)}
        onDone={() => {
          setPwOpen(false);
          setMe({provisional: false});
          setSecurity(sec => [
            {
              id: `se-${Date.now()}`,
              kind: 'password',
              text: 'Cambiaste tu contraseña · se cerraron tus otras sesiones',
              when: 'Ahora',
            },
            ...sec,
          ]);
          setSessions(ss => ss.filter(x => x.current));
          notify('Contraseña cambiada. Ya ves la información sensible.');
        }}
      />
    </>
  );
};
