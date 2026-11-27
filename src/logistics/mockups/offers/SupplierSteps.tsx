/**
 * One screen per step of the supplier's guided conversation. Each step asks
 * one thing (or two closely related ones) with large answer cards; follow-up
 * questions appear in place when an answer needs them.
 */
import React from 'react';
import {Chip, DateField, Field, Icon, Input, Textarea} from '../../ui';
import {
  CATEGORIES,
  CATEGORY_LABEL,
  EVENT,
  MOCK_TODAY,
  ORG_SHORT,
  type CategoryId,
  type TaxKind,
} from '../data';
import {addDays, addMonths, fmtDay} from '../dates';
import {Glyph} from '../glyphs';
import {
  ChoiceCards,
  MoneyInput,
  NumberStepper,
  parseMoney,
  type ChoiceOption,
} from '../kit';
import {eur} from '../pricing';
import {
  PRICE_UNIT_SHORT,
  productTitle,
  specFor,
  type Draft,
  type Mode,
  type ProductDraft,
  type Question,
  type Step,
  type Value,
} from './supplierFlow';

export interface StepProps {
  step: Step;
  draft: Draft;
  mode: Mode;
  update: (patch: Partial<Draft>) => void;
  setProduct: (key: string, field: string, value: Value) => void;
  go: (id: string) => void;
  next: () => void;
  addProduct: (category: CategoryId) => void;
  removeProduct: (key: string) => void;
  toggleCategory: (category: CategoryId) => void;
}

export const REQUEST = {
  title: '3 carpas de 6 × 6 m',
  quantity: 3,
  days: 4,
  answerBy: '4 dic',
};

/** The «OxEye says» line at the top of each step. */
export const Say: React.FC<{
  lead?: React.ReactNode;
  children: React.ReactNode;
  headingRef?: React.Ref<HTMLHeadingElement>;
}> = ({lead, children, headingRef}) => (
  <div className="lx-mk-say">
    {lead && <p className="lx-mk-say__lead">{lead}</p>}
    <h2 className="lx-mk-say__q" tabIndex={-1} ref={headingRef}>
      {children}
    </h2>
  </div>
);

// ---------------------------------------------------------------- questions

const QuestionView: React.FC<{
  q: Question;
  product: ProductDraft;
  setProduct: StepProps['setProduct'];
  label?: string;
}> = ({q, product, setProduct, label}) => {
  const id = `sf-${product.key}-${q.key}`;
  const value = product.v[q.key] ?? null;
  const set = (v: Value) => setProduct(product.key, q.key, v);
  switch (q.kind) {
    case 'choice':
      return (
        <div className="lx-mk-q">
          <ChoiceCards<string>
            name={id}
            legend={label ?? q.label}
            options={q.options ?? []}
            value={value === null ? null : String(value)}
            onChange={set}
            columns={q.columns}
          />
          {q.hint && <p className="lx-field__hint">{q.hint}</p>}
        </div>
      );
    case 'number':
      return (
        <NumberStepper
          id={id}
          label={label ?? q.label}
          value={Number(value ?? 0)}
          onChange={set}
          unit={q.unit}
          hint={q.hint}
        />
      );
    case 'money':
      return (
        <MoneyInput
          id={id}
          label={label ?? q.label}
          value={value === null ? '' : String(value)}
          onChange={set}
          hint={q.hint}
          big={q.key === 'price'}
        />
      );
    default:
      return (
        <Field id={id} label={label ?? q.label} hint={q.hint}>
          <Input
            id={id}
            value={value === null ? '' : String(value)}
            onChange={e => set(e.target.value)}
            aria-describedby={q.hint ? `${id}-hint` : undefined}
          />
        </Field>
      );
  }
};

function productIndex(draft: Draft, key: string): number {
  return draft.products.findIndex(p => p.key === key);
}

/** Estimated total of what was requested, from the supplier's answers. */
export function requestEstimate(draft: Draft): {
  beforeTax: number;
  tax: number | null;
  taxLabel: string | null;
  lines: string[];
} | null {
  const p = draft.products.find(x => x.category === 'carpas');
  const unit = parseMoney(String(p?.v.price ?? ''));
  if (!p || unit === null) return null;
  const q = REQUEST.quantity;
  const days = REQUEST.days;
  const pu = String(p.v.priceUnit ?? 'unit_day');
  const priceTotal =
    pu === 'order' ? unit : pu === 'unit_event' ? q * unit : q * days * unit;
  const lines = [
    pu === 'order'
      ? `Pedido completo: ${eur(unit)}`
      : pu === 'unit_event'
        ? `${q} carpas × ${eur(unit)} = ${eur(priceTotal)}`
        : `${q} carpas × ${days} jornadas × ${eur(unit)} = ${eur(priceTotal)}`,
  ];
  let total = priceTotal;
  const assembly = parseMoney(String(p.v.assemblyPrice ?? ''));
  if (p.v.assembly === 'extra' && assembly !== null) {
    total += q * assembly;
    lines.push(`Montaje: ${q} × ${eur(assembly)} = ${eur(q * assembly)}`);
  }
  const transport = parseMoney(String(p.v.transportPrice ?? ''));
  if (p.v.transport === 'extra' && transport !== null) {
    total += transport;
    lines.push(`Transporte: ${eur(transport)}`);
  }
  const rate = parseMoney(draft.taxRate);
  const known = (draft.tax === 'igic' || draft.tax === 'iva') && rate !== null;
  return {
    beforeTax: total,
    tax: known ? (total * (rate ?? 0)) / 100 : draft.tax === 'none' ? 0 : null,
    taxLabel: known
      ? `${draft.tax === 'igic' ? 'IGIC' : 'IVA'} ${draft.taxRate} %`
      : draft.tax === 'none'
        ? 'Sin impuesto'
        : null,
    lines,
  };
}

