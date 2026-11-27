/**
 * The guided proposal form (Revisión 1 · E7), one question group per step,
 * built for a phone: big targets, one decision at a time, «Atrás» always
 * there. Used by the public supplier page (`mode` request / open) and by
 * «Registrar a mano» in the inbox (`manual`: what a supplier said by phone
 * or e-mail, with how it reached us).
 *
 * Steps: start (what is asked, can you?) → company → per product: price,
 * then what it includes → products → tax → dates → review and send. «No
 * puedo» goes straight to a short decline step.
 */
import React, {useEffect, useMemo, useRef, useState} from 'react';
import type {
  LocalDate,
  PriceBasis,
} from '../../../shared/logistics/contracts.ts';
import {
  COMMITMENT_YEARS_MAX,
  COMMITMENT_YEARS_MIN,
  PRICE_BASES,
  PRICE_BASIS_LABEL,
} from '../../../shared/logistics/offer-terms.ts';
import {
  PROPOSAL_MAX_PRODUCTS,
  PROPOSAL_ORIGIN_MAX,
  PROPOSAL_REASON_MAX,
  SUPPLIER_PRIVACY_TEXT,
} from '../../../shared/logistics/proposals.ts';
import {pickRegime, TAX_REGIME_LABEL} from '../budget/tax';
import {dayYear} from '../offers/format';
import {
  Button,
  Chip,
  DateField,
  Field,
  Icon,
  Input,
  Segmented,
  SelectField,
  Textarea,
  describedBy,
} from '../ui';
import {
  allProblems,
  companyProblems,
  EXTRA_LABEL,
  newProduct,
  productProblems,
  taxProblems,
  validityProblems,
  type ExtraKey,
  type ExtraState,
  type ProductDraft,
  type ProposalDraft,
  type Problems,
  type Validity,
} from './draft';

export type FormMode = 'request' | 'open' | 'manual';

const MONTHS = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
];

type Section =
  'Tu empresa' | 'Lo que ofreces' | 'Impuestos y fechas' | 'Revisión';
const SECTIONS: Section[] = [
  'Tu empresa',
  'Lo que ofreces',
  'Impuestos y fechas',
  'Revisión',
];

interface Step {
  id: string;
  section: Section;
  product?: number;
}

/** The steps for the current answers: they change as the form is answered. */
export function stepsFor(draft: ProposalDraft, mode: FormMode): Step[] {
  const out: Step[] = [];
  if (mode === 'request') out.push({id: 'start', section: 'Tu empresa'});
  if (draft.intent === 'no' && mode === 'request') {
    out.push({id: 'decline', section: 'Revisión'});
    return out;
  }
  out.push({id: 'company', section: 'Tu empresa'});
  draft.products.forEach((_, i) => {
    out.push({id: `price:${i}`, section: 'Lo que ofreces', product: i});
    out.push({id: `extras:${i}`, section: 'Lo que ofreces', product: i});
  });
  out.push({id: 'products', section: 'Lo que ofreces'});
  out.push({id: 'tax', section: 'Impuestos y fechas'});
  out.push({id: 'dates', section: 'Impuestos y fechas'});
  out.push({id: 'review', section: 'Revisión'});
  return out;
}

// ---------------------------------------------------------------- small parts

