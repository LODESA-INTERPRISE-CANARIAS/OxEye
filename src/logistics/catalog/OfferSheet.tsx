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
 * - E5: prices are entered before tax; the offer takes its company's tax
 *   unless it sets its own, and the price with tax is always shown as an
 *   «estimación». Offers recorded earlier keep how their price was written
 *   (`vatIncluded`) and no rate is invented for them. «Comparar» ranks
 *   different taxes together by that estimate; unknown tax stays apart.
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
import {UnsentMark} from '../offline/PendingMark';
import type {FormReview} from '../offline/review';
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
import {
  EMPTY_TAX_DRAFT,
  estimateLine,
  priceBasis,
  rescuedTaxDraft,
  taxDraftOf,
  taxFieldError,
  taxInfoOfDraft,
  taxProblem,
  taxToSend,
  type TaxDraft,
} from '../budget/tax';
import {inheritHint, TaxField} from '../budget/TaxField';
import {EstimateNote, TaxTag} from '../budget/TaxParts';
import {nameKey} from '../lib/tasks';
import {CategoryPicker} from './CategoryPicker';
import {COMPARE_HELP} from './compare';
import {ApartList, RankedList} from './CompareParts';
import {OfferTermsSection} from './terms/OfferTermsSection';
import {useExpiredOffers} from './useExpiredOffers';

type RescuedValues = Record<string, unknown>;

export type OfferSheetMode =
  | {kind: 'view'; offer: Offer}
  | {
      kind: 'create';
      prefill?: OfferPrefill;
      rescued?: RescuedValues;
      review?: FormReview;
    }
  | {kind: 'edit'; offer: Offer; rescued?: RescuedValues; review?: FormReview};

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
  /** E5: the offer's own tax; regime '' = «como la empresa». */
  tax: TaxDraft;
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
  // E5: prices are entered before tax.
  vat: 'no',
  tax: EMPTY_TAX_DRAFT,
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
  // `?? null`: a server not yet on E5 sends no tax.
  tax: taxDraftOf(o.tax ?? null),
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
  const tax = rescuedTaxDraft(raw.tax);
  if (tax) out.tax = tax;
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
  tax: 'tax',
  'tax.regime': 'tax',
  'tax.name': 'tax',
  'tax.ratePercent': 'tax',
  'tax.verification': 'tax',
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
  const tax = taxProblem(v.tax);
  if (tax) e.tax = tax.message;
  return e;
}

const nullIfEmpty = (s: string) => (s.trim() ? s.trim() : null);

const UNIT_OPTIONS = PRICE_UNITS.map(u => ({
  value: u,
  label: PRICE_UNIT_LABEL[u],
}));