// ---------------------------------------------------------------- steps

export const StartStep: React.FC<
  StepProps & {headingRef: React.Ref<HTMLHeadingElement>}
> = ({draft, mode, update, next, headingRef}) => {
  if (mode === 'manual') {
    return (
      <>
        <Say lead="Registrar una oferta a mano" headingRef={headingRef}>
          ¿Cómo te ha llegado esta oferta?
        </Say>
        <p className="lx-mk-sf__text">
          Usa las mismas preguntas que el proveedor. Quedará como propuesta
          pendiente de aprobar, firmada con tu nombre.
        </p>
        <ChoiceCards
          name="sf-origin"
          legend="Origen de la oferta"
          hideLegend
          columns={2}
          value={draft.origin}
          onChange={v => update({origin: v})}
          options={[
            {value: 'phone', label: 'Por teléfono', icon: 'phone'},
            {value: 'mail', label: 'Por correo', icon: 'mail'},
            {value: 'person', label: 'En persona', icon: 'user'},
            {value: 'doc', label: 'En un documento', icon: 'note'},
          ]}
        />
      </>
    );
  }
  if (mode === 'open') {
    return (
      <>
        <Say lead={`Hola. Te escribe el ${ORG_SHORT}.`} headingRef={headingRef}>
          Cuéntanos qué ofreces para nuestros eventos
        </Say>
        <p className="lx-mk-sf__text">
          Solo te preguntaremos lo que tenga que ver con tu actividad. Si algo
          no lo sabes, déjalo en blanco.
        </p>
        <ul className="lx-mk-sf__promise">
          <li>
            <Icon name="clock" size={18} /> Unos 3 minutos
          </li>
          <li>
            <Icon name="lock" size={18} /> No hace falta instalar nada ni crear
            una cuenta
          </li>
          <li>
            <Icon name="check" size={18} /> Revisas todo antes de enviarlo
          </li>
        </ul>
      </>
    );
  }
  const options: ChoiceOption<'yes' | 'similar' | 'no'>[] = [
    {value: 'yes', label: 'Sí, puedo ofrecerlo', icon: 'check'},
    {
      value: 'similar',
      label: 'Puedo ofrecer algo parecido',
      sub: 'Otra medida, otra cantidad u otras fechas',
      icon: 'edit',
    },
    {value: 'no', label: 'Esta vez no puedo', icon: 'close'},
  ];
  return (
    <>
      <Say
        lead={`Hola, Mario. Te escribe el ${ORG_SHORT}.`}
        headingRef={headingRef}
      >
        Te pedimos presupuesto para:
      </Say>
      <article className="lx-mk-request" aria-label="Lo que te pedimos">
        <span className="lx-mk-request__icon" aria-hidden="true">
          <Glyph name="carpas" size={30} />
        </span>
        <div className="lx-mk-request__text">
          <strong>{REQUEST.title}</strong>
          <span className="lx-num">
            {REQUEST.days} jornadas · {EVENT.dates} 2026
          </span>
          <span>
            {EVENT.venue} · {EVENT.name}
          </span>
        </div>
      </article>
      <p className="lx-mk-sf__meta">
        <Icon name="clock" size={16} /> Responde antes del {REQUEST.answerBy} ·
        unos 3 minutos
      </p>
      <ChoiceCards
        name="sf-intent"
        legend="¿Puedes ofrecerlo?"
        value={draft.intent}
        onChange={v => {
          update({intent: v});
          window.setTimeout(next, 180);
        }}
        options={options}
      />
      <p className="lx-mk-sf__small">
        Te escribimos como <strong>{draft.company.name}</strong> (
        {draft.company.contact}). Si no eres tú, responde al correo que te
        llegó.
      </p>
    </>
  );
};

export const DeclineStep: React.FC<
  StepProps & {headingRef: React.Ref<HTMLHeadingElement>}
> = ({draft, update, headingRef}) => (
  <>
    <Say lead="Gracias por decírnoslo." headingRef={headingRef}>
      ¿Nos cuentas por qué? Nos ayuda a pedirte mejor la próxima vez
    </Say>
    <ChoiceCards
      name="sf-decline"
      legend="Motivo"
      hideLegend
      value={draft.decline}
      onChange={v => update({decline: v})}
      options={[
        {value: 'dates', label: 'No tengo disponibilidad esas fechas'},
        {value: 'qty', label: 'No tengo tantas unidades'},
        {value: 'notmine', label: 'No trabajo con esto'},
        {value: 'other', label: 'Otro motivo'},
      ]}
    />
    <Field id="sf-decline-note" label="¿Algo más?" optional>
      <Textarea
        id="sf-decline-note"
        rows={3}
        value={draft.notes}
        onChange={e => update({notes: e.target.value})}
      />
    </Field>
  </>
);

export const ContactStep: React.FC<
  StepProps & {headingRef: React.Ref<HTMLHeadingElement>}
