/**
 * Shared pieces of the mock-ups: feedback toasts, the Gestor-like shell and
 * gate, the phone frame, medals, avatars and the large touch controls of the
 * supplier form. They reuse the Gestor's primitives and classes; anything
 * new is prefixed `lx-mk-` (styles in `src/styles/logistics/mockups.css`).
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {initials} from '../lib/format';
import {
  ContourTexture,
  EyeMark,
  Icon,
  SidebarNav,
  TabBar,
  Toaster,
  ToastHostContext,
  type IconName,
  type NavItem,
  type ToastHost,
} from '../ui';
import {ORG_SHORT} from './data';

// ---------------------------------------------------------------- toasts

type ToastTone = 'info' | 'success' | 'error';
type Notify = (message: string, tone?: ToastTone) => void;

const NotifyContext = createContext<Notify>(() => undefined);

/** Short feedback for every mock action («Maqueta: …»). */
export function useNotify(): Notify {
  return useContext(NotifyContext);
}

export const MockToasts: React.FC<{children: React.ReactNode}> = ({
  children,
}) => {
  const [toasts, setToasts] = useState<
    {id: number; message: string; tone: ToastTone}[]
  >([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, number>());
  const [slots, setSlots] = useState<HTMLElement[]>([]);
  const host = useMemo<ToastHost>(
    () => ({
      add: slot => setSlots(s => [...s.filter(x => x !== slot), slot]),
      remove: slot => setSlots(s => s.filter(x => x !== slot)),
    }),
    [],
  );
  const dismiss = useCallback((id: number) => {
    setToasts(t => t.filter(x => x.id !== id));
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);
  }, []);
  const notify = useCallback<Notify>(
    (message, tone = 'success') => {
      const id = ++seq.current;
      // At most two at once: on a phone more would cover the screen.
      setToasts(t => [...t.slice(-1), {id, message, tone}]);
      timers.current.set(
        id,
        window.setTimeout(() => dismiss(id), 4200),
      );
    },
    [dismiss],
  );
  useEffect(() => {
    const all = timers.current;
    return () => all.forEach(t => window.clearTimeout(t));
  }, []);
  return (
    <ToastHostContext.Provider value={host}>
      <NotifyContext.Provider value={notify}>{children}</NotifyContext.Provider>
      <Toaster
        toasts={toasts}
        onDismiss={dismiss}
        host={slots[slots.length - 1] ?? null}
      />
    </ToastHostContext.Provider>
  );
};

// ---------------------------------------------------------------- avatar

export const Avatar: React.FC<{
  name: string;
  photo?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}> = ({name, photo, size = 'md', className}) => (
  <span
    className={['lx-avatar', `lx-mk-avatar--${size}`, className]
      .filter(Boolean)
      .join(' ')}
    aria-hidden="true"
  >
    {photo ? <img src={photo} alt="" /> : initials(name)}
  </span>
);

// ---------------------------------------------------------------- medal

const MEDAL: Record<1 | 2 | 3, string> = {1: 'Oro', 2: 'Plata', 3: 'Bronce'};

/** Gold, silver and bronze for the three best estimated totals. */
export const Medal: React.FC<{rank: 1 | 2 | 3}> = ({rank}) => (
  <span
    className={`lx-mk-medal lx-mk-medal--${rank}`}
    role="img"
    aria-label={`${MEDAL[rank]}: puesto ${rank}`}
    title={`${MEDAL[rank]} · ${rank}.º total estimado`}
  >
    <span className="lx-mk-medal__ribbon" aria-hidden="true" />
    <span className="lx-mk-medal__disc lx-num" aria-hidden="true">
      {rank}
    </span>
  </span>
);

// ---------------------------------------------------------------- shell

export interface MockShellProps<T extends string> {
  id: string;
  nav: (NavItem<T> & {badge?: number})[];
  active: T;
  onNav: (id: T) => void;
  navLabel: string;
  title: React.ReactNode;
  subtitle: React.ReactNode;
  actions?: React.ReactNode;
  user: {name: string; role: string; photo?: string | null};
  onBack: () => void;
  /** Shown above the header, full width (support session, guest view). */
  banner?: React.ReactNode;
  children: React.ReactNode;
}

