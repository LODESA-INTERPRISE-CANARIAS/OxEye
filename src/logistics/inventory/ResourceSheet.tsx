/**
 * A resource of the inventory: view first («Editar» turns the same sheet
 * into the form), as in the directory sheets.
 *
 * - Owned material lives in a warehouse (typed by name: an existing one is
 *   linked, a new name creates it) and a place inside it.
 * - A contracted service comes from a company and, optionally, one of its
 *   offers in the catalogue.
 * - Quantity is typed as on site («200», «2,5», «1.000»); empty means «sin
 *   contar», never 0. «Aún por evaluar» keeps quantity and condition
 *   provisional.
 * - Quantity, unit and dimensions are shown as recorded and never combined
 *   into a load on the ground: RESOURCE_LOAD_NOTE explains where that
 *   question is answered (the task's «Carga pesada» and the X-ray check).
 * - Guests see names, quantities and states; location and observations are
 *   «Visible para el equipo».
 */
import React, {useCallback, useMemo, useState} from 'react';
import type {
  DataSource,
  Resource,
  ResourceAvailability,
  ResourceCondition,
  ResourceInput,
  ResourceOwnership,
  Verification,
} from '../../../shared/logistics/contracts.ts';
import {
  formatQuantity,
  parseQuantity,
} from '../../../shared/logistics/inventory.ts';
import {missingForResource} from '../../../shared/logistics/quality.ts';
import {
  DEFAULT_RESOURCE_UNIT,
  DIMENSIONS_MAX,
  LOCATION_MAX,
  MAX_RESOURCE_QUANTITY,
  NOTE_PRIVACY_HINT,
  NOTES_MAX,
  RESOURCE_AVAILABILITIES,
  RESOURCE_AVAILABILITY_LABEL,
  RESOURCE_CONDITIONS,
  RESOURCE_CONDITION_LABEL,
  RESOURCE_OWNERSHIP_LABEL,
  RESOURCE_OWNERSHIPS,
  RESOURCE_UNIT_MAX,
  RESOURCE_UNIT_SUGGESTIONS,
} from '../../../shared/logistics/rules.ts';
import {CategoryPicker} from '../catalog/CategoryPicker';
import {useActions, type ResourcePrefill} from '../common/actions';
import {RecordHistory} from '../common/RecordHistory';
import {RecordNotes} from '../common/RecordNotes';
import {TaskRow} from '../common/TaskRow';
import {usePlan} from '../common/usePlan';
import {
  GoneNotice,
  MissingHint,
  Value,
  useGone,
} from '../contacts/DirectoryParts';
import {CompanyField, FindOrCreateField} from '../contacts/NameHelpers';
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
import {categoryNames, companyByName, offersOfCompany} from '../lib/directory';
import {SOURCE_LABEL, VERIFICATION_LABEL} from '../lib/events';
import {plural} from '../lib/format';
import {sortTasks} from '../lib/tasks';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {
  Button,
  Field,
  HelpTip,
  Icon,
  Input,
  Segmented,
  Select,
  Sheet,
  Textarea,
  describedBy,
} from '../ui';
import {
  AvailabilityChip,
  ConditionChip,
  LoadNoteInline,
  LoadNoteTip,
  QuantityChip,
} from './ResourceParts';

type RescuedValues = Record<string, unknown>;

export type ResourceSheetMode =
  | {kind: 'view'; resource: Resource}
  | {
      kind: 'create';
      prefill?: ResourcePrefill;
      rescued?: RescuedValues;
      review?: FormReview;
    }
  | {
      kind: 'edit';
      resource: Resource;
      rescued?: RescuedValues;
      review?: FormReview;
    };

interface FormValues {
  name: string;
  ownership: ResourceOwnership;
  categoryId: string;
  quantity: string;
  unit: string;
  toAssess: boolean;
  dimensions: string;
  condition: ResourceCondition;
  availability: ResourceAvailability;
  warehouseName: string;
  location: string;
  companyName: string;
  offerId: string;
  notes: string;
  source: DataSource | null;
  verification: Verification;
}

const EMPTY: FormValues = {
  name: '',
  ownership: 'owned',
  categoryId: '',
  quantity: '',
  unit: DEFAULT_RESOURCE_UNIT,
  toAssess: false,
  dimensions: '',
  condition: 'unknown',
  availability: 'unknown',
  warehouseName: '',
  location: '',
  companyName: '',
  offerId: '',
  notes: '',
  source: null,
  verification: 'draft',
};

const toValues = (r: Resource): FormValues => ({
  name: r.name,
  ownership: r.ownership,
  categoryId: r.categoryId ?? '',
  quantity: r.quantity === null ? '' : formatQuantity(r.quantity),
  unit: r.unit,
  toAssess: r.toAssess,
  dimensions: r.dimensions ?? '',
  condition: r.condition,
  availability: r.availability,
  warehouseName: r.warehouse?.name ?? '',
  location: r.location ?? '',
  companyName: r.company?.name ?? '',
  offerId: r.offerId ?? '',
  notes: r.notes ?? '',
  source: r.source,
  verification: r.verification,
});