> = ({draft, mode, update, headingRef}) => {
  const c = draft.company;
  const set = (k: keyof Draft['company'], v: string) =>
    update({company: {...c, [k]: v}});
  return (
    <>
      <Say
        lead={mode === 'manual' ? 'Proveedor' : 'Encantados.'}
        headingRef={headingRef}
      >
        {mode === 'manual' ? '¿De qué empresa es?' : '¿Quién eres?'}
      </Say>
      <div className="lx-mk-stack">
        <Field id="sf-company" label="Empresa">
          <Input
            id="sf-company"
            autoComplete="organization"
            value={c.name}
            list={mode === 'manual' ? 'sf-companies' : undefined}
            onChange={e => set('name', e.target.value)}
          />
        </Field>
        {mode === 'manual' && (
          <datalist id="sf-companies">
            <option value="Carpas Mario Demo" />
            <option value="Toldos Atlántico Demo" />
            <option value="Limpiezas Aguere Demo" />
          </datalist>
        )}
        <Field id="sf-person" label="Persona de contacto" optional>
          <Input
            id="sf-person"
            autoComplete="name"
            value={c.contact}
            onChange={e => set('contact', e.target.value)}
          />
        </Field>
        <Field id="sf-phone" label="Teléfono" optional>
          <Input
            id="sf-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+34 000 000 000"
            value={c.phone}
            onChange={e => set('phone', e.target.value)}
          />
        </Field>
        <Field id="sf-email" label="Correo" optional>
          <Input
            id="sf-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="nombre@example.com"
            value={c.email}
            onChange={e => set('email', e.target.value)}
          />
        </Field>
      </div>
    </>
  );
};

export const CategoriesStep: React.FC<
  StepProps & {headingRef: React.Ref<HTMLHeadingElement>}
> = ({draft, mode, toggleCategory, headingRef}) => (
  <>
    <Say
      lead={
        mode === 'request'
          ? 'Lo que te pedimos ya está marcado.'
          : 'Elige una o varias.'
      }
      headingRef={headingRef}
    >
      {mode === 'request'
        ? '¿Ofreces algo más que nos pueda servir?'
        : '¿A qué te dedicas?'}
    </Say>
    <ChoiceCards<CategoryId>
      name="sf-cat"
      legend="Actividades"
      hideLegend
      multiple
      columns={3}
      value={draft.categories}
      onChange={toggleCategory}
      options={CATEGORIES.map(c => ({
        value: c.id,
        label: c.label,
        sub:
          mode === 'request' && c.id === 'carpas'
            ? 'Lo que te pedimos'
            : c.hint,
        glyph: <Glyph name={c.id} size={26} />,
        locked: mode === 'request' && c.id === 'carpas',
      }))}
    />
    {draft.categories.length === 0 && (
      <p className="lx-field__hint" role="status">
        Elige al menos una para seguir.
      </p>
    )}
  </>
);

const WHAT_Q: Partial<Record<CategoryId, string>> = {
  carpas: '¿Cómo son tus carpas?',
  limpieza: '¿Cómo es tu servicio de limpieza?',
  sonido: '¿Qué equipo de sonido ofreces?',
  ocio: '¿Qué ofreces?',
};

export const ProductStep: React.FC<
  StepProps & {headingRef: React.Ref<HTMLHeadingElement>}
> = ({step, draft, mode, setProduct, headingRef}) => {
  const product = draft.products.find(p => p.key === step.product?.key);
  if (!product || !step.part) return null;
  const i = productIndex(draft, product.key);
  const spec = specFor(product.category);
  const category = CATEGORY_LABEL[product.category];
  const counter =
    draft.products.length > 1
      ? `Producto ${i + 1} de ${draft.products.length}`
      : category;
  const fromRequest =
    mode === 'request' && product.category === 'carpas' && i === 0;

  if (step.part === 'conditions') {
    return (
      <ConditionsPart
        product={product}
        setProduct={setProduct}
        headingRef={headingRef}
        counter={counter}
      />
    );
  }

  const questions = spec[step.part].filter(
    q => !q.showIf || q.showIf(product.v),
  );
  const priceUnit = String(product.v.priceUnit ?? '');
  const title =
    step.part === 'what'
      ? (WHAT_Q[product.category] ?? '¿Qué ofreces exactamente?')
      : step.part === 'price'
        ? '¿Cuánto cuesta?'
        : '¿Qué incluye el precio?';

  const estimate =
    fromRequest && step.part !== 'what' ? requestEstimate(draft) : null;

  return (
    <>
      <Say
        lead={
          <>
            <span className="lx-mk-say__chip">{counter}</span>
            {step.part !== 'what' ? (
              <> {productTitle(product)}</>
            ) : (
              draft.products.length > 1 && <> {category}</>
            )}
          </>
        }
        headingRef={headingRef}
      >
        {title}
      </Say>
      {fromRequest && step.part === 'what' && (
        <p className="lx-mk-sf__asked">
          <Icon name="link" size={16} /> Te pedimos {REQUEST.title}. Si tienes
          otra medida o menos unidades, cámbialo.
        </p>
      )}
      <div className="lx-mk-stack">
        {questions.map(q => (
          <QuestionView
            key={q.key}
            q={q}
            product={product}
            setProduct={setProduct}
            label={
              q.key === 'price' && priceUnit
                ? `${q.label} ${PRICE_UNIT_SHORT[priceUnit] ?? ''}`.trim()
                : undefined
            }
          />
        ))}
      </div>
      {estimate && (
        <p className="lx-mk-sf__live lx-num" role="status">
          <Icon name="scale" size={16} />
          <span>
            Para lo que te pedimos: {estimate.lines.join(' · ')}
            {estimate.lines.length > 1 && ` → ${eur(estimate.beforeTax)}`} sin
            impuestos.
          </span>
        </p>
      )}
    </>
  );
};

