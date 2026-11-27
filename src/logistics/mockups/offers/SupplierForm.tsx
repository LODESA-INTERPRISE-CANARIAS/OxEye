/**
 * F1 · The supplier's mobile form, reached from a personal link. On a phone
 * it fills the screen; on a desktop it sits in a phone frame next to notes
 * for the reviewer (mode, link, what reaches Ox Eye).
 */
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Chip, EyeMark, Icon, Segmented} from '../../ui';
import {CATEGORY_LABEL, ORG_SHORT, type CategoryId} from '../data';
import {fmtDay} from '../dates';
import {PhoneFrame} from '../kit';
import {
  CategoriesStep,
  ContactStep,
  DeclineStep,
  ExpiredView,
  MoreStep,
  ProductStep,
  ReviewStep,
  SentView,
  SpecialStep,
  StartStep,
  TaxStep,
  ValidityStep,
  validityUntil,
  type StepProps,
} from './SupplierSteps';
import {
  emptyDraft,
  newProduct,
  productTitle,
  SECTIONS,
  stepsFor,
  type Draft,
  type Mode,
  type Value,
} from './supplierFlow';

export type SupplierMode = Mode | 'expired';

const MODE_OPTIONS: {value: SupplierMode; label: string}[] = [
  {value: 'request', label: 'Desde una solicitud'},
  {value: 'open', label: 'Oferta libre'},
  {value: 'manual', label: 'Registrar a mano'},
  {value: 'expired', label: 'Enlace caducado'},
];

const DEFAULTS: Partial<Record<CategoryId, Record<string, Value>>> = {
  carpas: {units: 1},
  limpieza: {staff: 2},
  ocio: {units: 1},
};