const TEXT_KEYS = [
  'name',
  'categoryId',
  'quantity',
  'unit',
  'dimensions',
  'warehouseName',
  'location',
  'companyName',
  'offerId',
  'notes',
] as const;

function fromRescue(raw: RescuedValues, fallback: FormValues): FormValues {
  const out = {...fallback};
  for (const k of TEXT_KEYS) if (typeof raw[k] === 'string') out[k] = raw[k];
  if (raw.ownership === 'owned' || raw.ownership === 'contracted') {
    out.ownership = raw.ownership;
  }
  if (typeof raw.toAssess === 'boolean') out.toAssess = raw.toAssess;
  if (
    typeof raw.condition === 'string' &&
    raw.condition in RESOURCE_CONDITION_LABEL
  ) {
    out.condition = raw.condition as ResourceCondition;
  }
  if (
    typeof raw.availability === 'string' &&
    raw.availability in RESOURCE_AVAILABILITY_LABEL
  ) {
    out.availability = raw.availability as ResourceAvailability;
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
  name: 'name',
  ownership: 'ownership',
  categoryId: 'categoryId',
  quantity: 'quantity',
  unit: 'unit',
  toAssess: 'toAssess',
  dimensions: 'dimensions',
  condition: 'condition',
  availability: 'availability',
  warehouseId: 'warehouseName',
  warehouseName: 'warehouseName',
  location: 'location',
  companyId: 'companyName',
  companyName: 'companyName',
  offerId: 'offerId',
  notes: 'notes',
  source: 'source',
  verification: 'verification',
};

const OWNERSHIP_HELP =
  'Propio: material de la organización, guardado en un almacén. Contratado: un servicio o alquiler que presta una empresa (aseos portátiles, un escenario alquilado…), con su oferta del catálogo si la hay.';

const TO_ASSESS_HELP =
  'Márcalo cuando aún no se ha contado o revisado con calma: la cantidad que apuntes queda como aproximada («≈») y el estado, por confirmar.';

const OWNERSHIP_OPTIONS = RESOURCE_OWNERSHIPS.map(o => ({
  value: o,
  label: RESOURCE_OWNERSHIP_LABEL[o],
  icon: o === 'owned' ? ('warehouse' as const) : ('building' as const),
}));
const CONDITION_OPTIONS = RESOURCE_CONDITIONS.map(c => ({
  value: c,
  label: RESOURCE_CONDITION_LABEL[c],
}));
const AVAILABILITY_OPTIONS = RESOURCE_AVAILABILITIES.map(a => ({
  value: a,
  label: RESOURCE_AVAILABILITY_LABEL[a],
}));

function quantityProblem(text: string): string | null {
  const v = parseQuantity(text);
  if (v === null || !Number.isNaN(v)) return null;
  return `Escribe solo la cifra, sin unidades: 200, 2,5 o 1.000 (hasta ${formatQuantity(MAX_RESOURCE_QUANTITY)}, con dos decimales como mucho).`;
}

function validate(v: FormValues): FormErrors<FormValues> {
  const e: FormErrors<FormValues> = {};
  if (!v.name.trim()) e.name = 'Escribe el nombre, aunque sea provisional.';
  const q = quantityProblem(v.quantity);
  if (q) e.quantity = q;
  if (v.unit.trim().length > RESOURCE_UNIT_MAX) {
    e.unit = `Como mucho ${RESOURCE_UNIT_MAX} caracteres.`;
  }
  if (v.dimensions.trim().length > DIMENSIONS_MAX) {
    e.dimensions = `Como mucho ${DIMENSIONS_MAX} caracteres.`;
  }
  if (v.location.trim().length > LOCATION_MAX) {
    e.location = `Como mucho ${LOCATION_MAX} caracteres.`;
  }
  if (v.notes.trim().length > NOTES_MAX) {
    e.notes = `Como mucho ${NOTES_MAX} caracteres.`;
  }
  return e;
}

const nullIfEmpty = (s: string) => (s.trim() ? s.trim() : null);

export const ResourceSheet: React.FC<{
  mode: ResourceSheetMode | null;
  onClose: () => void;
}> = ({mode, onClose}) =>
  mode ? <ResourceSheetBody initial={mode} onClose={onClose} /> : null;

const ResourceSheetBody: React.FC<{
  initial: ResourceSheetMode;
  onClose: () => void;
}> = ({initial, onClose}) => {
  const [mode, setMode] = useState(initial);
  if (mode.kind === 'view') {
    return (
      <ResourceView
        resource={mode.resource}
        onClose={onClose}
        onEdit={r => setMode({kind: 'edit', resource: r})}
      />
    );
  }
  return (
    <ResourceForm
      mode={mode}
      onClose={onClose}
      onSaved={r => setMode({kind: 'view', resource: r})}
    />
  );
};

// ---------------------------------------------------------------- view

const ResourceView: React.FC<{
  resource: Resource;
  onClose: () => void;
  onEdit: (resource: Resource) => void;
}> = ({resource: opened, onClose, onEdit}) => {
  const live = useLogisticsStore(s =>
    s.resources.find(r => r.id === opened.id),
  );
  const loaded = useLogisticsStore(s => s.resourcesState === 'ready');
  const allTasks = useLogisticsStore(s => s.tasks);
  const warehouses = useLogisticsStore(s => s.warehouses);
  const companies = useLogisticsStore(s => s.companies);
  const offers = useLogisticsStore(s => s.offers);
  const categories = useLogisticsStore(s => s.categories);
  const {canWrite, openTask, addTask, openWarehouse, openCompany, openOffer} =
    useActions();
  const plan = usePlan();
  const r = live ?? opened;
  const gone = useGone(live, loaded);
  const w = r.restricted;
  const contracted = r.ownership === 'contracted';
  const category = r.categoryId
    ? categoryNames(categories).get(r.categoryId)
    : null;
  const tasks = useMemo(
    () => sortTasks(allTasks.filter(t => r.taskIds.includes(t.id))),
    [allTasks, r.taskIds],
  );
  const hiddenTasks = r.taskIds.length - tasks.length;
  const warehouse = r.warehouse
    ? warehouses.find(x => x.id === r.warehouse!.id)
    : null;
  const company = r.company
    ? companies.find(x => x.id === r.company!.id)
    : null;
  const offer = r.offerId ? offers.find(o => o.id === r.offerId) : null;

  return (
    <Sheet
      open
      onClose={onClose}
      id="lx-resource-sheet"
      eyebrow={contracted ? 'Servicio contratado' : 'Recurso propio'}
      title={r.name}
      meta={
        <>
          <UnsentMark id={r.id} />
          {r.isDemo && <DemoChip />}
          <VerificationChip verification={r.verification} />
          {category && <span className="lx-sheet__sub">{category}</span>}
        </>
      }
      footer={
        canWrite && !gone ? (
          <>
            <Button variant="ghost" onClick={onClose} id="lx-resource-close">
              Cerrar
            </Button>
            <span className="lx-sheet__foot-spacer" />
            <Button
              variant="primary"
              icon="edit"
              id="lx-resource-edit"
              onClick={() => onEdit(r)}
            >
              Editar
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={onClose} id="lx-resource-close">
            Cerrar
          </Button>
        )
      }
    >
      <div className="lx-record">
        {gone && <GoneNotice what="Este recurso" masculine />}
        {!canWrite && <ReadOnlyNotice />}

        <div className="lx-resfacts" id="lx-resource-facts">
          <div className="lx-resfacts__item">
            <span className="lx-resfacts__label">
              Cantidad
              <LoadNoteTip />
            </span>
            <QuantityChip resource={r} size="md" />
          </div>
          <div className="lx-resfacts__item">
            <span className="lx-resfacts__label">Estado</span>
            <ConditionChip condition={r.condition} size="md" />
          </div>
          <div className="lx-resfacts__item">
            <span className="lx-resfacts__label">Disponibilidad</span>
            <AvailabilityChip availability={r.availability} size="md" />
          </div>
        </div>

        <MissingHint missing={missingForResource(r)} id="lx-resource-missing" />

        <dl className="lx-detail" id="lx-resource-detail">
          <div>
            <dt>Tipo</dt>
            <dd>{RESOURCE_OWNERSHIP_LABEL[r.ownership]}</dd>
          </div>
          <div>
            <dt>Categoría</dt>
            <dd>
              <Value value={category} />
            </dd>
          </div>
          <div>
            <dt>Medidas</dt>
            <dd className="lx-num">
              <Value value={r.dimensions} empty="—" />
            </dd>
          </div>
          {contracted && (
            <>
              <div>
                <dt>Empresa</dt>
                <dd>
                  {r.company ? (
                    company ? (
                      <button
                        type="button"
                        className="lx-link"
                        id="lx-resource-company-link"
                        onClick={() => openCompany(company)}
                      >
                        {r.company.name}
                      </button>
                    ) : (
                      r.company.name
                    )
                  ) : (
                    <Value value={null} />
                  )}
                </dd>
              </div>
              <div>
                <dt>Oferta</dt>
                <dd>
                  {offer ? (
                    <button
                      type="button"
                      className="lx-link"
                      id="lx-resource-offer-link"
                      onClick={() => openOffer(offer)}
                    >
                      {offer.name}
                    </button>
                  ) : (
                    <Value value={null} empty="Sin oferta vinculada" />
                  )}
                </dd>
              </div>
            </>
          )}
          <div>
            <dt>Almacén</dt>
            <dd>
              {r.warehouse ? (
                warehouse ? (
                  <button
                    type="button"
                    className="lx-link"
                    id="lx-resource-warehouse-link"
                    onClick={() => openWarehouse(warehouse)}
                  >
                    {r.warehouse.name}
                  </button>
                ) : (
                  r.warehouse.name
                )
              ) : contracted ? (
                <Value value={null} empty="—" />
              ) : (
                <Value value={null} />
              )}
            </dd>
          </div>
          <div>
            <dt>Ubicación en el almacén</dt>
            <dd>
              <Value value={r.location} withheld={w} empty="—" />
            </dd>
          </div>
          <div>
            <dt>Observaciones</dt>
            <dd className="lx-detail__notes">
              <Value value={r.notes} withheld={w} empty="—" />
            </dd>
          </div>
          <div>
            <dt>Origen del dato</dt>
            <dd>
              <Value value={r.source && SOURCE_LABEL[r.source]} />
            </dd>
          </div>
        </dl>

        <section
          className="lx-subsection"
          id="lx-resource-tasks"
          aria-labelledby="lx-resource-tasks-title"
        >
          <div className="lx-subsection__head">
            <h3 className="lx-subsection__title" id="lx-resource-tasks-title">
              Tareas que lo usan
              <span className="lx-count lx-num">{r.taskIds.length}</span>
            </h3>
            {canWrite && !gone && (
              <Button
                size="sm"
                icon="plus"
                id="lx-resource-add-task"
                onClick={() =>
                  addTask({
                    resourceIds: [r.id],
                    companyName: contracted ? (r.company?.name ?? null) : null,
                  })
                }
              >
                Añadir tarea
              </Button>
            )}
          </div>
          {tasks.length ? (
            <ul className="lx-tasklist">
              {tasks.map(t => (
                <li key={t.id}>
                  <TaskRow
                    task={t}
                    warnings={plan.byTask.get(t.id)}
                    showDate
                    onOpen={openTask}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="lx-muted">
              Ninguna tarea del plan cuenta con este recurso.
            </p>
          )}
          {hiddenTasks > 0 && (
            <p className="lx-muted">
              {plural(
                hiddenTasks,
                'tarea más aún no cargada',
                'tareas más aún no cargadas',
              )}
              .
            </p>
          )}
        </section>

        <RecordNotes
          target={{type: 'resource', id: r.id}}
          prefill={{ref: {type: 'resource', id: r.id, label: r.name}}}
          idPrefix="lx-resource"
          canAdd={!gone}
        />
        <RecordHistory
          entityType="resource"
          entityId={r.id}
          version={r.version}
          idPrefix="lx-resource"
        />
        <Provenance record={r} id="lx-resource-provenance" />
      </div>
    </Sheet>
  );
};

// ---------------------------------------------------------------- form

const ResourceForm: React.FC<{
  mode: Exclude<ResourceSheetMode, {kind: 'view'}>;
  onClose: () => void;
  onSaved: (resource: Resource) => void;
}> = ({mode, onClose, onSaved}) => {
  const createResource = useLogisticsStore(s => s.createResource);
  const updateResource = useLogisticsStore(s => s.updateResource);
  const deleteResource = useLogisticsStore(s => s.deleteResource);
  const toast = useLogisticsStore(s => s.toast);
  const toastSaved = useLogisticsStore(s => s.toastSaved);
  const warehouses = useLogisticsStore(s => s.warehouses);
  const companies = useLogisticsStore(s => s.companies);
  const offers = useLogisticsStore(s => s.offers);
  const [savedName, setSavedName] = useState<string | null>(null);

  const editing = mode.kind === 'edit' ? mode.resource : null;
  const blank = useMemo<FormValues>(
    () =>
      mode.kind === 'create'
        ? {
            ...EMPTY,
            name: mode.prefill?.name ?? '',
            ownership: mode.prefill?.ownership ?? 'owned',
            warehouseName: mode.prefill?.warehouseName ?? '',
            companyName: mode.prefill?.companyName ?? '',
            categoryId: mode.prefill?.categoryId ?? '',
          }
        : EMPTY,
    // Only the opening values matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const toValuesCb = useCallback(toValues, []);
  const f = useRecordForm<FormValues, Resource>({
    entity: 'resource',
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
  const contracted = values.ownership === 'contracted';

  const knownCompany = useMemo(
    () => companyByName(companies, values.companyName),
    [companies, values.companyName],
  );
  const chosenOffer = values.offerId
    ? (offers.find(o => o.id === values.offerId) ?? null)
    : null;
  // The chosen offer belongs to another company than the one typed. While
  // the name is being typed it is only flagged; leaving the field (or
  // saving) drops it, so a half-typed name never loses the user's choice.
  const offerMismatch =
    !!values.offerId && chosenOffer?.company.id !== knownCompany?.id;

  // Offers of the typed company; with no company yet, every offer (choosing
  // one sets its company, as the server does). The chosen one stays listed
  // until it is dropped, so the select never shows a value it lacks.
  const offerChoices = useMemo(() => {
    const list = knownCompany
      ? offersOfCompany(offers, knownCompany.id)
      : values.companyName.trim()
        ? []
        : offers;
    return chosenOffer && !list.includes(chosenOffer)
      ? [chosenOffer, ...list]
      : list;
  }, [offers, knownCompany, values.companyName, chosenOffer]);

  /** An offer must belong to the resource's company. */
  const withMatchingOffer = (v: FormValues): FormValues => {
    if (!v.offerId) return v;
    const company = companyByName(companies, v.companyName);
    const offer = offers.find(o => o.id === v.offerId);
    return offer && company && offer.company.id === company.id
      ? v
      : {...v, offerId: ''};
  };

  const dropMismatchedOffer = () => {
    if (withMatchingOffer(values).offerId !== values.offerId) {
      set('offerId', '');
    }
  };

  const change = <K extends keyof FormValues>(k: K, v: FormValues[K]) => {
    set(k, v);
    setSavedName(null);
  };

  const pickOffer = (id: string) => {
    change('offerId', id);
    const offer = offers.find(o => o.id === id);
    if (offer && !values.companyName.trim()) {
      set('companyName', offer.company.name);
    }
  };

  const inputFrom = (v: FormValues) => {
    const quantity = parseQuantity(v.quantity);
    return {
      name: v.name.trim(),
      ownership: v.ownership,
      categoryId: v.categoryId || null,
      quantity: quantity === null || Number.isNaN(quantity) ? null : quantity,
      unit: v.unit.trim() || DEFAULT_RESOURCE_UNIT,
      toAssess: v.toAssess,
      dimensions: nullIfEmpty(v.dimensions),
      condition: v.condition,
      availability: v.availability,
      warehouseName: nullIfEmpty(v.warehouseName),
      location: nullIfEmpty(v.location),
      companyName: nullIfEmpty(v.companyName),
      offerId: v.offerId || null,
      notes: nullIfEmpty(v.notes),
      source: v.source,
      verification: v.verification,
    };
  };

  const submit = async (next: boolean) => {
    if (saving) return;
    const found = validate(values);
    if (Object.keys(found).length) {
      f.setErrors(found);
      document.getElementById(`lx-resource-${Object.keys(found)[0]}`)?.focus();
      return;
    }
    f.setSaving(next ? 'next' : 'save');
    f.setErrors({});
    // Saving with a company that does not match the chosen offer drops the
    // offer, as leaving the company field does.
    if (contracted) dropMismatchedOffer();
    const full = inputFrom(contracted ? withMatchingOffer(values) : values);
    try {
      if (!base) {
        const {companyName, offerId, warehouseName, ...rest} = full;
        const input: Omit<ResourceInput, 'organizationId' | 'version'> = {
          ...rest,
          ...(warehouseName ? {warehouseName} : {}),
          // Company and offer only exist for contracted services.
          ...(contracted && companyName ? {companyName} : {}),
          ...(contracted && offerId ? {offerId} : {}),
        };
        const created = await createResource(input, f.writeOptions);
        f.markSaved();
        toastSaved(created, `Recurso guardado: ${created.name}`);
        if (next) {
          // Next item of the same warehouse (or company) and category: what
          // carries over is the new baseline, not a change of its own.
          f.startNext({
            ...EMPTY,
            ownership: values.ownership,
            categoryId: values.categoryId,
            unit: values.unit,
            warehouseName: values.warehouseName,
            companyName: contracted ? values.companyName : '',
            source: values.source,
            verification: values.verification,
          });
          setSavedName(created.name);
          document.getElementById('lx-resource-name')?.focus();
        } else {
          onSaved(created);
        }
        return;
      }
      const patch: ResourceInput = {version: base.version};
      if (f.changed('name')) patch.name = full.name;
      if (f.changed('ownership')) patch.ownership = full.ownership;
      if (f.changed('categoryId')) patch.categoryId = full.categoryId;
      if (f.changed('quantity')) patch.quantity = full.quantity;
      if (f.changed('unit')) patch.unit = full.unit;
      if (f.changed('toAssess')) patch.toAssess = full.toAssess;
      if (f.changed('dimensions')) patch.dimensions = full.dimensions;
      if (f.changed('condition')) patch.condition = full.condition;
      if (f.changed('availability')) patch.availability = full.availability;
      if (f.changed('warehouseName')) {
        if (full.warehouseName) patch.warehouseName = full.warehouseName;
        else {
          patch.warehouseId = null;
          patch.warehouseName = null;
        }
      }
      if (f.changed('location')) patch.location = full.location;
      if (contracted) {
        if (f.changed('companyName')) {
          if (full.companyName) patch.companyName = full.companyName;
          else {
            patch.companyId = null;
            patch.companyName = null;
          }
        }
        if (f.changed('offerId') || f.changed('companyName')) {
          patch.offerId = full.offerId;
        }
      }
      if (f.changed('notes')) patch.notes = full.notes;
      if (f.changed('source')) patch.source = full.source;
      if (f.changed('verification')) patch.verification = full.verification;
      if (Object.keys(patch).length === 1) {
        toast('No había cambios que guardar.', 'info');
        f.settleReview();
        onSaved(base);
        return;
      }
      const updated = await updateResource(base.id, patch, f.writeOptions);
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
      await deleteResource(base);
      toast(`Recurso borrado: ${base.name}`, 'success');
      onClose();
    } catch (err) {
      f.setConfirm(null);
      f.applyServerError(err, 'delete');
    } finally {
      f.setSaving(null);
    }
  };

  const consequences = [
    base?.taskIds.length
      ? `${plural(base.taskIds.length, 'tarea dejará', 'tareas dejarán')} de contar con él.`
      : '',
    'Sus notas se quedan, sin el vínculo.',
    'No se puede deshacer.',
  ]
    .filter(Boolean)
    .join(' ');

  const footer =
    f.confirm === 'discard' ? (
      <DiscardStrip
        idPrefix="lx-resource-discard"
        onKeep={f.keepEditing}
        onDiscard={f.discard}
      />
    ) : f.confirm === 'delete' && base ? (
      <DeleteStrip
        idPrefix="lx-resource"
        question={<>¿Borrar «{base.name}» del inventario?</>}
        detail={consequences}
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
            id="lx-resource-delete"
            disabled={!!saving}
            onClick={() => f.setConfirm('delete')}
          >
            Borrar
          </Button>
        ) : (
          <Button
            variant="ghost"
            onClick={f.requestClose}
            id="lx-resource-cancel"
          >
            Cancelar
          </Button>
        )}
        <span className="lx-sheet__foot-spacer" />
        {isCreate ? (
          <Button
            id="lx-resource-save-next"
            busy={saving === 'next'}
            disabled={saving === 'save'}
            onClick={() => void submit(true)}
          >
            {saving === 'next' ? 'Guardando…' : 'Guardar y seguir'}
          </Button>
        ) : (
          <Button
            variant="ghost"
            onClick={f.requestClose}
            id="lx-resource-cancel"
          >
            Cancelar
          </Button>
        )}
        <Button
          variant="primary"
          id="lx-resource-save"
          busy={saving === 'save'}
          disabled={saving === 'next' || saving === 'delete' || !!f.conflict}
          onClick={() => void submit(false)}
        >
          {saving === 'save' ? 'Guardando…' : 'Guardar'}
        </Button>
      </>
    );

  const quantityHint = values.toAssess
    ? 'Se mostrará como aproximada («≈») hasta que se cuente.'
    : 'Vacío = sin contar (no es lo mismo que 0).';

  return (
    <Sheet
      open
      onClose={f.requestClose}
      id="lx-resource-sheet"
      eyebrow={isCreate ? 'Nuevo recurso' : 'Editar recurso'}
      title={
        isCreate
          ? contracted
            ? 'Añadir servicio contratado'
            : 'Añadir recurso'
          : base.name
      }
      meta={
        base ? (
          <>
            <UnsentMark id={base.id} />
            {base.isDemo && <DemoChip />}
            <VerificationChip verification={base.verification} />
          </>
        ) : (
          <span className="lx-muted">
            Solo el nombre es obligatorio. Lo demás puede quedar pendiente.
          </span>
        )
      }
      footer={footer}
    >
      <form
        id="lx-resource-form"
        className="lx-form"
        noValidate
        onSubmit={e => {
          e.preventDefault();
          void submit(false);
        }}
      >
        <FormNotices
          idPrefix="lx-resource"
          subject="este recurso"
          conflict={f.conflict}
          conflictOn={f.conflictOn}
          ownConflict={f.ownConflict}
          onLoadCurrent={f.loadCurrent}
          rescued={f.rescuedNotice}
          currentLoaded={f.conflictResolved}
          saved={
            savedName && (
              <>
                Guardado «{savedName}». Puedes apuntar el siguiente
                {values.warehouseName.trim()
                  ? ` de ${values.warehouseName.trim()}`
                  : ''}
                .
              </>
            )
          }
          error={errors.form}
          alertRef={f.alertRef}
          merge={f.merge}
        />

        <Field id="lx-resource-name" label="Qué es" error={errors.name}>
          <Input
            id="lx-resource-name"
            name="lx-resource-name"
            data-autofocus
            value={values.name}
            invalid={!!errors.name}
            aria-describedby={describedBy('lx-resource-name', {
              error: errors.name,
            })}
            placeholder={contracted ? 'Aseos portátiles Demo' : 'Vallas Demo'}
            autoComplete="off"
            onChange={e => change('name', e.target.value)}
          />
        </Field>

        <Segmented<ResourceOwnership>
          name="lx-resource-ownership"
          id="lx-resource-ownership"
          legend="Tipo"
          value={values.ownership}
          options={OWNERSHIP_OPTIONS}
          onChange={v => v && change('ownership', v)}
          help={OWNERSHIP_HELP}
        />
        {!isCreate &&
          base.ownership === 'contracted' &&
          !contracted &&
          (base.company || base.offerId) && (
            <p className="lx-notice lx-notice--quiet" role="status">
              <Icon name="alert" size={16} />
              Al pasarlo a propio se quitan la empresa y la oferta.
            </p>
          )}

        <CategoryPicker
          idPrefix="lx-resource"
          legend="Categoría"
          multiple={false}
          scope="resource"
          value={values.categoryId ? [values.categoryId] : []}
          onChange={ids => change('categoryId', ids[0] ?? '')}
          error={errors.categoryId}
          lockedIds={base?.categoryId ? [base.categoryId] : undefined}
          help="Sirve para filtrar el inventario y la búsqueda. Puedes añadir categorías nuevas para toda la organización."
        />

        <div className="lx-form__group" id="lx-resource-amount">
          <p className="lx-form__group-title">
            Cantidad y medidas
            <LoadNoteTip />
          </p>
          <div className="lx-form__row lx-form__row--2">
            <Field
              id="lx-resource-quantity"
              label="Cantidad"
              optional
              error={errors.quantity}
              hint={quantityHint}
            >
              <Input
                id="lx-resource-quantity"
                name="lx-resource-quantity"
                inputMode="decimal"
                className="lx-num"
                value={values.quantity}
                invalid={!!errors.quantity}
                aria-describedby={describedBy('lx-resource-quantity', {
                  error: errors.quantity,
                  hint: true,
                })}
                placeholder="Sin contar"
                autoComplete="off"
                onChange={e => change('quantity', e.target.value)}
                onBlur={() => {
                  const problem = quantityProblem(values.quantity);
                  if (problem) f.setErrors(er => ({...er, quantity: problem}));
                }}
              />
            </Field>
            <Field id="lx-resource-unit" label="Unidad" error={errors.unit}>
              <Input
                id="lx-resource-unit"
                name="lx-resource-unit"
                value={values.unit}
                invalid={!!errors.unit}
                aria-describedby={
                  [
                    describedBy('lx-resource-unit', {error: errors.unit}),
                    'lx-resource-unit-suggestions',
                  ]
                    .filter(Boolean)
                    .join(' ') || undefined
                }
                placeholder={DEFAULT_RESOURCE_UNIT}
                autoComplete="off"
                autoCapitalize="none"
                onChange={e => change('unit', e.target.value)}
              />
            </Field>
          </div>
          <div
            className="lx-suggest lx-unitchips"
            role="group"
            aria-label="Unidades frecuentes"
            id="lx-resource-unit-suggestions"
          >
            {RESOURCE_UNIT_SUGGESTIONS.map(u => (
              <button
                key={u}
                type="button"
                className="lx-suggest__chip"
                aria-pressed={values.unit.trim() === u}
                onClick={() => change('unit', u)}
              >
                {u}
              </button>
            ))}
          </div>
          <LoadNoteInline
            unit={values.unit}
            categoryId={values.categoryId || null}
          />

          <div className="lx-resource__assess">
            <span className="lx-switch">
              <input
                type="checkbox"
                role="switch"
                id="lx-resource-toAssess"
                checked={values.toAssess}
                onChange={e => change('toAssess', e.target.checked)}
              />
              <label htmlFor="lx-resource-toAssess">
                <span className="lx-switch__track" aria-hidden="true" />
                Aún por evaluar
              </label>
            </span>
            <HelpTip label="aún por evaluar">{TO_ASSESS_HELP}</HelpTip>
          </div>

          <Field
            id="lx-resource-dimensions"
            label="Medidas"
            optional
            error={errors.dimensions}
            hint="Tal como se ven: «3 × 6 m», «1,20 m de alto»."
          >
            <Input
              id="lx-resource-dimensions"
              name="lx-resource-dimensions"
              className="lx-num"
              value={values.dimensions}
              invalid={!!errors.dimensions}
              aria-describedby={describedBy('lx-resource-dimensions', {
                error: errors.dimensions,
                hint: true,
              })}
              placeholder="3 × 6 m"
              autoComplete="off"
              onChange={e => change('dimensions', e.target.value)}
            />
          </Field>
        </div>

        <Segmented<ResourceCondition>
          name="lx-resource-condition"
          id="lx-resource-condition"
          legend="Estado"
          value={values.condition}
          options={CONDITION_OPTIONS}
          onChange={v => v && change('condition', v)}
        />
        <Segmented<ResourceAvailability>
          name="lx-resource-availability"
          id="lx-resource-availability"
          legend="Disponibilidad"
          value={values.availability}
          options={AVAILABILITY_OPTIONS}
          onChange={v => v && change('availability', v)}
          help="Si una tarea del plan cuenta con un recurso con daños o en reparación, Hoy lo avisa."
        />

        {contracted && (
          <div
            className="lx-form__group"
            id="lx-resource-provider"
            onBlur={e => {
              // Leaving the company name settles the offer (see above).
              if (e.target.id === 'lx-resource-companyName') {
                dropMismatchedOffer();
              }
            }}
          >
            <p className="lx-form__group-title">Quién lo presta</p>
            <CompanyField
              id="lx-resource-companyName"
              label="Empresa"
              optional
              value={values.companyName}
              onChange={v => change('companyName', v)}
              companies={companies}
              error={errors.companyName}
              placeholder="Alquileres Demo"
            />
            <Field
              id="lx-resource-offerId"
              label="Oferta del catálogo"
              optional
              error={errors.offerId}
              hint={
                offerMismatch && chosenOffer
                  ? `Esta oferta es de «${chosenOffer.company.name}»: se quitará si la empresa no coincide.`
                  : values.companyName.trim() && !knownCompany
                    ? 'Una empresa nueva aún no tiene ofertas en el catálogo.'
                    : knownCompany && !offerChoices.length
                      ? 'Esta empresa aún no tiene ofertas en el catálogo.'
                      : !values.companyName.trim()
                        ? 'Al elegir una oferta se rellena su empresa.'
                        : undefined
              }
            >
              <Select
                id="lx-resource-offerId"
                name="lx-resource-offerId"
                value={values.offerId}
                disabled={!offerChoices.length}
                aria-describedby={describedBy('lx-resource-offerId', {
                  error: errors.offerId,
                  hint: true,
                })}
                onChange={e => pickOffer(e.target.value)}
              >
                <option value="">Sin oferta vinculada</option>
                {offerChoices.map(o => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                    {knownCompany ? '' : ` · ${o.company.name}`}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}

        <div className="lx-form__group" id="lx-resource-where">
          <p className="lx-form__group-title">Dónde está</p>
          <FindOrCreateField
            id="lx-resource-warehouseName"
            label="Almacén"
            optional
            value={values.warehouseName}
            onChange={v => change('warehouseName', v)}
            items={warehouses}
            error={errors.warehouseName}
            placeholder="Almacén Demo"
            icon="warehouse"
            createText={typed => (
              <>
                Se creará el almacén «{typed}»; podrás añadir su dirección
                después.
              </>
            )}
            suggestLabel="Almacenes ya registrados"
          />
          <Field
            id="lx-resource-location"
            label="Ubicación dentro"
            optional
            error={errors.location}
            hint="Solo la ve el equipo."
          >
            <Input
              id="lx-resource-location"
              name="lx-resource-location"
              value={values.location}
              invalid={!!errors.location}
              aria-describedby={describedBy('lx-resource-location', {
                error: errors.location,
                hint: true,
              })}
              placeholder="Nave 2, estantería 3"
              autoComplete="off"
              onChange={e => change('location', e.target.value)}
            />
          </Field>
        </div>

        <Field
          id="lx-resource-notes"
          label="Observaciones"
          optional
          error={errors.notes}
          hint={NOTE_PRIVACY_HINT}
        >
          <Textarea
            id="lx-resource-notes"
            name="lx-resource-notes"
            rows={3}
            value={values.notes}
            aria-describedby={describedBy('lx-resource-notes', {
              error: errors.notes,
              hint: true,
            })}
            placeholder="Faltan dos piquetas; la lona tiene un roce."
            onChange={e => change('notes', e.target.value)}
          />
        </Field>

        <QualityFields
          idPrefix="lx-resource"
          source={values.source}
          verification={values.verification}
          onSource={v => change('source', v)}
          onVerification={v => change('verification', v)}
        />

        {base && (
          <>
            <RecordHistory
              entityType="resource"
              entityId={base.id}
              version={base.version}
              idPrefix="lx-resource-form"
            />
            <Provenance record={base} id="lx-resource-provenance" />
          </>
        )}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Sheet>
  );
};