const SUPPLEMENTS = [
  {value: 'night', label: 'Nocturno'},
  {value: 'holiday', label: 'Festivo'},
  {value: 'urgent', label: 'Urgencia (menos de 48 h)'},
  {value: 'other', label: 'Otro'},
];

const ConditionsPart: React.FC<{
  product: ProductDraft;
  setProduct: StepProps['setProduct'];
  headingRef: React.Ref<HTMLHeadingElement>;
  counter: string;
}> = ({product, setProduct, headingRef, counter}) => {
  const v = product.v;
  const set = (k: string, value: Value) => setProduct(product.key, k, value);
  const chosen = String(v.supplements ?? '')
    .split(',')
    .filter(Boolean);
  const base = parseMoney(String(v.price ?? ''));
  return (
    <>
      <Say
        lead={
          <>
            <span className="lx-mk-say__chip">{counter}</span> Casi terminamos
            con {productTitle(product).toLowerCase()}.
          </>
        }
        headingRef={headingRef}
      >
        ¿Alguna condición de precio?
      </Say>
      <div className="lx-mk-stack">
        <ChoiceCards
          name={`sf-${product.key}-season`}
          legend="¿El precio cambia según la época del año?"
          value={(v.season as string) ?? null}
          onChange={x => set('season', x)}
          options={[
            {value: 'same', label: 'Mismo precio todo el año'},
            {
              value: 'seasonal',
              label: 'Cambia según la temporada',
              sub: 'Por ejemplo, más caro con lluvias',
            },
          ]}
        />
        {v.season === 'seasonal' && (
          <div
            className="lx-mk-seasons"
            role="group"
            aria-label="Tarifas de temporada"
          >
            <div className="lx-mk-season lx-mk-season--summer">
              <p className="lx-mk-season__name">
                Verano <span>jun – sep</span>
              </p>
              <MoneyInput
                id={`sf-${product.key}-summer`}
                label="Precio en verano"
                value={String(v.summer ?? '')}
                onChange={x => set('summer', x)}
              />
            </div>
            <div className="lx-mk-season lx-mk-season--rain">
              <p className="lx-mk-season__name">
                Temporada de lluvias <span>nov – mar</span>
              </p>
              <MoneyInput
                id={`sf-${product.key}-rain`}
                label="Precio con lluvias"
                value={String(v.rain ?? '')}
                onChange={x => set('rain', x)}
              />
            </div>
            <p className="lx-field__hint">
              El resto del año, el precio que nos diste
              {base !== null ? ` (${eur(base)})` : ''}.
            </p>
          </div>
        )}
        <ChoiceCards
          name={`sf-${product.key}-min`}
          legend="¿Hay un mínimo?"
          columns={2}
          value={(v.minimum as string) ?? null}
          onChange={x => set('minimum', x)}
          options={[
            {value: 'none', label: 'Sin mínimo'},
            {value: 'days', label: 'De jornadas'},
            {value: 'units', label: 'De unidades'},
            {value: 'amount', label: 'De importe'},
          ]}
        />
        {(v.minimum === 'days' || v.minimum === 'units') && (
          <NumberStepper
            id={`sf-${product.key}-minval`}
            label={
              v.minimum === 'days' ? 'Mínimo de jornadas' : 'Mínimo de unidades'
            }
            value={Number(v.minimumValue ?? 2)}
            onChange={n => set('minimumValue', n)}
            min={1}
          />
        )}
        {v.minimum === 'amount' && (
          <MoneyInput
            id={`sf-${product.key}-minamount`}
            label="Importe mínimo del pedido"
            value={String(v.minimumValue ?? '')}
            onChange={x => set('minimumValue', x)}
          />
        )}
        <ChoiceCards
          name={`sf-${product.key}-sup`}
          legend="Suplementos · opcional"
          multiple
          columns={2}
          value={chosen}
          onChange={x =>
            set(
              'supplements',
              (chosen.includes(x)
                ? chosen.filter(c => c !== x)
                : [...chosen, x]
              ).join(','),
            )
          }
          options={SUPPLEMENTS}
        />
        {chosen.map(s => (
          <Field
            key={s}
            id={`sf-${product.key}-sup-${s}`}
            label={`Suplemento ${SUPPLEMENTS.find(x => x.value === s)?.label.toLowerCase()}`}
            hint="Por ejemplo «+25 %» o «50 € por jornada»."
          >
            <Input
              id={`sf-${product.key}-sup-${s}`}
              value={String(v[`sup_${s}`] ?? '')}
              onChange={e => set(`sup_${s}`, e.target.value)}
              aria-describedby={`sf-${product.key}-sup-${s}-hint`}
            />
          </Field>
        ))}
      </div>
    </>
  );
};

export const MoreStep: React.FC<
  StepProps & {headingRef: React.Ref<HTMLHeadingElement>}
