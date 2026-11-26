/**
 * An offer of the catalogue: what a company offers and at what price.
 *
 * - Company (found or created by name) and name are required; the rest can
 *   stay «Pendiente de verificar». An empty amount is unknown, never 0.
 * - Euro amounts accept Spanish decimal commas («85,50», «1.250»).
 * - Transport, assembly and maintenance are separate costs and are never
 *   added up into an invented total.
 * - «Comparar» ranks only offers of the same category and the same unit
 *   (€/día with €/día) and lists the ones without a price apart.
 * - Guests see the offer and its company; prices, costs and conditions come
 *   withheld (`restricted`) and show «Visible para el equipo».
 */
import React, {useCallback, useMemo, useState} from 'react';
import {
  compareOffer,
  costLines,
  formatEuros,
  perUnitLabel,
  PRICE_UNIT_LABEL,
  priceLabel,
} from '../../../shared/logistics/catalogue.ts';
import type {
  DataSource,
  Offer,
  OfferInput,
  PriceUnit,
  Verification,
} from '../../../shared/logistics/contracts.ts';
import {missingForOffer} from '../../../shared/logistics/quality.ts';
import {CUSTOM_UNIT_MAX, PRICE_UNITS} from '../../../shared/logistics/rules.ts';
import {useActions, type OfferPrefill} from '../common/actions';
import {RecordHistory} from '../common/RecordHistory';
import {RecordNotes} from '../common/RecordNotes';
import {
  GoneNotice,
  MissingHint,
  Value,
  useGone,
} from '../contacts/DirectoryParts';
import {CompanyField} from '../contacts/NameHelpers';
import {DemoChip, VerificationChip} from '../events/EventChips';
import {
  DeleteStrip,
  DiscardStrip,
  FormNotices,
  Provenance,
  QualityFields,
  ReadOnlyNotice,
} from '../forms/FormParts';
import {useRecordForm, type FormErrors} from '../forms/useRecordForm';
import {
  categoryNames,
  euroProblem,
  eurosForInput,
  parseEuros,
} from '../lib/directory';
import {SOURCE_LABEL, VERIFICATION_LABEL} from '../lib/events';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {
  Button,
  Field,
  HelpTip,
  Icon,
  Input,
  Pending,
  Segmented,
  Sheet,
  Textarea,
  Withheld,
  describedBy,
} from '../ui';
import {CategoryPicker} from './CategoryPicker';

type RescuedValues = Record<string, unknown>;

export type OfferSheetMode =
  | {kind: 'view'; offer: Offer}
  | {kind: 'create'; prefill?: OfferPrefill; rescued?: RescuedValues}
  | {kind: 'edit'; offer: Offer; rescued?: RescuedValues};

type Vat = 'yes' | 'no' | 'unknown';

interface FormValues {
  companyName: string;
  name: string;
  categoryId: string;
  description: string;
  price: string;
  unit: PriceUnit;
  customUnit: string;
  transportCost: string;
  assemblyCost: string;
  maintenanceCost: string;
  vat: Vat;
  conditions: string;
  source: DataSource | null;
  verification: Verification;
}

const EMPTY: FormValues = {
  companyName: '',
  name: '',
  categoryId: '',
  description: '',
  price: '',
  unit: 'unit',
  customUnit: '',
  transportCost: '',
  assemblyCost: '',
  maintenanceCost: '',
  vat: 'unknown',
  conditions: '',
  source: null,
  verification: 'draft',
};

const toVat = (v: boolean | null): Vat =>
  v === true ? 'yes' : v === false ? 'no' : 'unknown';
const fromVat = (v: Vat): boolean | null =>
  v === 'yes' ? true : v === 'no' ? false : null;

const toValues = (o: Offer): FormValues => ({
  companyName: o.company.name,
  name: o.name,
  categoryId: o.categoryId ?? '',
  description: o.description ?? '',
  price: eurosForInput(o.price),
  unit: o.unit,
  customUnit: o.customUnit ?? '',
  transportCost: eurosForInput(o.transportCost),
  assemblyCost: eurosForInput(o.assemblyCost),
  maintenanceCost: eurosForInput(o.maintenanceCost),
  vat: toVat(o.vatIncluded),
  conditions: o.conditions ?? '',
  source: o.source,
  verification: o.verification,
});