const Conversation: React.FC<{
  mode: Mode;
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
  onRestart: () => void;
  onInbox: () => void;
}> = ({mode, draft, setDraft, onRestart, onInbox}) => {
  const [stepId, setStepId] = useState('start');
  const [sent, setSent] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  const steps = useMemo(() => stepsFor(draft, mode), [draft, mode]);
  const index = Math.max(
    0,
    steps.findIndex(s => s.id === stepId),
  );
  const step = steps[index];

  useEffect(() => {
    bodyRef.current?.scrollTo({top: 0});
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus({preventScroll: true});
  }, [stepId, sent]);

  const update = useCallback(
    (patch: Partial<Draft>) => setDraft(d => ({...d, ...patch})),
    [setDraft],
  );
  const setProduct = useCallback(
    (key: string, field: string, value: Value) =>
      setDraft(d => ({
        ...d,
        products: d.products.map(p =>
          p.key === key ? {...p, v: {...p.v, [field]: value}} : p,
        ),
      })),
    [setDraft],
  );
  const go = useCallback((id: string) => setStepId(id), []);
  // The intent cards advance after a short pause; read the latest answers.
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  });
  const next = useCallback(() => {
    setStepId(current => {
      const all = stepsFor(draftRef.current, mode);
      const i = all.findIndex(s => s.id === current);
      return all[Math.min(all.length - 1, i + 1)]?.id ?? current;
    });
  }, [mode]);

  const addProduct = (category: CategoryId) => {
    const p = newProduct(category, DEFAULTS[category]);
    setDraft(d => ({...d, products: [...d.products, p]}));
    setStepId(`p:${p.key}:what`);
  };
  const removeProduct = (key: string) =>
    setDraft(d => ({...d, products: d.products.filter(p => p.key !== key)}));
  const toggleCategory = (category: CategoryId) =>
    setDraft(d => {
      if (d.categories.includes(category)) {
        return {
          ...d,
          categories: d.categories.filter(c => c !== category),
          products: d.products.filter(p => p.category !== category),
        };
      }
      return {
        ...d,
        categories: [...d.categories, category],
        products: [...d.products, newProduct(category, DEFAULTS[category])],
      };
    });

  const props: StepProps & {headingRef: React.Ref<HTMLHeadingElement>} = {
    step,
    draft,
    mode,
    update,
    setProduct,
    go,
    next,
    addProduct,
    removeProduct,
    toggleCategory,
    headingRef,
  };

  if (sent) {
    return (
      <div className="lx-mk-sf">
        <SfHead />
        <div className="lx-mk-sf__body" ref={bodyRef}>
          <SentView
            mode={mode}
            declined={draft.intent === 'no'}
            onRestart={onRestart}
            onInbox={onInbox}
          />
        </div>
      </div>
    );
  }

  let body: React.ReactNode;
  switch (step.id) {
    case 'start':
      body = <StartStep {...props} />;
      break;
    case 'decline':
      body = <DeclineStep {...props} />;
      break;
    case 'contact':
      body = <ContactStep {...props} />;
      break;
    case 'categories':
      body = <CategoriesStep {...props} />;
      break;
    case 'more':
      body = <MoreStep {...props} />;
      break;
    case 'tax':
      body = <TaxStep {...props} />;
      break;
    case 'validity':
      body = <ValidityStep {...props} />;
      break;
    case 'special':
      body = <SpecialStep {...props} />;
      break;
    case 'review':
      body = <ReviewStep {...props} />;
      break;
    default:
      body = <ProductStep {...props} />;
  }

  const isLast = step.id === 'review' || step.id === 'decline';
  const awaitingIntent =
    mode === 'request' && step.id === 'start' && !draft.intent;
  const blocked =
    (step.id === 'categories' && draft.categories.length === 0) ||
    (isLast && step.id === 'review' && !draft.privacy);
  const primary =
    step.id === 'review'
      ? mode === 'manual'
        ? 'Guardar como pendiente'
        : 'Enviar oferta'
      : step.id === 'decline'
        ? 'Enviar respuesta'
        : step.id === 'more'
          ? 'No, seguir'
          : mode === 'open' && step.id === 'start'
            ? 'Empezar'
            : 'Siguiente';

  const sectionIndex = SECTIONS.indexOf(step.section);
  const pct = Math.round(((index + 1) / steps.length) * 100);

  return (
    <div className="lx-mk-sf" data-step={step.id}>
      <SfHead>
        <div className="lx-mk-sf__progress">
          <button
            type="button"
            className="lx-iconbtn lx-iconbtn--ghost"
            aria-label="Paso anterior"
            disabled={index === 0}
            onClick={() => setStepId(steps[index - 1]?.id ?? 'start')}
          >
            <Icon name="chevronLeft" size={22} />
          </button>
          <div className="lx-mk-sf__bar">
            <p className="lx-mk-sf__section">
              <span>{step.section}</span>
              <span className="lx-num">
                {index + 1} de {steps.length}
              </span>
            </p>
            <div
              className="lx-mk-sf__track"
              role="progressbar"
              aria-label="Progreso de la oferta"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
            >
              <span style={{width: `${pct}%`}} />
            </div>
            <ol className="lx-mk-sf__dots" aria-hidden="true">
              {SECTIONS.map((s, i) => (
                <li
                  key={s}
                  data-state={
                    i < sectionIndex
                      ? 'done'
                      : i === sectionIndex
                        ? 'now'
                        : undefined
                  }
                />
              ))}
            </ol>
          </div>
        </div>
      </SfHead>
      <div className="lx-mk-sf__body" ref={bodyRef}>
        <div className="lx-mk-sf__step" key={step.id}>
          {body}
        </div>
      </div>
      {!awaitingIntent && (
        <div className="lx-mk-sf__foot">
          {blocked && step.id === 'review' && (
            <p className="lx-mk-sf__why">
              Marca la casilla de tus datos para enviarla.
            </p>
          )}
          <button
            type="button"
            className="lx-btn lx-btn--primary lx-btn--lg lx-btn--block"
            id="sf-next"
            disabled={blocked}
            onClick={() => (isLast ? setSent(true) : next())}
          >
            <span className="lx-btn__label">{primary}</span>
            {!isLast && <Icon name="chevronRight" size={20} />}
            {isLast && <Icon name="send" size={20} />}
          </button>
        </div>
      )}
    </div>
  );
};