> = ({draft, go, addProduct, removeProduct, headingRef}) => (
  <>
    <Say
      lead={`Llevas ${draft.products.length} ${draft.products.length === 1 ? 'producto' : 'productos'} en esta oferta.`}
      headingRef={headingRef}
    >
      ¿Quieres añadir otro producto o servicio?
    </Say>
    <ul className="lx-mk-plist">
      {draft.products.map((p, i) => (
        <li key={p.key} className="lx-mk-plist__item">
          <span className="lx-mk-plist__icon" aria-hidden="true">
            <Glyph name={p.category} size={22} />
          </span>
          <span className="lx-mk-plist__text">
            <strong>{productTitle(p)}</strong>
            <span className="lx-num">
              {p.v.price
                ? `${eur(parseMoney(String(p.v.price)) ?? 0)} ${PRICE_UNIT_SHORT[String(p.v.priceUnit)] ?? ''}`
                : 'Precio sin indicar'}
            </span>
          </span>
          <button
            type="button"
            className="lx-btn lx-btn--ghost lx-btn--sm"
            onClick={() => go(`p:${p.key}:what`)}
          >
            <span className="lx-btn__label">Cambiar</span>
          </button>
          {i > 0 && (
            <button
              type="button"
              className="lx-iconbtn lx-iconbtn--ghost"
              aria-label={`Quitar ${productTitle(p)}`}
              onClick={() => removeProduct(p.key)}
            >
              <Icon name="trash" size={18} />
            </button>
          )}
        </li>
      ))}
    </ul>
    <div className="lx-mk-stack lx-mk-stack--tight">
      {[...new Set(draft.categories)].map(c => (
        <button
          key={c}
          type="button"
          className="lx-mk-addrow"
          onClick={() => addProduct(c)}
        >
          <Icon name="plus" size={20} />
          <span>
            Otro de {CATEGORY_LABEL[c].toLowerCase()}
            <small>
              {c === 'carpas'
                ? 'Por ejemplo, otra medida'
                : 'Otra modalidad o tarifa'}
            </small>
          </span>
        </button>
      ))}
      <button
        type="button"
        className="lx-mk-addrow"
        onClick={() => go('categories')}
      >
        <Icon name="tag" size={20} />
        <span>
          Otra actividad
          <small>Sonido, limpieza, vallas…</small>
        </span>
      </button>
    </div>
  </>
);

const TAX_RATES: Record<'igic' | 'iva', string[]> = {
  igic: ['0', '3', '7', '9,5', '15'],
  iva: ['4', '10', '21'],
};

export const TaxStep: React.FC<
  StepProps & {headingRef: React.Ref<HTMLHeadingElement>}
> = ({draft, update, headingRef}) => {
  const first = draft.products[0];
  const price = parseMoney(String(first?.v.price ?? ''));
  const rate = parseMoney(draft.taxRate);
  return (
    <>
      <Say lead="Ahora, los impuestos." headingRef={headingRef}>
        ¿Qué impuesto aplicas a estos precios?
      </Say>
      <ChoiceCards<TaxKind>
        name="sf-tax"
        legend="Impuesto"
        hideLegend
        columns={2}
        value={draft.tax}
        onChange={t =>
          update({
            tax: t,
            taxRate: t === 'igic' ? '7' : t === 'iva' ? '21' : '',
          })
        }
        options={[
          {value: 'igic', label: 'IGIC', sub: 'Canarias'},
          {value: 'iva', label: 'IVA', sub: 'Península y Baleares'},
          {value: 'none', label: 'Ninguno', sub: 'Exento'},
          {value: 'unknown', label: 'No lo sé'},
        ]}
      />
      {(draft.tax === 'igic' || draft.tax === 'iva') && (
        <div className="lx-mk-rates">
          <p className="lx-mk-legend" id="sf-rate-label">
            Porcentaje
          </p>
          <div
            className="lx-filterchips"
            role="group"
            aria-labelledby="sf-rate-label"
          >
            {TAX_RATES[draft.tax].map(r => (
              <button
                key={r}
                type="button"
                className="lx-filterchip lx-num"
                aria-pressed={draft.taxRate === r}
                onClick={() => update({taxRate: r})}
              >
                {r} %
              </button>
            ))}
            <label className="lx-mk-rates__other">
              <span>Otro</span>
              <input
                className="lx-input lx-num"
                inputMode="decimal"
                aria-label="Otro porcentaje"
                value={
                  TAX_RATES[draft.tax].includes(draft.taxRate)
                    ? ''
                    : draft.taxRate
                }
                onChange={e =>
                  update({taxRate: e.target.value.replace(/[^\d,.]/g, '')})
                }
              />
              <span aria-hidden="true">%</span>
            </label>
          </div>
        </div>
      )}
      {draft.tax === 'unknown' && (
        <p className="lx-notice">
          <Icon name="question" size={18} />
          No pasa nada: lo comprobaremos contigo. Mientras tanto no sumaremos
          ningún impuesto que no nos hayas indicado.
        </p>
      )}
      {draft.tax && draft.tax !== 'none' && (
        <ChoiceCards
          name="sf-taxincl"
          legend="Los precios que has escrito, ¿llevan ya el impuesto?"
          value={draft.taxIncluded}
          onChange={x => update({taxIncluded: x})}
          options={[
            {
              value: 'no',
              label: 'No, son sin impuestos',
              sub: 'Lo más habitual entre empresas',
            },
            {value: 'yes', label: 'Sí, ya lo incluyen'},
          ]}
        />
      )}
      {draft.taxIncluded === 'yes' && price !== null && rate !== null && (
        <p className="lx-mk-sf__live lx-num" role="status">
          <Icon name="scale" size={16} />
          <span>
            Lo guardaremos sin impuestos: {eur(price)} →{' '}
            {eur(price / (1 + rate / 100))}.
          </span>
        </p>
      )}
    </>
  );
};