const TEXT_KEYS = [
  'companyName',
  'name',
  'categoryId',
  'description',
  'price',
  'customUnit',
  'transportCost',
  'assemblyCost',
  'maintenanceCost',
  'conditions',
] as const;

function fromRescue(raw: RescuedValues, fallback: FormValues): FormValues {
  const out = {...fallback};
  for (const k of TEXT_KEYS) if (typeof raw[k] === 'string') out[k] = raw[k];
  if (typeof raw.unit === 'string' && raw.unit in PRICE_UNIT_LABEL) {
    out.unit = raw.unit as PriceUnit;
  }
  if (raw.vat === 'yes' || raw.vat === 'no' || raw.vat === 'unknown') {
    out.vat = raw.vat;
  }
  if (raw.source === null) out.source = null;
  else if (typeof raw.source === 'string' && raw.source in SOURCE_LABEL) {
    out.source = raw.source as DataSource;
  }
  if (
    typeof raw.verification === 'string' &&
    raw.verification in VERIFICATION_LABEL
  ) {
    out.verification = raw.verification as Verification;
  }
  return out;
}

const SERVER_FIELD: Partial<Record<string, keyof FormValues>> = {
  companyName: 'companyName',
  companyId: 'companyName',
  company: 'companyName',
  name: 'name',
  categoryId: 'categoryId',
  description: 'description',
  price: 'price',
  unit: 'unit',
  customUnit: 'customUnit',
  transportCost: 'transportCost',
  assemblyCost: 'assemblyCost',
  maintenanceCost: 'maintenanceCost',
  vatIncluded: 'vat',
  conditions: 'conditions',
  source: 'source',
  verification: 'verification',
};

const MONEY_KEYS = [
  'price',
  'transportCost',
  'assemblyCost',
  'maintenanceCost',
] as const;

function validate(v: FormValues): FormErrors<FormValues> {
  const e: FormErrors<FormValues> = {};
  if (!v.companyName.trim()) {
    e.companyName = 'Indica de qué empresa es la oferta.';
  }
  if (!v.name.trim()) e.name = 'Escribe qué se ofrece, aunque sea provisional.';
  for (const k of MONEY_KEYS) {
    const problem = euroProblem(v[k]);
    if (problem) e[k] = problem;
  }
  if (v.unit === 'custom' && v.customUnit.trim().length > CUSTOM_UNIT_MAX) {
    e.customUnit = `Como mucho ${CUSTOM_UNIT_MAX} caracteres.`;
  }
  return e;
}

const nullIfEmpty = (s: string) => (s.trim() ? s.trim() : null);

const UNIT_OPTIONS = PRICE_UNITS.map(u => ({
  value: u,
  label: PRICE_UNIT_LABEL[u],
}));

const VAT_OPTIONS: {value: Vat; label: string}[] = [
  {value: 'yes', label: 'Sí'},
  {value: 'no', label: 'No'},
  {value: 'unknown', label: 'No lo sé'},
];

// «Impuestos» covers IGIC in the Canaries and IVA elsewhere.
const VAT_TEXT: Record<Vat, string> = {
  yes: 'Impuestos incluidos',
  no: 'Sin impuestos',
  unknown: 'Impuestos sin verificar',
};

export const OfferSheet: React.FC<{
  mode: OfferSheetMode | null;
  onClose: () => void;
}> = ({mode, onClose}) =>
  mode ? <OfferSheetBody initial={mode} onClose={onClose} /> : null;

const OfferSheetBody: React.FC<{
  initial: OfferSheetMode;
  onClose: () => void;
}> = ({initial, onClose}) => {
  const [mode, setMode] = useState(initial);
  if (mode.kind === 'view') {
    return (
      <OfferView
        // A peer opened from «Comparar» starts a fresh view.
        key={mode.offer.id}
        offer={mode.offer}
        onClose={onClose}
        onEdit={o => setMode({kind: 'edit', offer: o})}
        onShow={o => setMode({kind: 'view', offer: o})}
      />
    );
  }
  return (
    <OfferForm
      mode={mode}
      onClose={onClose}
      onSaved={o => setMode({kind: 'view', offer: o})}
    />
  );
};