/** The Gestor's layout: sidebar on desktop, top bar and tab bar on phones. */
export function MockShell<T extends string>({
  id,
  nav,
  active,
  onNav,
  navLabel,
  title,
  subtitle,
  actions,
  user,
  onBack,
  banner,
  children,
}: MockShellProps<T>) {
  const mainRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    mainRef.current?.scrollTo({top: 0});
  }, [active]);
  const items = nav.map(n => ({
    ...n,
    label: n.badge ? `${n.label} (${n.badge})` : n.label,
  }));
  return (
    <div className="lx-mk-shell" id={id}>
      <aside className="lx-sidebar" aria-label="Gestor logístico">
        <ContourTexture />
        <div className="lx-brand">
          <EyeMark size={38} />
          <div className="lx-brand__text">
            <strong>OxEye</strong>
            <span>Gestor logístico</span>
          </div>
        </div>
        <div className="lx-org">
          <span className="lx-org__label">Organización</span>
          <span className="lx-org__name">{ORG_SHORT}</span>
        </div>
        <p className="lx-sidebar__group">{navLabel}</p>
        <SidebarNav<T>
          items={items}
          active={active}
          onSelect={onNav}
          label={navLabel}
          idPrefix={`${id}-nav`}
        />
        <div className="lx-sidebar__spacer" />
        <div className="lx-user">
          <Avatar name={user.name} photo={user.photo} />
          <span className="lx-user__text">
            <strong>{user.name}</strong>
            <span>{user.role}</span>
          </span>
        </div>
        <button
          type="button"
          className="lx-sidenav__item lx-sidenav__item--exit"
          onClick={onBack}
        >
          <Icon name="back" size={20} />
          <span>Índice de maquetas</span>
        </button>
      </aside>
      <div className="lx-main" ref={mainRef}>
        <div className="lx-topbar">
          <button
            type="button"
            className="lx-iconbtn lx-iconbtn--ghost"
            aria-label="Índice de maquetas"
            onClick={onBack}
          >
            <Icon name="back" size={20} />
          </button>
          <span className="lx-topbar__title">OxEye</span>
          <Avatar name={user.name} photo={user.photo} size="sm" />
        </div>
        {banner}
        <header className="lx-header">
          <ContourTexture />
          <div className="lx-header__text">
            <p className="lx-eyebrow">{ORG_SHORT}</p>
            <h1 className="lx-header__title">{title}</h1>
            <p className="lx-header__subtitle">{subtitle}</p>
          </div>
          {actions && <div className="lx-header__actions">{actions}</div>}
        </header>
        <div className="lx-content lx-mk-content">{children}</div>
      </div>
      <TabBar<T>
        items={items}
        active={active}
        onSelect={onNav}
        label={navLabel}
        idPrefix={`${id}-tab`}
      />
    </div>
  );
}

// ---------------------------------------------------------------- gate

/** Centred card over the contour texture (login, recovery, welcome). */
export const MockGate: React.FC<{
  id: string;
  onBack: () => void;
  wide?: boolean;
  eyebrow?: string;
  children: React.ReactNode;
}> = ({id, onBack, wide = false, eyebrow, children}) => (
  <div className="lx-gate lx-mk-gate" id={id}>
    <ContourTexture />
    <div className="lx-gate__bar">
      <div className="lx-brand">
        <EyeMark size={36} />
        <div className="lx-brand__text">
          <strong>OxEye</strong>
          <span>Gestor logístico</span>
        </div>
      </div>
      <button
        type="button"
        className="lx-btn lx-btn--ghost lx-btn--md"
        onClick={onBack}
      >
        <Icon name="back" size={18} />
        <span className="lx-btn__label">Índice de maquetas</span>
      </button>
    </div>
    <main className={`lx-gate__card${wide ? ' lx-gate__card--wide' : ''}`}>
      <p className="lx-eyebrow">{eyebrow ?? ORG_SHORT}</p>
      {children}
    </main>
  </div>
);

// ---------------------------------------------------------------- phone frame

/** On desktop, the supplier's view inside a phone; on a phone, full screen. */
export const PhoneFrame: React.FC<{
  aside?: React.ReactNode;
  children: React.ReactNode;
}> = ({aside, children}) => (
  <div className="lx-mk-device">
    <ContourTexture />
    {aside && <aside className="lx-mk-device__aside">{aside}</aside>}
    <div className="lx-mk-device__phone">
      <span className="lx-mk-device__notch" aria-hidden="true" />
      <div className="lx-mk-device__screen">{children}</div>
    </div>
  </div>
);