const VALIDITY: {value: NonNullable<Draft['validity']>; label: string}[] = [
  {value: '30d', label: '30 días'},
  {value: '3m', label: '3 meses'},
  {value: '6m', label: '6 meses'},
  {value: '1y', label: '1 año'},
  {value: '2y', label: '2 años'},
  {value: 'date', label: 'Otra fecha'},
];

export function validityUntil(draft: Draft): string | null {
  switch (draft.validity) {
    case '30d':
      return addDays(MOCK_TODAY, 30);
    case '3m':
      return addMonths(MOCK_TODAY, 3);
    case '6m':
      return addMonths(MOCK_TODAY, 6);
    case '1y':
      return addMonths(MOCK_TODAY, 12);
    case '2y':
      return addMonths(MOCK_TODAY, 24);
    case 'date':
      return draft.validityDate || null;
    default:
      return null;
  }
}

export const ValidityStep: React.FC<
  StepProps & {headingRef: React.Ref<HTMLHeadingElement>}
> = ({draft, mode, update, headingRef}) => {
  const until = validityUntil(draft);
  return (
    <>
      <Say lead="Los precios cambian; lo entendemos." headingRef={headingRef}>
        ¿Hasta cuándo mantienes estos precios?
      </Say>
      <ChoiceCards
        name="sf-validity"
        legend="Mantengo el precio"
        hideLegend
        columns={3}
        value={draft.validity}
        onChange={x => update({validity: x})}
        options={VALIDITY}
      />
      {draft.validity === 'date' && (
        <Field id="sf-validity-date" label="Hasta el día">
          <DateField
            id="sf-validity-date"
            min={MOCK_TODAY}
            today={MOCK_TODAY}
            value={draft.validityDate}
            onChange={v => update({validityDate: v})}
          />
        </Field>
      )}
      {until && (
        <p className="lx-mk-sf__live lx-num" role="status">
          <Icon name="calendar" size={16} />
          <span>
            Podremos aceptar tu oferta hasta el <strong>{fmtDay(until)}</strong>
            . Después te pediremos que la renueves.
          </span>
        </p>
      )}
      <ChoiceCards
        name="sf-service"
        legend={
          mode === 'request'
            ? `¿Puedes prestar el servicio el ${EVENT.dates}?`
            : '¿Cuándo puedes prestar el servicio?'
        }
        value={draft.service}
        onChange={x => update({service: x})}
        options={
          mode === 'request'
            ? [
                {value: 'all', label: `Sí, las ${REQUEST.days} jornadas`},
                {value: 'some', label: 'Solo algunos días'},
              ]
            : [
                {value: 'year', label: 'Todo el año'},
                {value: 'season', label: 'Solo en ciertas fechas'},
              ]
        }
      />
      {(draft.service === 'some' || draft.service === 'season') && (
        <Field id="sf-service-note" label="¿Qué días o meses?">
          <Input
            id="sf-service-note"
            value={draft.serviceNote}
            placeholder={
              draft.service === 'some'
                ? 'Por ejemplo, 12 y 13 dic'
                : 'Por ejemplo, de octubre a mayo'
            }
            onChange={e => update({serviceNote: e.target.value})}
          />
        </Field>
      )}
    </>
  );
};

export const SpecialStep: React.FC<
  StepProps & {headingRef: React.Ref<HTMLHeadingElement>}
> = ({draft, update, headingRef}) => {
  const base = parseMoney(String(draft.products[0]?.v.price ?? ''));
  const deal = parseMoney(draft.commitmentPrice);
  const saving =
    base && deal !== null && deal < base
      ? Math.round((1 - deal / base) * 100)
      : null;
  return (
    <>
      <Say
        lead="Opcional, pero puede salirte a cuenta."
        headingRef={headingRef}
      >
        ¿Nos haces mejor precio si contratamos varios años?
      </Say>
      <ChoiceCards
        name="sf-commit"
        legend="Compromiso de varios años"
        hideLegend
        columns={2}
        value={draft.commitment}
        onChange={x => update({commitment: x})}
        options={[
          {value: 'no', label: 'No'},
          {value: 'yes', label: 'Sí', sub: 'Precio con compromiso'},
        ]}
      />
      {draft.commitment === 'yes' && (
        <div className="lx-mk-stack lx-mk-deal">
          <div>
            <p className="lx-mk-legend" id="sf-years-label">
              Si os comprometéis durante
            </p>
            <div
              className="lx-filterchips"
              role="group"
              aria-labelledby="sf-years-label"
            >
              {[2, 3, 5].map(y => (
                <button
                  key={y}
                  type="button"
                  className="lx-filterchip lx-num"
                  aria-pressed={draft.commitmentYears === y}
                  onClick={() => update({commitmentYears: y})}
                >
                  {y} años
                </button>
              ))}
            </div>
          </div>
          <MoneyInput
            id="sf-commit-price"
            label={`Precio con compromiso ${PRICE_UNIT_SHORT[String(draft.products[0]?.v.priceUnit)] ?? ''}`.trim()}
            value={draft.commitmentPrice}
            onChange={x => update({commitmentPrice: x})}
          />
          {saving !== null && base !== null && deal !== null && (
            <p className="lx-mk-sf__live lx-num" role="status">
              <Icon name="check" size={16} />
              <span>
                {eur(base)} → {eur(deal)}: un {saving} % menos durante{' '}
                {draft.commitmentYears} años.
              </span>
            </p>
          )}
        </div>
      )}
      <Field
        id="sf-notes"
        label="¿Algo más que debamos saber?"
        optional
        hint="Fianza, cancelación, horarios de montaje, lo que necesites para trabajar…"
      >
        <Textarea
          id="sf-notes"
          rows={3}
          value={draft.notes}
          onChange={e => update({notes: e.target.value})}
          aria-describedby="sf-notes-hint"
        />
      </Field>
    </>
  );
};