const SfHead: React.FC<{children?: React.ReactNode}> = ({children}) => (
  <header className="lx-mk-sf__head">
    <div className="lx-mk-sf__brand">
      <EyeMark size={26} />
      <span>
        <strong>Ox Eye</strong> · {ORG_SHORT}
      </span>
    </div>
    {children}
  </header>
);

/** What would reach Ox Eye right now, for the reviewer next to the phone. */
const Captured: React.FC<{draft: Draft; mode: Mode}> = ({draft, mode}) => {
  const until = validityUntil(draft);
  const rows: [string, string][] = [
    ['Proveedor', draft.company.name || 'Sin indicar'],
    [
      'Productos',
      draft.products.length
        ? draft.products.map(productTitle).join(' · ')
        : 'Ninguno aún',
    ],
    [
      'Actividades',
      draft.categories.map(c => CATEGORY_LABEL[c]).join(', ') || '—',
    ],
    [
      'Impuesto',
      draft.tax === 'igic' || draft.tax === 'iva'
        ? `${draft.tax.toUpperCase()} ${draft.taxRate} % · por verificar`
        : draft.tax === 'none'
          ? 'Ninguno'
          : draft.tax === 'unknown'
            ? 'Sin saber: no se suma'
            : '—',
    ],
    ['Aceptar antes de', until ? fmtDay(until) : '—'],
    [
      'Compromiso',
      draft.commitment === 'yes' ? `${draft.commitmentYears} años` : '—',
    ],
  ];
  return (
    <div className="lx-mk-captured">
      <p className="lx-eyebrow">Lo que llegará a Ox Eye</p>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="lx-mk-captured__foot">
        <Chip certainty="planned" size="sm">
          Pendiente de aprobar
        </Chip>
        {mode === 'manual'
          ? 'Firmada por Elvis'
          : 'Origen: formulario por enlace'}
      </p>
    </div>
  );
};

export const SupplierForm: React.FC<{
  initialMode?: SupplierMode;
  onInbox: () => void;
}> = ({initialMode = 'request', onInbox}) => {
  const [mode, setMode] = useState<SupplierMode>(initialMode);
  const [run, setRun] = useState(0);
  const formMode: Mode = mode === 'expired' ? 'request' : mode;
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(formMode));

  const restart = (next: SupplierMode = mode) => {
    setMode(next);
    setDraft(emptyDraft(next === 'expired' ? 'request' : next));
    setRun(r => r + 1);
  };

  const aside = (
    <>
      <p className="lx-eyebrow">F1 · Ofertas y proveedores</p>
      <h1 className="lx-mk-device__title">Formulario del proveedor</h1>
      <p className="lx-mk-device__lead">
        Así lo ve la empresa en su móvil al abrir el enlace personal: una
        conversación guiada, sin instalar nada ni crear una cuenta.
      </p>
      <Segmented<SupplierMode>
        name="sf-mode"
        legend="Cómo llega el proveedor"
        value={mode}
        options={MODE_OPTIONS}
        onChange={m => m && restart(m)}
      />
      {mode !== 'manual' && (
        <div className="lx-mk-link">
          <Icon name="link" size={18} />
          <span>
            <code>oxeye.example/p/7Kq2-mW9x-Lr4T</code>
            <small>
              {mode === 'open'
                ? 'Enlace general para nuevos proveedores'
                : 'Solo sirve para esta solicitud · caduca el 4 dic'}
            </small>
          </span>
        </div>
      )}
      {mode !== 'expired' && <Captured draft={draft} mode={formMode} />}
      <button
        type="button"
        className="lx-btn lx-btn--ghost lx-btn--md"
        onClick={() => restart()}
      >
        <Icon name="refresh" size={18} />
        <span className="lx-btn__label">Reiniciar</span>
      </button>
    </>
  );

  return (
    <PhoneFrame aside={aside}>
      {mode === 'expired' ? (
        <div className="lx-mk-sf">
          <SfHead />
          <div className="lx-mk-sf__body">
            <ExpiredView />
          </div>
        </div>
      ) : (
        <Conversation
          key={`${mode}-${run}`}
          mode={formMode}
          draft={draft}
          setDraft={setDraft}
          onRestart={() => restart()}
          onInbox={onInbox}
        />
      )}
    </PhoneFrame>
  );
};