// ---------------------------------------------------------------- controls

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
  sub?: string;
  icon?: IconName;
  glyph?: React.ReactNode;
  /** Chosen for the supplier by the request; cannot be removed. */
  locked?: boolean;
}

/**
 * Large answer cards on native radios or checkboxes (arrow keys, Space and
 * screen readers work as usual). `columns` sets the grid on wide frames.
 */
export function ChoiceCards<T extends string>({
  name,
  legend,
  options,
  value,
  onChange,
  multiple = false,
  columns = 1,
  hideLegend = false,
}: {
  name: string;
  legend: string;
  options: ChoiceOption<T>[];
  value: T | T[] | null;
  onChange: (value: T) => void;
  multiple?: boolean;
  columns?: 1 | 2 | 3;
  hideLegend?: boolean;
}) {
  const chosen = (v: T) =>
    Array.isArray(value) ? value.includes(v) : value === v;
  return (
    <fieldset className={`lx-mk-choices lx-mk-choices--c${columns}`}>
      <legend className={hideLegend ? 'lx-visually-hidden' : 'lx-mk-legend'}>
        {legend}
      </legend>
      {options.map(opt => {
        const id = `${name}-${opt.value}`;
        return (
          <span className="lx-mk-choice" key={opt.value}>
            <input
              type={multiple ? 'checkbox' : 'radio'}
              id={id}
              name={name}
              value={opt.value}
              checked={chosen(opt.value)}
              disabled={opt.locked}
              onChange={() => onChange(opt.value)}
            />
            <label htmlFor={id} data-locked={opt.locked || undefined}>
              {(opt.glyph || opt.icon) && (
                <span className="lx-mk-choice__icon" aria-hidden="true">
                  {opt.glyph ?? <Icon name={opt.icon!} size={22} />}
                </span>
              )}
              <span className="lx-mk-choice__text">
                <span className="lx-mk-choice__label">{opt.label}</span>
                {opt.sub && (
                  <span className="lx-mk-choice__sub">{opt.sub}</span>
                )}
              </span>
              <span className="lx-mk-choice__mark" aria-hidden="true">
                <Icon name="check" size={16} />
              </span>
            </label>
          </span>
        );
      })}
    </fieldset>
  );
}

/** − 3 + with typed input; large targets for one-hand use. */
export const NumberStepper: React.FC<{
  id: string;
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  unit?: string;
  hint?: string;
}> = ({id, label, value, onChange, min = 0, max = 999, unit, hint}) => {
  const set = (n: number) => onChange(Math.max(min, Math.min(max, n)));
  return (
    <div className="lx-mk-stepper">
      <label className="lx-mk-legend" htmlFor={id}>
        {label}
      </label>
      <div className="lx-mk-stepper__row">
        <button
          type="button"
          className="lx-mk-stepper__btn"
          aria-label={`Quitar uno a ${label}`}
          onClick={() => set(value - 1)}
          disabled={value <= min}
        >
          <Icon name="minus" size={22} />
        </button>
        <input
          id={id}
          className="lx-mk-stepper__value lx-num"
          type="text"
          inputMode="numeric"
          value={value}
          onChange={e => {
            const n = Number(e.target.value.replace(/\D/g, ''));
            if (!Number.isNaN(n)) set(n);
          }}
        />
        <button
          type="button"
          className="lx-mk-stepper__btn"
          aria-label={`Añadir uno a ${label}`}
          onClick={() => set(value + 1)}
          disabled={value >= max}
        >
          <Icon name="plus" size={22} />
        </button>
        {unit && <span className="lx-mk-stepper__unit">{unit}</span>}
      </div>
      {hint && <p className="lx-field__hint">{hint}</p>}
    </div>
  );
};

/** Amount in euros with a fixed «€» and a decimal keyboard on phones. */
export const MoneyInput: React.FC<{
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  big?: boolean;
}> = ({id, label, value, onChange, hint, big = false}) => (
  <div className={`lx-mk-money${big ? ' lx-mk-money--big' : ''}`}>
    <label className="lx-mk-legend" htmlFor={id}>
      {label}
    </label>
    <div className="lx-mk-money__box">
      <input
        id={id}
        className="lx-input lx-num"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder="0"
        value={value}
        onChange={e => onChange(e.target.value.replace(/[^\d,.]/g, ''))}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      <span className="lx-mk-money__unit" aria-hidden="true">
        €
      </span>
    </div>
    {hint && (
      <p className="lx-field__hint" id={`${id}-hint`}>
        {hint}
      </p>
    )}
  </div>
);