/** What is included or charged apart, in plain words, for the review. */
function productLines(p: ProductDraft): string[] {
  const v = p.v;
  const out: string[] = [];
  const pr = parseMoney(String(v.price ?? ''));
  out.push(
    pr !== null
      ? `${eur(pr)} ${PRICE_UNIT_SHORT[String(v.priceUnit)] ?? ''}`.trim()
      : 'Precio a consultar',
  );
  if (v.units) out.push(`${v.units} disponibles`);
  if (v.staff) {
    out.push(`${v.staff} personas · ${v.hours ?? '?'} h por jornada`);
  }
  const inc = (k: string, label: string, priceKey?: string) => {
    if (v[k] === 'included') out.push(`${label} incluido`);
    else if (v[k] === 'extra') {
      const amount = priceKey ? parseMoney(String(v[priceKey] ?? '')) : null;
      out.push(`${label} aparte${amount !== null ? ` (${eur(amount)})` : ''}`);
    }
  };
  inc('assembly', 'Montaje', 'assemblyPrice');
  inc('transport', 'Transporte', 'transportPrice');
  inc('tech', 'Técnico', 'techPrice');
  inc('monitor', 'Monitor');
  if (v.ballast === 'included') out.push('Lastres incluidos');
  if (v.season === 'seasonal') {
    out.push(
      `Verano ${v.summer ? eur(parseMoney(String(v.summer)) ?? 0) : '—'} · lluvias ${v.rain ? eur(parseMoney(String(v.rain)) ?? 0) : '—'}`,
    );
  }
  if (v.minimum === 'days') out.push(`Mínimo ${v.minimumValue ?? 2} jornadas`);
  if (v.minimum === 'units') out.push(`Mínimo ${v.minimumValue ?? 2} unidades`);
  if (v.supplements) {
    out.push(`Suplementos: ${String(v.supplements).split(',').length}`);
  }
  return out;
}

export const ReviewStep: React.FC<
  StepProps & {headingRef: React.Ref<HTMLHeadingElement>}