// E5: only offers recorded before prices were always before tax show this.
const VAT_OPTIONS: {value: Vat; label: string}[] = [
  {value: 'no', label: 'Sin impuestos'},
  {value: 'yes', label: 'Con impuestos incluidos'},
  {value: 'unknown', label: 'No consta'},
];

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
  // A server not yet on E5 sends no tax: read it as nobody said.
  const own = offer.tax ?? null;
  const companyTax = offer.companyTax ?? null;
  const estimate = estimateLine({...offer, tax: own, companyTax});

  return (
    <Sheet
      open
      onClose={onClose}
      id="lx-offer-sheet"
      eyebrow={categoryName ? `Oferta · ${categoryName}` : 'Oferta'}
      title={offer.name}
      meta={
        <>
          <UnsentMark id={offer.id} />
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
          <p className="lx-eyebrow">
            Precio
            {!w && price && (
              <span className="lx-pricebig__basis">
                {' '}
                · {priceBasis(offer.vatIncluded)}
              </span>
            )}
          </p>
          <p className="lx-pricebig__value lx-num">
            {price ? (
              price
            ) : w ? (
              <Withheld />
            ) : (
              <Pending>Precio pendiente de verificar</Pending>
            )}
          </p>
          {!w && <EstimateNote line={estimate} id="lx-offer-estimate" />}
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
            <dt>Impuesto</dt>
            <dd id="lx-offer-tax-view">
              {w ? (
                <Withheld />
              ) : own ? (
                <>
                  <TaxTag tax={own} />
                  <span className="lx-muted lx-detail__aside">
                    {' '}
                    propio de esta oferta
                  </span>
                </>
              ) : (
                <TaxTag tax={companyTax} inherited={!!companyTax} />
              )}
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

        {/*
         * ── E6 slot (owned by the E6/E7 engineer) ──────────────────────
         * Mount <OfferTermsSection offer={offer} /> here: validity, versions
         * and quote requests sit after «Comparar» and before notes. The
         * price block above stays this file's (E5 taxes).
         */}
        {!gone && <OfferTermsSection offer={offer} />}

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
  // E6: expired offers are never ranked, as in the catalogue's «Comparar».
  const expired = useExpiredOffers();
  const comparison = useMemo(
    () => compareOffer(offer, offers, {expired}),
    [offer, offers, expired],
  );
  const selfExpired = expired.has(offer.id);
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
    const {peers, position, ranks, estimates, unknownTax, unpriced, expired} =
      comparison;
    const others = peers.filter(p => p.id !== offer.id);
    const ranked = peers.length >= 2;
    const own = estimates[offer.id];
    const tied =
      position !== null && others.some(p => ranks[p.id] === position);
    const summary = selfExpired
      ? 'Esta oferta está caducada: no se ordena con las demás hasta renovarla.'
      : offer.price === null
        ? 'Esta oferta no tiene precio: no se puede situar entre las demás.'
        : own && own.withTax === null
          ? own.missing === 'treatment'
            ? 'No se puede ordenar hasta saber si su precio incluye impuestos.'
            : 'No se puede ordenar sin conocer su impuesto: indícalo en la oferta o en su empresa.'
          : ranked && position
            ? `Es la ${position === 1 ? '' : `${position}.ª `}más barata de ${
                peers.length
              } comparables${tied ? ', empatada con otra' : ''}, con el impuesto de cada una (estimación).`
            : 'Aún no hay otra oferta con precio e impuesto conocidos: no hay con qué ordenarla.';
    body =
      others.length === 0 &&
      unknownTax.length === 0 &&
      unpriced.length === 0 &&
      expired.length === 0 &&
      !selfExpired ? (
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
            <RankedList
              peers={peers}
              estimates={estimates}
              ranks={ranks}
              selfId={offer.id}
              onShow={onShow}
              id="lx-offer-compare-list"
            />
          )}
          <ApartList
            items={unknownTax.map(p => ({
              offer: p,
              reason: 'tax' as const,
              estimate: estimates[p.id],
            }))}
            title="Sin impuesto conocido · no se ordenan"
            onShow={onShow}
            id="lx-offer-compare-othertax"
          />
          <ApartList
            items={expired.map(p => ({
              offer: p,
              reason: 'expired' as const,
              estimate: estimates[p.id],
            }))}
            title="Caducadas · no se ordenan"
            onShow={onShow}
            id="lx-offer-compare-expired"
          />
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
        <HelpTip label="comparar">{COMPARE_HELP}</HelpTip>
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
  const toastSaved = useLogisticsStore(s => s.toastSaved);
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
    review: mode.review,
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
  // E5: the company's tax as typed in «Empresa» (a new company has none yet).
  const companyTax =
    companies.find(c => nameKey(c.name) === nameKey(values.companyName))?.tax ??
    null;
  const previewEstimate = estimateLine({
    price: amount(values.price),
    unit: values.unit,
    customUnit: nullIfEmpty(values.customUnit),
    vatIncluded: fromVat(values.vat),
    tax: taxInfoOfDraft(values.tax),
    companyTax,
  });
  // Offers recorded before E5 may say their price includes tax, or not say:
  // only they get the question, so nothing is silently reinterpreted.
  const legacyVat = !!base && base.vatIncluded !== false;

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
    tax: taxToSend(v.tax),
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
        const created = await createOffer(inputFrom(values), f.writeOptions);
        f.markSaved();
        toastSaved(created, `Oferta guardada: ${created.name}`);
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
            tax: values.tax,
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
      if (f.changed('tax')) patch.tax = full.tax;
      if (f.changed('conditions')) patch.conditions = full.conditions;
      if (f.changed('source')) patch.source = full.source;
      if (f.changed('verification')) patch.verification = full.verification;
      if (Object.keys(patch).length === 1) {
        toast('No había cambios que guardar.', 'info');
        f.settleReview();
        onSaved(base);
        return;
      }
      const updated = await updateOffer(base.id, patch, f.writeOptions);
      f.markSaved();
      toastSaved(updated, `Cambios guardados: ${updated.name}`);
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
            <UnsentMark id={base.id} />
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
            values.vat === 'no'
              ? 'Precio por unidad, sin impuestos'
              : 'Precio por unidad, tal como se apuntó',
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
          {legacyVat && (
            <Segmented<Vat>
              name="lx-offer-vat"
              id="lx-offer-vat"
              legend="¿Cómo se apuntó este precio?"
              value={values.vat}
              options={VAT_OPTIONS}
              onChange={v => v && change('vat', v)}
              help="Ahora los precios se apuntan siempre sin impuestos. Esta oferta se guardó antes con otro criterio y se respeta tal cual: no se le inventa ningún porcentaje. Si escribes el precio sin impuestos, elige «Sin impuestos»."
            />
          )}
          <TaxField
            id="lx-offer-tax"
            legend="Impuesto de esta oferta"
            value={values.tax}
            onChange={v => change('tax', v)}
            emptyLabel="Como la empresa"
            emptyHint={inheritHint(companyTax)}
            error={taxFieldError(values.tax, errors.tax)}
          />
          <EstimateNote line={previewEstimate} id="lx-offer-estimate-preview" />
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
          title="Calidad de la oferta"
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