/** «1.234,5» or «1234.5» → number; null when empty or not a number. */
export function parseMoney(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const normalised = t.includes(',')
    ? t.replace(/\./g, '').replace(',', '.')
    : t;
  const n = Number(normalised);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------- password strength

export interface Strength {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  tip: string;
}

/** A hint, not a rule: long phrases beat symbols. */
export function passwordStrength(pw: string): Strength {
  if (!pw) return {score: 0, label: 'Escribe una contraseña', tip: ''};
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/\s|-/.test(pw.trim()) && pw.length >= 14) score++;
  if (/[A-ZÁÉÍÓÚÑ]/.test(pw) && /[a-záéíóúñ]/.test(pw) && /\d/.test(pw)) {
    score++;
  }
  if (/^(.)\1+$/.test(pw) || /^(1234|qwer|abcd|contrase|password)/i.test(pw)) {
    score = 0;
  }
  const s = Math.min(4, score) as Strength['score'];
  const LABEL = ['Muy débil', 'Débil', 'Aceptable', 'Buena', 'Muy buena'];
  const TIP = [
    'Demasiado corta o fácil de adivinar.',
    'Alárgala: 12 caracteres o más.',
    'Mejor con tres o cuatro palabras que solo tú relaciones.',
    'Una frase más larga la haría aún mejor.',
    'No la uses en ningún otro sitio.',
  ];
  return {score: s, label: LABEL[s], tip: TIP[s]};
}

export const StrengthMeter: React.FC<{password: string; id: string}> = ({
  password,
  id,
}) => {
  const s = passwordStrength(password);
  return (
    <div className="lx-mk-strength" id={id} data-score={s.score}>
      <div className="lx-mk-strength__bars" aria-hidden="true">
        {[1, 2, 3, 4].map(i => (
          <span key={i} data-on={s.score >= i || undefined} />
        ))}
      </div>
      <p className="lx-mk-strength__text" aria-live="polite">
        <strong>{s.label}</strong>
        {s.tip && <span> · {s.tip}</span>}
      </p>
    </div>
  );
};

/** Password input with the Gestor's show / hide eye and a Caps Lock hint. */
export const PasswordInput: React.FC<{
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: 'current-password' | 'new-password';
  invalid?: boolean;
  describedBy?: string;
  autoFocus?: boolean;
}> = ({id, value, onChange, autoComplete, invalid, describedBy, autoFocus}) => {
  const [shown, setShown] = useState(false);
  const [caps, setCaps] = useState(false);
  return (
    <>
      <div className="lx-password">
        <input
          id={id}
          className="lx-input"
          type={shown ? 'text' : 'password'}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          data-autofocus={autoFocus || undefined}
          onChange={e => onChange(e.target.value)}
          onKeyUp={e => setCaps(e.getModifierState('CapsLock'))}
        />
        <button
          type="button"
          className="lx-password__toggle"
          aria-pressed={shown}
          aria-label={shown ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          onClick={() => setShown(v => !v)}
        >
          <Icon name="eye" size={18} />
        </button>
      </div>
      {caps && (
        <p className="lx-mk-caps" role="status">
          <Icon name="alert" size={14} /> Bloq Mayús está activado
        </p>
      )}
    </>
  );
};

// ---------------------------------------------------------------- small bits

/** Key / value pairs in a calm two-column grid. */
export const Facts: React.FC<{
  items: [React.ReactNode, React.ReactNode][];
  className?: string;
}> = ({items, className}) => (
  <dl className={['lx-mk-facts', className].filter(Boolean).join(' ')}>
    {items.map(([k, v], i) => (
      <div key={i} className="lx-mk-facts__row">
        <dt>{k}</dt>
        <dd>{v}</dd>
      </div>
    ))}
  </dl>
);

/** Section title inside a screen (Georgia, like the catalogue groups). */
export const SectionTitle: React.FC<{
  id?: string;
  children: React.ReactNode;
  count?: number;
  aside?: React.ReactNode;
}> = ({id, children, count, aside}) => (
  <div className="lx-mk-section-title">
    <h2 id={id}>
      {children}
      {count !== undefined && <span className="lx-count lx-num">{count}</span>}
    </h2>
    {aside}
  </div>
);