> = ({draft, mode, update, go, headingRef}) => {
  const until = validityUntil(draft);
  const estimate = mode === 'request' ? requestEstimate(draft) : null;
  const taxText =
    draft.tax === 'igic' || draft.tax === 'iva'
      ? `${draft.tax.toUpperCase()} ${draft.taxRate} %`
      : draft.tax === 'none'
        ? 'Sin impuesto'
        : 'Sin indicar';
  return (
    <>
      <Say lead="Último paso." headingRef={headingRef}>
        Revisa tu oferta antes de enviarla
      </Say>
      <section className="lx-mk-rv" aria-label="Empresa">
        <div className="lx-mk-rv__head">
          <h3>{draft.company.name || 'Empresa sin nombre'}</h3>
          {mode !== 'request' && (
            <button
              type="button"
              className="lx-mk-rv__edit"
              onClick={() => go('contact')}
            >
              Cambiar
            </button>
          )}
        </div>
        <p className="lx-mk-rv__line">
          {[draft.company.contact, draft.company.phone, draft.company.email]
            .filter(Boolean)
            .join(' · ') || 'Sin datos de contacto'}
        </p>
      </section>
      {draft.products.map(p => (
        <section key={p.key} className="lx-mk-rv" aria-label={productTitle(p)}>
          <div className="lx-mk-rv__head">
            <span className="lx-mk-rv__icon" aria-hidden="true">
              <Glyph name={p.category} size={20} />
            </span>
            <h3>{productTitle(p)}</h3>
            <button
              type="button"
              className="lx-mk-rv__edit"
              onClick={() => go(`p:${p.key}:what`)}
            >
              Cambiar
            </button>
          </div>
          <ul className="lx-mk-rv__list lx-num">
            {productLines(p).map(l => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </section>
      ))}
      <section className="lx-mk-rv" aria-label="Impuestos y vigencia">
        <div className="lx-mk-rv__head">
          <h3>Impuestos y fechas</h3>
          <button
            type="button"
            className="lx-mk-rv__edit"
            onClick={() => go('tax')}
          >
            Cambiar
          </button>
        </div>
        <ul className="lx-mk-dates">
          <li>
            <Icon name="tag" size={16} />
            <span>Impuesto</span>
            <strong>{taxText}</strong>
          </li>
          <li>
            <Icon name="clock" size={16} />
            <span>Mantengo el precio hasta</span>
            <strong>{until ? fmtDay(until) : 'Sin indicar'}</strong>
          </li>
          <li>
            <Icon name="calendar" size={16} />
            <span>Puedo prestar el servicio</span>
            <strong>
              {draft.service === 'all'
                ? EVENT.dates
                : draft.service === 'year'
                  ? 'Todo el año'
                  : draft.serviceNote || 'Sin indicar'}
            </strong>
          </li>
          <li>
            <Icon name="link" size={16} />
            <span>Compromiso</span>
            <strong>
              {draft.commitment === 'yes'
                ? `${draft.commitmentYears} años${draft.commitmentPrice ? ` · ${eur(parseMoney(draft.commitmentPrice) ?? 0)}` : ''}`
                : 'Ninguno'}
            </strong>
          </li>
        </ul>
      </section>
      {estimate && (
        <section className="lx-mk-estimate" aria-label="Estimación">
          <p className="lx-eyebrow">Para lo que te pedimos · estimación</p>
          <p className="lx-mk-estimate__total lx-num">
            {estimate.tax !== null
              ? eur(estimate.beforeTax + estimate.tax)
              : eur(estimate.beforeTax)}
          </p>
          <p className="lx-mk-estimate__detail lx-num">
            {eur(estimate.beforeTax)} sin impuestos
            {estimate.taxLabel && estimate.tax !== null
              ? ` + ${estimate.taxLabel} (${eur(estimate.tax)})`
              : ' · impuesto sin indicar'}
          </p>
        </section>
      )}
      <section className="lx-mk-privacy" aria-labelledby="sf-privacy-title">
        <h3 id="sf-privacy-title">
          <Icon name="lock" size={16} /> Tus datos
          <Chip tag tone="neutral" size="sm">
            Texto de ejemplo
          </Chip>
        </h3>
        <p>
          El {ORG_SHORT} usará los datos de este formulario (empresa, persona de
          contacto, teléfono, correo y la oferta) solo para valorar y, si
          procede, contratar este servicio. No se publican ni se ceden a otras
          empresas. Se conservan mientras la oferta esté vigente y en el
          historial de contrataciones. Puedes pedir que los corrijamos o
          borremos respondiendo al correo con el que te llegó este enlace.
        </p>
        <span className="lx-mk-check">
          <input
            type="checkbox"
            id="sf-privacy"
            checked={draft.privacy}
            onChange={e => update({privacy: e.target.checked})}
          />
          <label htmlFor="sf-privacy">
            {mode === 'manual'
              ? 'El proveedor sabe que registramos su oferta'
              : 'He leído cómo se usan mis datos'}
          </label>
        </span>
      </section>
    </>
  );
};

export const SentView: React.FC<{
  mode: Mode;
  declined: boolean;
  onRestart: () => void;
  onInbox: () => void;
}> = ({mode, declined, onRestart, onInbox}) => (
  <div className="lx-mk-sent" id="sf-sent">
    <span className="lx-mk-sent__icon" aria-hidden="true">
      <Icon name="check" size={40} />
    </span>
    <h2 className="lx-mk-sent__title" tabIndex={-1}>
      {declined
        ? 'Respuesta enviada'
        : mode === 'manual'
          ? 'Oferta registrada'
          : 'Oferta enviada'}
    </h2>
    {declined ? (
      <p>Gracias, Mario. Te tendremos en cuenta para la próxima.</p>
    ) : (
      <>
        <p>
          {mode === 'manual'
            ? 'Queda como propuesta pendiente de aprobar, firmada con tu nombre.'
            : `Ya la tiene el equipo del ${ORG_SHORT}. Queda pendiente de su revisión.`}
        </p>
        <p className="lx-mk-sent__ref lx-num">Referencia OF-2026-0142</p>
        <ol className="lx-mk-next">
          <li>
            <strong>La revisan.</strong> Solo un administrador puede aprobarla.
          </li>
          <li>
            <strong>Si la aprueban,</strong> pasa a su catálogo con tus tarifas
            y condiciones.
          </li>
          <li>
            <strong>Antes de que caduque,</strong> te escribirán para renovarla.
          </li>
        </ol>
        {mode === 'request' && (
          <p className="lx-mk-sf__small">
            ¿Se te olvidó algo? Hasta el {REQUEST.answerBy} puedes corregirla
            desde este mismo enlace.
          </p>
        )}
      </>
    )}
    <div className="lx-mk-sent__actions">
      {mode === 'manual' && !declined && (
        <button
          type="button"
          className="lx-btn lx-btn--primary lx-btn--md"
          onClick={onInbox}
        >
          <span className="lx-btn__label">Ver en «Recibidas»</span>
        </button>
      )}
      <button
        type="button"
        className="lx-btn lx-btn--secondary lx-btn--md"
        onClick={onRestart}
      >
        <Icon name="refresh" size={18} />
        <span className="lx-btn__label">Volver a empezar la maqueta</span>
      </button>
    </div>
  </div>
);

export const ExpiredView: React.FC = () => (
  <div className="lx-mk-sent lx-mk-sent--warn" id="sf-expired">
    <span className="lx-mk-sent__icon" aria-hidden="true">
      <Icon name="clock" size={40} />
    </span>
    <h2 className="lx-mk-sent__title">Este enlace ya no está activo</h2>
    <p>
      Los enlaces para presupuestos caducan para proteger tu oferta y la
      nuestra. Este venció el 20 nov.
    </p>
    <p>
      Si aún quieres enviarnos tu propuesta, responde al correo con el que te
      llegó y te mandaremos uno nuevo.
    </p>
    <p className="lx-mk-sf__small">
      Por seguridad no mostramos aquí qué se pedía ni a quién.
    </p>
  </div>
);