/** Radio cards with a line of explanation each. */
function Choices<T extends string>({
  name,
  legend,
  value,
  options,
  onChange,
  error,
}: {
  name: string;
  legend: React.ReactNode;
  value: T | null;
  options: {value: T; label: string; sub?: string}[];
  onChange: (v: T) => void;
  error?: string;
}) {
  return (
    <fieldset
      className="lx-choices"
      id={name}
      aria-describedby={error ? `${name}-error` : undefined}
    >
      <legend className="lx-field__label">{legend}</legend>
      <div className="lx-choices__list">
        {options.map(o => (
          <label key={o.value} className="lx-choice" data-value={o.value}>
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
            />
            <span className="lx-choice__text">
              <strong>{o.label}</strong>
              {o.sub && <span>{o.sub}</span>}
            </span>
          </label>
        ))}
      </div>
      {error && (
        <p className="lx-field__error" id={`${name}-error`} role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/** Twelve month toggles. */
export const MonthPicker: React.FC<{
  id: string;
  legend: string;
  value: number[];
  onChange: (months: number[]) => void;
  /** Months taken by another season: shown, not pickable. */
  taken?: number[];
  error?: string;
}> = ({id, legend, value, onChange, taken = [], error}) => (
  <fieldset
    className="lx-months"
    id={id}
    aria-describedby={error ? `${id}-error` : undefined}
  >
    <legend className="lx-field__label">{legend}</legend>
    <div className="lx-months__grid">
      {MONTHS.map((m, i) => {
        const month = i + 1;
        const on = value.includes(month);
        const busy = !on && taken.includes(month);
        return (
          <button
            key={m}
            type="button"
            className="lx-months__m"
            aria-pressed={on}
            disabled={busy}
            title={busy ? 'Ya está en otra temporada' : undefined}
            onClick={() =>
              onChange(
                on
                  ? value.filter(x => x !== month)
                  : [...value, month].sort((a, b) => a - b),
              )
            }
          >
            {m}
          </button>
        );
      })}
    </div>
    {error && (
      <p className="lx-field__error" id={`${id}-error`} role="alert">
        {error}
      </p>
    )}
  </fieldset>
);

const BASIS_OPTIONS = PRICE_BASES.map(b => ({
  value: b,
  label: b === 'custom' ? 'Otra unidad' : capitalize(PRICE_BASIS_LABEL[b]),
}));

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const EXTRA_OPTIONS: {value: Exclude<ExtraState, ''>; label: string}[] = [
  {value: 'included', label: 'Incluido'},
  {value: 'extra', label: 'Se cobra aparte'},
  {value: 'no', label: 'No lo hacemos'},
];

const PER_OPTIONS = [
  {value: 'order', label: 'Por pedido'},
  {value: 'unit', label: 'Por unidad'},
  {value: 'day', label: 'Por jornada'},
];

const VALIDITY_OPTIONS: {value: Validity; label: string}[] = [
  {value: '30d', label: '30 días'},
  {value: '3m', label: '3 meses'},
  {value: '6m', label: '6 meses'},
  {value: '1y', label: '1 año'},
  {value: '2y', label: '2 años'},
  {value: 'date', label: 'Hasta una fecha'},
];

const TAX_OPTIONS = [
  {value: 'igic', label: 'IGIC', sub: 'Canarias · 7 % general'},
  {value: 'iva', label: 'IVA', sub: 'Península y Baleares · 21 % general'},
  {value: 'other', label: 'Otro impuesto', sub: 'Por ejemplo IPSI'},
  {value: 'none', label: 'No cobro impuesto', sub: 'Exento o no sujeto'},
  {value: 'unknown', label: 'No lo sé', sub: 'Lo confirmará la organización'},
] as const;

// ---------------------------------------------------------------- the form

export interface ProposalFormProps {
  mode: FormMode;
  draft: ProposalDraft;
  onDraft: (draft: ProposalDraft) => void;
  today: LocalDate;
  /** What is asked (request mode), shown on the first step. */
  intro?: React.ReactNode;
  /** Server problems by draft key, after a failed send. */
  serverProblems?: Problems;
  busy?: boolean;
  onSend: () => void;
  onDecline?: () => void;
  /** Manual mode: leave the sheet. */
  onCancel?: () => void;
  /** Id prefix of every control. */
  idPrefix: string;
  /** Headings inside a sheet are one level lower. */
  headingLevel?: 1 | 2;
}

export const ProposalForm: React.FC<ProposalFormProps> = ({
  mode,
  draft,
  onDraft,
  today,
  intro,
  serverProblems,
  busy,
  onSend,
  onDecline,
  onCancel,
  idPrefix: px,
  headingLevel = 1,
}) => {
  const steps = useMemo(() => stepsFor(draft, mode), [draft, mode]);
  const [stepId, setStepId] = useState(steps[0].id);
  const [problems, setProblems] = useState<Problems>({});
  const headingRef = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  const index = Math.max(
    0,
    steps.findIndex(s => s.id === stepId),
  );
  const step = steps[index];

  // A server rejection: go to the first step with a problem.
  useEffect(() => {
    if (!serverProblems || !Object.keys(serverProblems).length) return;
    setProblems(serverProblems);
    const key = Object.keys(serverProblems)[0];
    const m = /^products\.(\d+)\.(\w+)/.exec(key);
    if (m) {
      const extras = /^(extras|minimumDays|conditions)$/.test(m[2]);
      setStepId(`${extras ? 'extras' : 'price'}:${m[1]}`);
    } else if (key.startsWith('company')) setStepId('company');
    else if (key.startsWith('tax') || key === 'pricesIncludeTax') {
      setStepId('tax');
    } else if (/^(validity|service|commitment|acceptUntil)/.test(key)) {
      setStepId('dates');
    } else setStepId('review');
  }, [serverProblems]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [stepId]);

  const set = (patch: Partial<ProposalDraft>) => {
    onDraft({...draft, ...patch});
    if (Object.keys(problems).length) setProblems({});
  };
  const setProduct = (i: number, patch: Partial<ProductDraft>) =>
    set({
      products: draft.products.map((p, j) => (j === i ? {...p, ...patch} : p)),
    });

  const checkStep = (): Problems => {
    if (step.id === 'company') return companyProblems(draft);
    if (step.id.startsWith('price:') || step.id.startsWith('extras:')) {
      return productProblems(draft, step.product as number);
    }
    if (step.id === 'tax') return taxProblems(draft);
    if (step.id === 'dates') return validityProblems(draft, today);
    if (step.id === 'start' && !draft.intent) {
      return {intent: 'Elige una respuesta.'};
    }
    if (step.id === 'review') {
      const all = allProblems(draft, today);
      if (mode !== 'manual' && !draft.privacy) {
        all.privacy = 'Para enviarla, acepta el tratamiento de los datos.';
      }
      if (mode === 'manual' && !draft.origin.trim()) {
        all.origin = 'Di cómo llegó la oferta (por teléfono, por correo…).';
      }
      return all;
    }
    return {};
  };

  const next = () => {
    const found = checkStep();
    setProblems(found);
    if (Object.keys(found).length) {
      requestAnimationFrame(() => {
        const key = Object.keys(found)[0];
        const el =
          document.getElementById(`${px}-${key.replace(/\./g, '-')}`) ??
          document.querySelector<HTMLElement>(
            `#${px}-step [aria-invalid='true']`,
          );
        el?.focus();
      });
      return;
    }
    if (step.id === 'review') {
      onSend();
      return;
    }
    if (step.id === 'decline') {
      onDecline?.();
      return;
    }
    const after = steps[index + 1];
    if (after) setStepId(after.id);
  };

  const back = () => {
    const before = steps[index - 1];
    if (before) setStepId(before.id);
  };

  const err = (key: string) => problems[key];
  const fid = (key: string) => `${px}-${key.replace(/\./g, '-')}`;
  const H = headingLevel === 1 ? 'h1' : 'h2';
  const heading = (text: string) => (
    <H className="lx-sf__title" ref={headingRef} tabIndex={-1}>
      {text}
    </H>
  );

  // ---------------------------------------------------------------- step bodies
  let body: React.ReactNode;
  const product =
    step.product !== undefined ? draft.products[step.product] : undefined;
  const pi = step.product ?? 0;
  const productLabel =
    draft.products.length > 1
      ? `Producto ${pi + 1} de ${draft.products.length}`
      : 'Lo que ofreces';

  if (step.id === 'start') {
    body = (
      <>
        {heading('¿Puedes atender esta solicitud?')}
        {intro}
        <Choices
          name={`${px}-intent`}
          legend="Tu respuesta"
          value={draft.intent}
          error={err('intent')}
          options={[
            {
              value: 'yes',
              label: 'Sí, puedo',
              sub: 'Te pedimos el precio y las condiciones.',
            },
            {
              value: 'similar',
              label: 'Puedo ofrecer algo parecido',
              sub: 'Cuéntanos qué tienes y a qué precio.',
            },
            {
              value: 'no',
              label: 'No puedo',
              sub: 'Avísanos y no te molestamos más con esta solicitud.',
            },
          ]}
          onChange={v => set({intent: v})}
        />
      </>
    );
  } else if (step.id === 'decline') {
    body = (
      <>
        {heading('Gracias por avisar')}
        <p className="lx-sf__text">
          Le diremos a la organización que esta vez no puedes. Si quieres,
          cuéntale por qué.
        </p>
        <Field id={fid('declineReason')} label="Motivo" optional>
          <Textarea
            id={fid('declineReason')}
            rows={3}
            maxLength={PROPOSAL_REASON_MAX}
            value={draft.declineReason}
            onChange={e => set({declineReason: e.target.value})}
          />
        </Field>
      </>
    );
  } else if (step.id === 'company') {
    body = (
      <>
        {heading(mode === 'manual' ? 'Quién la envía' : 'Tu empresa')}
        {mode === 'manual' && (
          <Field
            id={fid('origin')}
            label="Cómo llegó"
            hint="Por teléfono, por correo, en persona…"
            error={err('origin')}
          >
            <Input
              id={fid('origin')}
              value={draft.origin}
              maxLength={PROPOSAL_ORIGIN_MAX}
              invalid={!!err('origin')}
              aria-describedby={describedBy(fid('origin'), {
                hint: true,
                error: err('origin'),
              })}
              placeholder="Por teléfono"
              onChange={e => set({origin: e.target.value})}
            />
          </Field>
        )}
        <Field
          id={fid('company.name')}
          label="Empresa"
          error={err('company.name')}
        >
          <Input
            id={fid('company.name')}
            value={draft.company.name}
            autoComplete="organization"
            invalid={!!err('company.name')}
            aria-describedby={describedBy(fid('company.name'), {
              error: err('company.name'),
            })}
            onChange={e =>
              set({company: {...draft.company, name: e.target.value}})
            }
          />
        </Field>
        <Field
          id={fid('company.contactName')}
          label="Persona de contacto"
          optional
        >
          <Input
            id={fid('company.contactName')}
            value={draft.company.contactName}
            autoComplete="name"
            onChange={e =>
              set({company: {...draft.company, contactName: e.target.value}})
            }
          />
        </Field>
        <div className="lx-sf__row">
          <Field
            id={fid('company.phone')}
            label="Teléfono"
            optional
            error={err('company.phone')}
          >
            <Input
              id={fid('company.phone')}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={draft.company.phone}
              invalid={!!err('company.phone')}
              onChange={e =>
                set({company: {...draft.company, phone: e.target.value}})
              }
            />
          </Field>
          <Field
            id={fid('company.email')}
            label="Correo"
            optional
            error={err('company.email')}
          >
            <Input
              id={fid('company.email')}
              type="email"
              inputMode="email"
              autoComplete="email"
              value={draft.company.email}
              invalid={!!err('company.email')}
              aria-describedby={describedBy(fid('company.email'), {
                error: err('company.email'),
              })}
              onChange={e =>
                set({company: {...draft.company, email: e.target.value}})
              }
            />
          </Field>
        </div>
      </>
    );
  } else if (step.id.startsWith('price:') && product) {
    const k = (f: string) => `products.${pi}.${f}`;
    const takenBy = (j: number) =>
      product.seasons.filter((_, x) => x !== j).flatMap(s => s.months);
    body = (
      <>
        <p className="lx-sf__kicker">{productLabel}</p>
        {heading('Qué ofreces y a qué precio')}
        <Field
          id={fid(k('name'))}
          label="Qué es"
          hint="Como lo pondrías en una factura."
          error={err(k('name'))}
        >
          <Input
            id={fid(k('name'))}
            value={product.name}
            invalid={!!err(k('name'))}
            aria-describedby={describedBy(fid(k('name')), {
              hint: true,
              error: err(k('name')),
            })}
            placeholder="Carpa de 6 × 6 m"
            onChange={e => setProduct(pi, {name: e.target.value})}
          />
        </Field>
        <Field id={fid(k('description'))} label="Detalles" optional>
          <Textarea
            id={fid(k('description'))}
            rows={2}
            value={product.description}
            onChange={e => setProduct(pi, {description: e.target.value})}
          />
        </Field>
        <div className="lx-sf__row">
          <Field id={fid(k('basis'))} label="Cómo lo cobras">
            <SelectField
              id={fid(k('basis'))}
              value={product.basis}
              options={BASIS_OPTIONS}
              onChange={v => setProduct(pi, {basis: v as PriceBasis})}
            />
          </Field>
          <Field
            id={fid(k('price'))}
            label="Precio sin impuestos"
            optional
            error={err(k('price'))}
          >
            <span className="lx-money">
              <Input
                id={fid(k('price'))}
                inputMode="decimal"
                className="lx-num"
                value={product.price}
                invalid={!!err(k('price'))}
                aria-describedby={describedBy(fid(k('price')), {
                  error: err(k('price')),
                })}
                placeholder="0,00"
                onChange={e => setProduct(pi, {price: e.target.value})}
              />
              <span className="lx-money__unit" aria-hidden="true">
                €
              </span>
            </span>
          </Field>
        </div>
        {product.basis === 'custom' && (
          <Field
            id={fid(k('customUnit'))}
            label="Unidad"
            error={err(k('customUnit'))}
          >
            <Input
              id={fid(k('customUnit'))}
              value={product.customUnit}
              placeholder="por escenario"
              invalid={!!err(k('customUnit'))}
              onChange={e => setProduct(pi, {customUnit: e.target.value})}
            />
          </Field>
        )}
        <Field
          id={fid(k('available'))}
          label="Cuántas unidades tienes"
          optional
          error={err(k('available'))}
        >
          <Input
            id={fid(k('available'))}
            inputMode="numeric"
            className="lx-num"
            value={product.available}
            invalid={!!err(k('available'))}
            onChange={e => setProduct(pi, {available: e.target.value})}
          />
        </Field>
        <Segmented<'no' | 'yes'>
          name={`${px}-seasonal-${pi}`}
          legend="¿Cambia el precio según la temporada?"
          value={product.seasonal ? 'yes' : 'no'}
          options={[
            {value: 'no', label: 'No, es siempre el mismo'},
            {value: 'yes', label: 'Sí'},
          ]}
          onChange={v => setProduct(pi, {seasonal: v === 'yes'})}
        />
        {product.seasonal && (
          <div className="lx-sf__seasons" id={fid(k('seasons'))}>
            {err(k('seasons')) && (
              <p className="lx-field__error" role="alert">
                {err(k('seasons'))}
              </p>
            )}
            {product.seasons.map((s, j) => (
              <div className="lx-sf__season" key={j}>
                <Field id={fid(k(`seasons.${j}.label`))} label="Temporada">
                  <Input
                    id={fid(k(`seasons.${j}.label`))}
                    value={s.label}
                    onChange={e =>
                      setProduct(pi, {
                        seasons: product.seasons.map((x, y) =>
                          y === j ? {...x, label: e.target.value} : x,
                        ),
                      })
                    }
                  />
                </Field>
                <MonthPicker
                  id={fid(k(`seasons.${j}.months`))}
                  legend="Meses"
                  value={s.months}
                  taken={takenBy(j)}
                  onChange={months =>
                    setProduct(pi, {
                      seasons: product.seasons.map((x, y) =>
                        y === j ? {...x, months} : x,
                      ),
                    })
                  }
                />
                <Field
                  id={fid(k(`seasons.${j}.price`))}
                  label="Precio en esa temporada"
                  error={err(k(`seasons.${j}.price`))}
                >
                  <span className="lx-money">
                    <Input
                      id={fid(k(`seasons.${j}.price`))}
                      inputMode="decimal"
                      className="lx-num"
                      value={s.price}
                      invalid={!!err(k(`seasons.${j}.price`))}
                      onChange={e =>
                        setProduct(pi, {
                          seasons: product.seasons.map((x, y) =>
                            y === j ? {...x, price: e.target.value} : x,
                          ),
                        })
                      }
                    />
                    <span className="lx-money__unit" aria-hidden="true">
                      €
                    </span>
                  </span>
                </Field>
              </div>
            ))}
            <p className="lx-field__hint">
              Los meses sin temporada usan el precio de arriba. Deja una
              temporada sin meses si no la usas.
            </p>
          </div>
        )}
      </>
    );
  } else if (step.id.startsWith('extras:') && product) {
    const k = (f: string) => `products.${pi}.${f}`;
    body = (
      <>
        <p className="lx-sf__kicker">{productLabel}</p>
        {heading(`Qué incluye: ${product.name.trim() || 'tu oferta'}`)}
        {(Object.keys(EXTRA_LABEL) as ExtraKey[]).map(key => {
          const e = product.extras[key];
          const setExtra = (patch: Partial<typeof e>) =>
            setProduct(pi, {
              extras: {...product.extras, [key]: {...e, ...patch}},
            });
          return (
            <div className="lx-sf__extra" key={key} data-extra={key}>
              <Segmented<Exclude<ExtraState, ''>>
                name={`${px}-extra-${pi}-${key}`}
                legend={EXTRA_LABEL[key]}
                value={e.state || null}
                options={EXTRA_OPTIONS}
                onChange={v => setExtra({state: v ?? ''})}
              />
              {e.state === 'extra' && (
                <div className="lx-sf__row">
                  <Field
                    id={fid(k(`extras.${key}.price`))}
                    label="Precio"
                    optional
                    hint="Si no lo sabes, déjalo vacío: quedará «sin precio»."
                    error={err(k(`extras.${key}.price`))}
                  >
                    <span className="lx-money">
                      <Input
                        id={fid(k(`extras.${key}.price`))}
                        inputMode="decimal"
                        className="lx-num"
                        value={e.price}
                        invalid={!!err(k(`extras.${key}.price`))}
                        onChange={ev => setExtra({price: ev.target.value})}
                      />
                      <span className="lx-money__unit" aria-hidden="true">
                        €
                      </span>
                    </span>
                  </Field>
                  <Field id={fid(k(`extras.${key}.per`))} label="Se cobra">
                    <SelectField
                      id={fid(k(`extras.${key}.per`))}
                      value={e.per}
                      options={PER_OPTIONS}
                      onChange={v => setExtra({per: v as typeof e.per})}
                    />
                  </Field>
                </div>
              )}
            </div>
          );
        })}
        <Field
          id={fid(k('minimumDays'))}
          label="Mínimo de jornadas que cobras"
          optional
          error={err(k('minimumDays'))}
        >
          <Input
            id={fid(k('minimumDays'))}
            inputMode="numeric"
            className="lx-num"
            value={product.minimumDays}
            invalid={!!err(k('minimumDays'))}
            onChange={e => setProduct(pi, {minimumDays: e.target.value})}
          />
        </Field>
        <Field
          id={fid(k('conditions'))}
          label="Condiciones de este producto"
          optional
        >
          <Textarea
            id={fid(k('conditions'))}
            rows={2}
            value={product.conditions}
            placeholder="Necesita toma de agua, el suelo tiene que ser firme…"
            onChange={e => setProduct(pi, {conditions: e.target.value})}
          />
        </Field>
      </>
    );
  } else if (step.id === 'products') {
    body = (
      <>
        {heading('¿Algo más?')}
        <ul className="lx-sf__products">
          {draft.products.map((p, i) => (
            <li key={p.key}>
              <span>
                <strong>{p.name.trim() || `Producto ${i + 1}`}</strong>
                <span className="lx-muted lx-num">
                  {p.price.trim()
                    ? `${p.price.trim()} € ${p.basis === 'custom' ? p.customUnit : PRICE_BASIS_LABEL[p.basis]}`
                    : 'Sin precio'}
                </span>
              </span>
              <span className="lx-sf__products-actions">
                <Button
                  size="sm"
                  variant="ghost"
                  icon="edit"
                  onClick={() => setStepId(`price:${i}`)}
                >
                  Cambiar
                </Button>
                {draft.products.length > 1 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="trash"
                    aria-label={`Quitar ${p.name.trim() || `el producto ${i + 1}`}`}
                    onClick={() =>
                      set({products: draft.products.filter((_, j) => j !== i)})
                    }
                  >
                    Quitar
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
        {draft.products.length < PROPOSAL_MAX_PRODUCTS && (
          <Button
            icon="plus"
            id={`${px}-add-product`}
            onClick={() => {
              const products = [...draft.products, newProduct()];
              onDraft({...draft, products});
              setStepId(`price:${products.length - 1}`);
            }}
          >
            Añadir otro producto o servicio
          </Button>
        )}
      </>
    );
  } else if (step.id === 'tax') {
    const regime = draft.tax.regime;
    const hasRate = regime === 'igic' || regime === 'iva' || regime === 'other';
    body = (
      <>
        {heading('Impuestos')}
        <Choices
          name={`${px}-tax`}
          legend="¿Qué impuesto aplicas?"
          value={regime || null}
          error={err('tax.regime')}
          options={TAX_OPTIONS.map(o => ({...o}))}
          onChange={v => set({tax: pickRegime(draft.tax, v)})}
        />
        {regime === 'other' && (
          <Field
            id={fid('tax.name')}
            label="Nombre del impuesto"
            error={err('tax.name')}
          >
            <Input
              id={fid('tax.name')}
              value={draft.tax.name}
              invalid={!!err('tax.name')}
              placeholder="IPSI"
              onChange={e => set({tax: {...draft.tax, name: e.target.value}})}
            />
          </Field>
        )}
        {hasRate && (
          <Field
            id={fid('tax.rate')}
            label={`Porcentaje de ${regime === 'other' ? draft.tax.name.trim() || 'impuesto' : TAX_REGIME_LABEL[regime]}`}
            optional
            error={err('tax.rate')}
          >
            <span className="lx-money lx-money--rate">
              <Input
                id={fid('tax.rate')}
                inputMode="decimal"
                className="lx-num"
                value={draft.tax.rate}
                invalid={!!err('tax.rate')}
                onChange={e => set({tax: {...draft.tax, rate: e.target.value}})}
              />
              <span className="lx-money__unit" aria-hidden="true">
                %
              </span>
            </span>
          </Field>
        )}
        <Segmented<'no' | 'yes' | 'unknown'>
          name={`${px}-included`}
          legend="Los precios que has escrito…"
          value={draft.pricesIncludeTax}
          options={[
            {value: 'no', label: 'No llevan impuesto'},
            {value: 'yes', label: 'Ya llevan el impuesto'},
          ]}
          onChange={v => v && set({pricesIncludeTax: v})}
        />
      </>
    );
  } else if (step.id === 'dates') {
    body = (
      <>
        {heading('Fechas')}
        <p className="lx-sf__text">
          Son tres cosas distintas: hasta cuándo se puede aceptar tu oferta,
          cuándo puedes prestar el servicio y si ofreces un precio por contratar
          varios años.
        </p>
        <Segmented<Validity>
          name={`${px}-validity`}
          legend="Tu oferta se puede aceptar durante"
          value={draft.validity}
          options={VALIDITY_OPTIONS}
          onChange={v => set({validity: v})}
        />
        {draft.validity === 'date' && (
          <Field
            id={fid('validityDate')}
            label="Hasta el"
            error={err('validityDate')}
          >
            <DateField
              id={fid('validityDate')}
              value={draft.validityDate}
              min={today}
              today={today}
              invalid={!!err('validityDate')}
              onChange={v => set({validityDate: v})}
            />
          </Field>
        )}
        <Segmented<'all' | 'months' | 'unknown'>
          name={`${px}-service`}
          legend="¿Cuándo puedes prestar el servicio?"
          value={draft.service}
          options={[
            {value: 'all', label: 'Todo el año'},
            {value: 'months', label: 'Solo algunos meses'},
            {value: 'unknown', label: 'Depende, lo hablamos'},
          ]}
          onChange={v => set({service: v})}
        />
        {draft.service === 'months' && (
          <MonthPicker
            id={fid('serviceMonths')}
            legend="Meses en los que puedes"
            value={draft.serviceMonths}
            error={err('serviceMonths')}
            onChange={months => set({serviceMonths: months})}
          />
        )}
        <Field
          id={fid('serviceNote')}
          label="Algo que debamos saber de las fechas"
          optional
        >
          <Input
            id={fid('serviceNote')}
            value={draft.serviceNote}
            placeholder="En agosto, solo fines de semana"
            onChange={e => set({serviceNote: e.target.value})}
          />
        </Field>
        <Segmented<'no' | 'yes'>
          name={`${px}-commitment`}
          legend="¿Mejoras el precio si se contrata varios años?"
          value={draft.commitment}
          options={[
            {value: 'no', label: 'No'},
            {value: 'yes', label: 'Sí'},
          ]}
          onChange={v => v && set({commitment: v})}
        />
        {draft.commitment === 'yes' && (
          <div className="lx-sf__commitment">
            <Field
              id={fid('commitmentYears')}
              label="Años de compromiso"
              hint={`De ${COMMITMENT_YEARS_MIN} a ${COMMITMENT_YEARS_MAX}.`}
              error={err('commitmentYears')}
            >
              <Input
                id={fid('commitmentYears')}
                inputMode="numeric"
                className="lx-num"
                value={draft.commitmentYears}
                invalid={!!err('commitmentYears')}
                onChange={e => set({commitmentYears: e.target.value})}
              />
            </Field>
            {draft.products.map((p, i) => (
              <Field
                key={p.key}
                id={fid(`products.${i}.commitmentPrice`)}
                label={`Precio con compromiso · ${p.name.trim() || `producto ${i + 1}`}`}
                optional
                error={err(`products.${i}.commitmentPrice`)}
              >
                <span className="lx-money">
                  <Input
                    id={fid(`products.${i}.commitmentPrice`)}
                    inputMode="decimal"
                    className="lx-num"
                    value={p.commitmentPrice}
                    invalid={!!err(`products.${i}.commitmentPrice`)}
                    onChange={e =>
                      setProduct(i, {commitmentPrice: e.target.value})
                    }
                  />
                  <span className="lx-money__unit" aria-hidden="true">
                    €
                  </span>
                </span>
              </Field>
            ))}
          </div>
        )}
      </>
    );
  } else {
    // review
    const issues = Object.entries(problems).filter(
      ([k]) => k !== 'privacy' && k !== 'origin',
    );
    body = (
      <>
        {heading('Revisa y envía')}
        <dl className="lx-sf__summary">
          <div>
            <dt>Empresa</dt>
            <dd>{draft.company.name || '—'}</dd>
          </div>
          {draft.products.map((p, i) => (
            <div key={p.key}>
              <dt>
                {draft.products.length > 1 ? `Producto ${i + 1}` : 'Ofreces'}
              </dt>
              <dd className="lx-num">
                {p.name || '—'} ·{' '}
                {p.price.trim()
                  ? `${p.price.trim()} € ${p.basis === 'custom' ? p.customUnit : PRICE_BASIS_LABEL[p.basis]}`
                  : 'sin precio'}
                {p.seasonal && ' · con temporadas'}
              </dd>
            </div>
          ))}
          <div>
            <dt>Impuesto</dt>
            <dd>
              {draft.tax.regime
                ? `${TAX_REGIME_LABEL[draft.tax.regime]}${draft.tax.rate ? ` ${draft.tax.rate} %` : ''}`
                : 'Sin indicar'}
              {' · '}
              {draft.pricesIncludeTax === 'yes'
                ? 'precios con impuesto'
                : 'precios sin impuesto'}
            </dd>
          </div>
          <div>
            <dt>Se puede aceptar</dt>
            <dd>
              {draft.validity
                ? draft.validity === 'date'
                  ? `hasta el ${draft.validityDate ? dayYear(draft.validityDate) : '—'}`
                  : `durante ${VALIDITY_OPTIONS.find(o => o.value === draft.validity)?.label}`
                : 'Sin fecha límite'}
            </dd>
          </div>
        </dl>
        {issues.length > 0 && (
          <ul className="lx-sf__issues" role="alert">
            {issues.map(([k, msg]) => (
              <li key={k}>
                <Icon name="alert" size={15} /> {msg}
              </li>
            ))}
          </ul>
        )}
        <Field id={fid('conditions')} label="Otras condiciones" optional>
          <Textarea
            id={fid('conditions')}
            rows={3}
            value={draft.conditions}
            placeholder="Forma de pago, plazos de montaje…"
            onChange={e => set({conditions: e.target.value})}
          />
        </Field>
        {mode !== 'manual' ? (
          <div className="lx-sf__privacy">
            <p className="lx-sf__privacy-head">
              Tus datos
              <Chip tag tone="neutral" size="sm">
                Texto pendiente de revisión legal
              </Chip>
            </p>
            <p className="lx-sf__privacy-text" id={`${px}-privacy-text`}>
              {SUPPLIER_PRIVACY_TEXT}
            </p>
            <label className="lx-check" htmlFor={fid('privacy')}>
              <input
                type="checkbox"
                id={fid('privacy')}
                checked={draft.privacy}
                aria-invalid={!!err('privacy') || undefined}
                aria-describedby={`${px}-privacy-text${err('privacy') ? ` ${fid('privacy')}-error` : ''}`}
                onChange={e => set({privacy: e.target.checked})}
              />
              <span>
                Acepto que la organización use estos datos para estudiar mi
                oferta.
              </span>
            </label>
            {err('privacy') && (
              <p
                className="lx-field__error"
                id={`${fid('privacy')}-error`}
                role="alert"
              >
                {err('privacy')}
              </p>
            )}
          </div>
        ) : (
          <>
            <Field id={fid('origin')} label="Cómo llegó" error={err('origin')}>
              <Input
                id={fid('origin')}
                value={draft.origin}
                invalid={!!err('origin')}
                onChange={e => set({origin: e.target.value})}
              />
            </Field>
            <p className="lx-field__hint">
              Quedará pendiente de un administrador, igual que las que llegan
              por enlace.
            </p>
          </>
        )}
      </>
    );
  }

  const sectionIndex = SECTIONS.indexOf(step.section);
  const isFirst = index === 0;
  const nextLabel =
    step.id === 'review'
      ? mode === 'manual'
        ? 'Guardar propuesta'
        : 'Enviar propuesta'
      : step.id === 'decline'
        ? 'Enviar respuesta'
        : 'Siguiente';

  return (
    <div className="lx-sf" data-step={step.id} id={`${px}-form`}>
      <div
        className="lx-sf__progress"
        aria-hidden={step.id === 'decline' || undefined}
      >
        <ol className="lx-sf__sections">
          {SECTIONS.map((s, i) => (
            <li
              key={s}
              data-state={
                i < sectionIndex ? 'done' : i === sectionIndex ? 'now' : 'next'
              }
              aria-current={i === sectionIndex ? 'step' : undefined}
            >
              <span>{s}</span>
            </li>
          ))}
        </ol>
        <p className="lx-visually-hidden" aria-live="polite">
          Paso {index + 1} de {steps.length}: {step.section}
        </p>
      </div>
      <form
        className="lx-sf__step"
        id={`${px}-step`}
        noValidate
        onSubmit={e => {
          e.preventDefault();
          next();
        }}
      >
        {body}
        <div className="lx-sf__foot">
          {isFirst ? (
            onCancel ? (
              <Button variant="ghost" onClick={onCancel}>
                Cancelar
              </Button>
            ) : (
              <span />
            )
          ) : (
            <Button
              variant="ghost"
              icon="chevronLeft"
              onClick={back}
              id={`${px}-back`}
            >
              Atrás
            </Button>
          )}
          <Button
            type="submit"
            variant={step.id === 'decline' ? 'danger' : 'primary'}
            icon={step.id === 'review' ? 'send' : undefined}
            busy={busy}
            id={`${px}-next`}
            size="lg"
          >
            {nextLabel}
          </Button>
        </div>
      </form>
    </div>
  );
};