// ---------------------------------------------------------------- view

const OfferView: React.FC<{
  offer: Offer;
  onClose: () => void;
  onEdit: (offer: Offer) => void;
  onShow: (offer: Offer) => void;
}> = ({offer: opened, onClose, onEdit, onShow}) => {
  const live = useLogisticsStore(s => s.offers.find(o => o.id === opened.id));
  const loaded = useLogisticsStore(s => s.offersState === 'ready');
  const offers = useLogisticsStore(s => s.offers);
  const companies = useLogisticsStore(s => s.companies);
  const categories = useLogisticsStore(s => s.categories);
  const {canWrite, openCompany} = useActions();
  const offer = live ?? opened;
  const gone = useGone(live, loaded);
  const w = offer.restricted;
  const company = companies.find(c => c.id === offer.company.id);
  const categoryName = offer.categoryId
    ? categoryNames(categories).get(offer.categoryId)
    : undefined;
  const price = priceLabel(offer);
  const extras = costLines(offer).filter(l => l.key !== 'price');

  return (
    <Sheet
      open
      onClose={onClose}
      id="lx-offer-sheet"
      eyebrow={categoryName ? `Oferta · ${categoryName}` : 'Oferta'}
      title={offer.name}
      meta={
        <>
          {offer.isDemo && <DemoChip />}
          <VerificationChip verification={offer.verification} />
          {company ? (
            <button
              type="button"
              className="lx-link lx-sheet__sub"
              id="lx-offer-company"
              onClick={() => openCompany(company)}
            >
              <Icon name="building" size={15} />
              {offer.company.name}
            </button>
          ) : (
            <span className="lx-sheet__sub">{offer.company.name}</span>
          )}
        </>
      }
      footer={
        canWrite && !gone ? (
          <>
            <Button variant="ghost" onClick={onClose} id="lx-offer-close">
              Cerrar
            </Button>
            <span className="lx-sheet__foot-spacer" />
            <Button
              variant="primary"
              icon="edit"
              id="lx-offer-edit"
              onClick={() => onEdit(offer)}
            >
              Editar
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={onClose} id="lx-offer-close">
            Cerrar
          </Button>
        )
      }
    >
      <div className="lx-record">
        {gone && <GoneNotice what="Esta oferta" />}
        {!canWrite && <ReadOnlyNotice />}

        <div className="lx-pricebig" id="lx-offer-price">
          <p className="lx-eyebrow">Precio</p>
          <p className="lx-pricebig__value lx-num">
            {price ? (
              price
            ) : w ? (
              <Withheld />
            ) : (
              <Pending>Precio pendiente de verificar</Pending>
            )}
          </p>
          {!w && (
            <p className="lx-pricebig__vat">
              {VAT_TEXT[toVat(offer.vatIncluded)]}
            </p>
          )}
        </div>
        <MissingHint missing={missingForOffer(offer)} id="lx-offer-missing" />

        <section
          className="lx-subsection"
          id="lx-offer-costs"
          aria-labelledby="lx-offer-costs-title"
        >
          <h3 className="lx-subsection__title" id="lx-offer-costs-title">
            Costes aparte
            <HelpTip label="costes aparte">
              Transporte, montaje y mantenimiento se apuntan por separado y no
              se suman al precio: el precio es por unidad, estos costes suelen
              ser por pedido, y si uno no se conoce cualquier total sería falso.
            </HelpTip>
          </h3>
          <dl className="lx-costs">
            {extras.map(line => (
              <div key={line.key}>
                <dt>{line.label}</dt>
                <dd className="lx-num">
                  {line.amount !== null ? (
                    formatEuros(line.amount)
                  ) : w ? (
                    <Withheld />
                  ) : (
                    <Pending />
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <dl className="lx-detail" id="lx-offer-detail">
          <div>
            <dt>Categoría</dt>
            <dd>
              <Value value={categoryName} />
            </dd>
          </div>
          <div>
            <dt>Unidad</dt>
            <dd>
              {offer.unit === 'custom' ? (
                <Value
                  value={perUnitLabel(offer) && `Por ${perUnitLabel(offer)}`}
                />
              ) : (
                `Por ${perUnitLabel(offer)}`
              )}
            </dd>
          </div>
          <div>
            <dt>Descripción</dt>
            <dd className="lx-detail__notes">
              <Value value={offer.description} empty="—" />
            </dd>
          </div>
          <div>
            <dt>Condiciones</dt>
            <dd className="lx-detail__notes">
              <Value value={offer.conditions} withheld={w} />
            </dd>
          </div>
          <div>
            <dt>Origen del dato</dt>
            <dd>
              <Value value={offer.source && SOURCE_LABEL[offer.source]} />
            </dd>
          </div>
        </dl>

        <Compare
          offer={offer}
          offers={offers}
          categoryName={categoryName}
          onShow={onShow}
        />

        <RecordNotes
          target={{type: 'offer', id: offer.id}}
          prefill={{ref: {type: 'offer', id: offer.id, label: offer.name}}}
          idPrefix="lx-offer"
          canAdd={!gone}
        />
        <RecordHistory
          entityType="offer"
          entityId={offer.id}
          version={offer.version}
          idPrefix="lx-offer"
        />
        <Provenance record={offer} id="lx-offer-provenance" />
      </div>
    </Sheet>
  );
};

/** «Comparar»: like-for-like only, cheapest first, unpriced apart. */
const Compare: React.FC<{
  offer: Offer;
  offers: Offer[];
  categoryName: string | undefined;
  onShow: (offer: Offer) => void;
}> = ({offer, offers, categoryName, onShow}) => {
  const comparison = useMemo(
    () => compareOffer(offer, offers),
    [offer, offers],
  );
  const per = perUnitLabel(offer);
  let body: React.ReactNode;
  if (offer.restricted) {
    body = (
      <p className="lx-muted">
        <Withheld>Los precios son visibles para el equipo.</Withheld>
      </p>
    );
  } else if (!comparison) {
    body = (
      <p className="lx-muted" id="lx-offer-compare-none">
        {offer.categoryId
          ? 'Concreta la unidad de contratación para poder compararla con otras.'
          : 'Sin categoría no hay con qué compararla de forma honesta. Asígnale una.'}
      </p>
    );
  } else {
    const {peers, position, otherTax, unpriced} = comparison;
    const others = peers.filter(p => p.id !== offer.id);
    const ranked = peers.length >= 2;
    const max = Math.max(...peers.map(p => p.price as number), 0);
    const included = offer.vatIncluded === true;
    const summary =
      offer.price === null
        ? 'Esta oferta no tiene precio: no se puede situar entre las demás.'
        : offer.vatIncluded === null
          ? 'No se puede ordenar hasta saber si su precio incluye impuestos (IGIC/IVA).'
          : ranked && position
            ? `Es la ${position === 1 ? '' : `${position}.ª `}más barata de ${
                peers.length
              } comparables · todas ${
                included ? 'con impuestos incluidos' : 'sin impuestos'
              }.`
            : `Aún no hay otra oferta con precio que ${
                included
                  ? 'también incluya impuestos'
                  : 'también esté sin impuestos'
              }: no hay con qué ordenarla.`;
    body =
      others.length === 0 && otherTax.length === 0 && unpriced.length === 0 ? (
        <p className="lx-muted" id="lx-offer-compare-none">
          Aún no hay otras ofertas de {categoryName ?? 'esta categoría'} por{' '}
          {per}.
        </p>
      ) : (
        <>
          <p className="lx-compare__summary" id="lx-offer-compare-summary">
            {summary}
          </p>
          {ranked && (
            <ol className="lx-compare" id="lx-offer-compare-list">
              {peers.map((p, i) => {
                const self = p.id === offer.id;
                const width =
                  max > 0 ? Math.max(4, ((p.price as number) / max) * 100) : 0;
                return (
                  <li key={p.id} className={self ? 'is-self' : ''}>
                    <button
                      type="button"
                      className="lx-compare__row"
                      disabled={self}
                      aria-current={self ? 'true' : undefined}
                      onClick={() => onShow(p)}
                    >
                      <span className="lx-compare__pos lx-num">{i + 1}</span>
                      <span className="lx-compare__name">
                        <strong>{self ? 'Esta oferta' : p.name}</strong>
                        <span className="lx-muted">{p.company.name}</span>
                      </span>
                      <span className="lx-compare__price lx-num">
                        {priceLabel(p)}
                        <span className="lx-compare__tax">
                          {VAT_TEXT[toVat(p.vatIncluded)]}
                        </span>
                      </span>
                      <span className="lx-compare__bar" aria-hidden="true">
                        <span style={{width: `${width}%`}} />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
          {otherTax.length > 0 && (
            <div className="lx-compare__apart" id="lx-offer-compare-othertax">
              <p className="lx-subtitle">
                Impuestos distintos o sin verificar · no se ordenan
              </p>
              <ul className="lx-compare lx-compare--apart">
                {otherTax.map(p => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="lx-compare__row"
                      onClick={() => onShow(p)}
                    >
                      <span className="lx-compare__name">
                        <strong>{p.name}</strong>
                        <span className="lx-muted">{p.company.name}</span>
                      </span>
                      <span className="lx-compare__price lx-num">
                        {priceLabel(p)}
                        <span className="lx-compare__tax">
                          {VAT_TEXT[toVat(p.vatIncluded)]}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {unpriced.length > 0 && (
            <div
              className="lx-compare__unpriced"
              id="lx-offer-compare-unpriced"
            >
              <p className="lx-subtitle">Sin precio conocido · no se ordenan</p>
              <ul className="lx-chiplist">
                {unpriced.map(u => (
                  <li key={u.id}>
                    <button
                      type="button"
                      className="lx-pendingchip"
                      onClick={() => onShow(u)}
                    >
                      <span className="lx-chip__dot" aria-hidden="true" />
                      {u.name} · {u.company.name}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      );
  }
  return (
    <section
      className="lx-subsection"
      id="lx-offer-compare"
      aria-labelledby="lx-offer-compare-title"
    >
      <h3 className="lx-subsection__title" id="lx-offer-compare-title">
        <Icon name="scale" size={20} />
        Comparar
        <HelpTip label="comparar">
          Solo se comparan ofertas de la misma categoría y la misma unidad
          (€/día con €/día, nunca con €/metro). Se compara el precio por unidad:
          transporte, montaje y mantenimiento van aparte. Solo se ordenan juntas
          las que tratan igual los impuestos (IGIC/IVA): un precio con impuestos
          no se compara con uno sin ellos. Las ofertas sin precio o con
          impuestos sin verificar se listan aparte y no se ordenan.
        </HelpTip>
      </h3>
      {comparison && !offer.restricted && (
        <p className="lx-muted lx-compare__scope">
          Misma categoría ({categoryName ?? '—'}) y misma unidad (€ / {per}).
          Otras unidades no se comparan.
        </p>
      )}
      {body}
    </section>
  );
};

// ---------------------------------------------------------------- form

const OfferForm: React.FC<{
  mode: Exclude<OfferSheetMode, {kind: 'view'}>;
  onClose: () => void;
  onSaved: (offer: Offer) => void;
}> = ({mode, onClose, onSaved}) => {
  const createOffer = useLogisticsStore(s => s.createOffer);
  const updateOffer = useLogisticsStore(s => s.updateOffer);
  const deleteOffer = useLogisticsStore(s => s.deleteOffer);
  const toast = useLogisticsStore(s => s.toast);
  const companies = useLogisticsStore(s => s.companies);
  const [savedName, setSavedName] = useState<string | null>(null);

  const editing = mode.kind === 'edit' ? mode.offer : null;
  const blank = useMemo<FormValues>(
    () =>
      mode.kind === 'create'
        ? {
            ...EMPTY,
            companyName: mode.prefill?.companyName ?? '',
            categoryId: mode.prefill?.categoryId ?? '',
            name: mode.prefill?.name ?? '',
          }
        : EMPTY,
    // Only the opening values matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const toValuesCb = useCallback(toValues, []);
  const f = useRecordForm<FormValues, Offer>({
    entity: 'offer',
    editing,
    blank,
    toValues: toValuesCb,
    rescued: mode.rescued,
    fromRescue,
    serverField: SERVER_FIELD,
    onClose: () => (f.base ? onSaved(f.base) : onClose()),
  });
  const {values, set, errors, base, saving} = f;
  const isCreate = !base;

  const change = <K extends keyof FormValues>(k: K, v: FormValues[K]) => {
    set(k, v);
    setSavedName(null);
  };

  const amount = (text: string) => {
    const v = parseEuros(text);
    return v === null || Number.isNaN(v) ? null : v;
  };
  const preview = priceLabel({
    price: amount(values.price),
    unit: values.unit,
    customUnit: nullIfEmpty(values.customUnit),
  });

  const inputFrom = (v: FormValues): OfferInput => ({
    companyName: v.companyName.trim(),
    name: v.name.trim(),
    categoryId: v.categoryId || null,
    description: nullIfEmpty(v.description),
    price: amount(v.price),
    unit: v.unit,
    customUnit: v.unit === 'custom' ? nullIfEmpty(v.customUnit) : null,
    transportCost: amount(v.transportCost),
    assemblyCost: amount(v.assemblyCost),
    maintenanceCost: amount(v.maintenanceCost),
    vatIncluded: fromVat(v.vat),
    conditions: nullIfEmpty(v.conditions),
    source: v.source,
    verification: v.verification,
  });

  const submit = async (next: boolean) => {
    if (saving) return;
    const found = validate(values);
    if (Object.keys(found).length) {
      f.setErrors(found);
      document.getElementById(`lx-offer-${Object.keys(found)[0]}`)?.focus();
      return;
    }
    f.setSaving(next ? 'next' : 'save');
    f.setErrors({});
    try {
      if (!base) {
        const created = await createOffer(inputFrom(values));
        f.markSaved();
        toast(`Oferta guardada: ${created.name}`, 'success');
        if (next) {
          // Next offer of the same supplier and category.
          // What carries over is the new baseline, not a change of its own.
          f.startNext({
            ...EMPTY,
            companyName: values.companyName,
            categoryId: values.categoryId,
            unit: values.unit,
            customUnit: values.unit === 'custom' ? values.customUnit : '',
            vat: values.vat,
            source: values.source,
            verification: values.verification,
          });
          setSavedName(created.name);
          document.getElementById('lx-offer-name')?.focus();
        } else {
          onSaved(created);
        }
        return;
      }
      const full = inputFrom(values);
      const patch: OfferInput = {version: base.version};
      if (f.changed('companyName') && full.companyName) {
        patch.companyName = full.companyName;
      }
      if (f.changed('name')) patch.name = full.name;
      if (f.changed('categoryId')) patch.categoryId = full.categoryId;
      if (f.changed('description')) patch.description = full.description;
      if (f.changed('price')) patch.price = full.price;
      if (f.changed('unit') || f.changed('customUnit')) {
        patch.unit = full.unit;
        patch.customUnit = full.customUnit;
      }
      if (f.changed('transportCost')) patch.transportCost = full.transportCost;
      if (f.changed('assemblyCost')) patch.assemblyCost = full.assemblyCost;
      if (f.changed('maintenanceCost')) {
        patch.maintenanceCost = full.maintenanceCost;
      }
      if (f.changed('vat')) patch.vatIncluded = full.vatIncluded;
      if (f.changed('conditions')) patch.conditions = full.conditions;
      if (f.changed('source')) patch.source = full.source;
      if (f.changed('verification')) patch.verification = full.verification;
      if (Object.keys(patch).length === 1) {
        toast('No había cambios que guardar.', 'info');
        onSaved(base);
        return;
      }
      const updated = await updateOffer(base.id, patch);
      f.markSaved();
      toast(`Cambios guardados: ${updated.name}`, 'success');
      onSaved(updated);
    } catch (err) {
      f.applyServerError(err, 'save');
    } finally {
      f.setSaving(null);
    }
  };

  const remove = async () => {
    if (!base || saving) return;
    f.setSaving('delete');
    f.setErrors({});
    try {
      await deleteOffer(base);
      toast(`Oferta borrada: ${base.name}`, 'success');
      onClose();
    } catch (err) {
      f.setConfirm(null);
      f.applyServerError(err, 'delete');
    } finally {
      f.setSaving(null);
    }
  };

  const money = (
    key: (typeof MONEY_KEYS)[number],
    label: string,
    hint?: string,
  ) => {
    const id = `lx-offer-${key}`;
    return (
      <Field id={id} label={label} optional error={errors[key]} hint={hint}>
        <span className="lx-money">
          <Input
            id={id}
            name={id}
            inputMode="decimal"
            className="lx-num"
            value={values[key]}
            invalid={!!errors[key]}
            aria-describedby={describedBy(id, {error: errors[key], hint})}
            placeholder="Pendiente"
            autoComplete="off"
            onChange={e => change(key, e.target.value)}
            onBlur={() => {
              const problem = euroProblem(values[key]);
              if (problem) f.setErrors(er => ({...er, [key]: problem}));
            }}
          />
          <span className="lx-money__unit" aria-hidden="true">
            €
          </span>
        </span>
      </Field>
    );
  };

  const footer =
    f.confirm === 'discard' ? (
      <DiscardStrip
        idPrefix="lx-offer-discard"
        onKeep={f.keepEditing}
        onDiscard={f.discard}
      />
    ) : f.confirm === 'delete' && base ? (
      <DeleteStrip
        idPrefix="lx-offer"
        question={<>¿Borrar la oferta «{base.name}»?</>}
        detail="Desaparece del catálogo de la empresa. No se puede deshacer."
        busy={saving === 'delete'}
        onKeep={() => f.setConfirm(null)}
        onDelete={() => void remove()}
      />
    ) : (
      <>
        {base ? (
          <Button
            variant="ghost"
            icon="trash"
            className="lx-btn--danger-text"
            id="lx-offer-delete"
            disabled={!!saving}
            onClick={() => f.setConfirm('delete')}
          >
            Borrar
          </Button>
        ) : (
          <Button variant="ghost" onClick={f.requestClose} id="lx-offer-cancel">
            Cancelar
          </Button>
        )}
        <span className="lx-sheet__foot-spacer" />
        {isCreate ? (
          <Button
            id="lx-offer-save-next"
            busy={saving === 'next'}
            disabled={saving === 'save'}
            onClick={() => void submit(true)}
          >
            {saving === 'next' ? 'Guardando…' : 'Guardar y seguir'}
          </Button>
        ) : (
          <Button variant="ghost" onClick={f.requestClose} id="lx-offer-cancel">
            Cancelar
          </Button>
        )}
        <Button
          variant="primary"
          id="lx-offer-save"
          busy={saving === 'save'}
          disabled={saving === 'next' || saving === 'delete' || !!f.conflict}
          onClick={() => void submit(false)}
        >
          {saving === 'save' ? 'Guardando…' : 'Guardar'}
        </Button>
      </>
    );

  return (
    <Sheet
      open
      onClose={f.requestClose}
      id="lx-offer-sheet"
      eyebrow={isCreate ? 'Nueva oferta' : 'Editar oferta'}
      title={isCreate ? 'Añadir oferta' : base.name}
      meta={
        base ? (
          <>
            {base.isDemo && <DemoChip />}
            <VerificationChip verification={base.verification} />
          </>
        ) : (
          <span className="lx-muted">
            Empresa y nombre son obligatorios. Lo demás puede quedar pendiente.
          </span>
        )
      }
      footer={footer}
    >
      <form
        id="lx-offer-form"
        className="lx-form"
        noValidate
        onSubmit={e => {
          e.preventDefault();
          void submit(false);
        }}
      >
        <FormNotices
          idPrefix="lx-offer"
          subject="esta oferta"
          conflict={f.conflict}
          conflictOn={f.conflictOn}
          ownConflict={f.ownConflict}
          onLoadCurrent={f.loadCurrent}
          rescued={f.rescuedNotice}
          currentLoaded={f.conflictResolved}
          saved={
            savedName && (
              <>Guardada «{savedName}». Puedes añadir la siguiente oferta.</>
            )
          }
          error={errors.form}
          alertRef={f.alertRef}
          merge={f.merge}
        />

        <CompanyField
          id="lx-offer-companyName"
          label="Empresa"
          value={values.companyName}
          onChange={v => change('companyName', v)}
          companies={companies}
          error={errors.companyName}
        />

        <Field id="lx-offer-name" label="Qué ofrece" error={errors.name}>
          <Input
            id="lx-offer-name"
            name="lx-offer-name"
            data-autofocus
            value={values.name}
            invalid={!!errors.name}
            aria-describedby={describedBy('lx-offer-name', {
              error: errors.name,
            })}
            placeholder="Carpa 6 × 3 m"
            autoComplete="off"
            onChange={e => change('name', e.target.value)}
          />
        </Field>

        <CategoryPicker
          idPrefix="lx-offer"
          legend="Categoría"
          multiple={false}
          value={values.categoryId ? [values.categoryId] : []}
          onChange={ids => change('categoryId', ids[0] ?? '')}
          error={errors.categoryId}
          lockedIds={base?.categoryId ? [base.categoryId] : undefined}
          help="Sirve para filtrar el catálogo y para comparar ofertas parecidas."
        />

        <div className="lx-form__group lx-pricegroup">
          <p className="lx-form__group-title">Precio</p>
          {money(
            'price',
            'Precio por unidad',
            'Vacío = pendiente de verificar (nunca se toma como 0). Admite coma: 85,50.',
          )}
          <Segmented<PriceUnit>
            name="lx-offer-unit"
            id="lx-offer-unit"
            legend="Se cobra por"
            value={values.unit}
            options={UNIT_OPTIONS}
            onChange={v => v && change('unit', v)}
            help="La unidad de contratación: por unidad, por metro, por hora, por día, por kilómetro, por paquete u otra que escribas. Es solo la forma de cobrar: «kg» u otra unidad no calcula pesos ni cargas sobre el suelo."
          />
          {values.unit === 'custom' && (
            <Field
              id="lx-offer-customUnit"
              label="¿Por qué se cobra?"
              optional
              error={errors.customUnit}
              hint="Por ejemplo «por escenario» o «por jornada de 8 h»."
            >
              <Input
                id="lx-offer-customUnit"
                name="lx-offer-customUnit"
                value={values.customUnit}
                invalid={!!errors.customUnit}
                placeholder="por escenario"
                autoComplete="off"
                onChange={e => change('customUnit', e.target.value)}
              />
            </Field>
          )}
          <p
            className="lx-form__note lx-pricegroup__preview"
            aria-live="polite"
          >
            Se verá como:{' '}
            <strong className="lx-num">
              {preview ?? 'Precio pendiente de verificar'}
            </strong>
          </p>
          <Segmented<Vat>
            name="lx-offer-vat"
            id="lx-offer-vat"
            legend="¿El precio incluye impuestos (IGIC/IVA)?"
            value={values.vat}
            options={VAT_OPTIONS}
            onChange={v => v && change('vat', v)}
            help="IGIC en Canarias, IVA en la Península y Baleares. Al comparar, solo se ordenan juntas las ofertas que tratan los impuestos igual; si no lo sabes, la oferta se guarda pero no se ordena."
          />
        </div>

        <div className="lx-form__group">
          <p className="lx-form__group-title">Costes aparte · no se suman</p>
          <div className="lx-form__row lx-form__row--3">
            {money('transportCost', 'Transporte')}
            {money('assemblyCost', 'Montaje')}
            {money('maintenanceCost', 'Mantenimiento')}
          </div>
        </div>

        <Field
          id="lx-offer-conditions"
          label="Condiciones"
          optional
          error={errors.conditions}
        >
          <Textarea
            id="lx-offer-conditions"
            name="lx-offer-conditions"
            rows={2}
            value={values.conditions}
            placeholder="Mínimo 2 días, fianza, plazos de aviso…"
            onChange={e => change('conditions', e.target.value)}
          />
        </Field>

        <Field
          id="lx-offer-description"
          label="Descripción"
          optional
          error={errors.description}
        >
          <Textarea
            id="lx-offer-description"
            name="lx-offer-description"
            rows={2}
            value={values.description}
            placeholder="Medidas, material, lo que incluye…"
            onChange={e => change('description', e.target.value)}
          />
        </Field>

        <QualityFields
          idPrefix="lx-offer"
          source={values.source}
          verification={values.verification}
          onSource={v => change('source', v)}
          onVerification={v => change('verification', v)}
        />

        {base && <Provenance record={base} id="lx-offer-provenance" />}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Sheet>
  );
};
