/**
 * A company or entity («Empresas y entidades»): view first, with its phone
 * and e-mail, its responsible person, its people, its offers and its tasks
 * from the plan; «Editar» for members.
 *
 * - Kind: proveedor, organismo público, asociación u otra entidad.
 * - Categories (several) with «+ Nueva categoría».
 * - The responsible person is always one of its own people.
 * - A name already used by another company is refused by the server (409
 *   DUPLICATE): the sheet offers «Abrir la existente»; look-alikes are
 *   flagged while typing.
 * - Deleting says what happens: its offers are deleted, its people and its
 *   tasks lose the company.
 */
import React, {useCallback, useMemo, useState} from 'react';
import {phoneInfo} from '../../../shared/logistics/contact-links.ts';
import type {
  Company,
  CompanyInput,
  CompanyKind,
  DataSource,
  Verification,
} from '../../../shared/logistics/contracts.ts';
import {missingForCompany} from '../../../shared/logistics/quality.ts';
import {
  COMPANY_KIND_LABEL,
  COMPANY_KINDS,
  isPlausibleEmail,
  isPlausiblePhone,
  MAX_CATEGORIES_PER_COMPANY,
  WEBSITE_MAX,
} from '../../../shared/logistics/rules.ts';
import {priceLabel} from '../../../shared/logistics/catalogue.ts';
import {CategoryPicker} from '../catalog/CategoryPicker';
import {useActions, type CompanyPrefill} from '../common/actions';
import {RecordHistory} from '../common/RecordHistory';
import {RecordNotes} from '../common/RecordNotes';
import {TaskRow} from '../common/TaskRow';
import {usePlan} from '../common/usePlan';
import {DemoChip, VerificationChip} from '../events/EventChips';
import {
  DeleteStrip,
  DiscardStrip,
  FormNotices,
  Provenance,
  QualityFields,
  ReadOnlyNotice,
  useAlertFocus,
} from '../forms/FormParts';
import {useRecordForm, type FormErrors} from '../forms/useRecordForm';
import {UnsentMark} from '../offline/PendingMark';
import type {FormReview} from '../offline/review';
import {
  categoryNames,
  contactsOfCompany,
  offersOfCompany,
  tasksOfCompany,
} from '../lib/directory';
import {SOURCE_LABEL, VERIFICATION_LABEL} from '../lib/events';
import {initials, plural} from '../lib/format';
import {sortTasks} from '../lib/tasks';
import {WorkOrderSheet} from '../orders/WorkOrderSheet';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {
  Button,
  Field,
  Icon,
  Input,
  Segmented,
  Select,
  Sheet,
  Textarea,
  Withheld,
  describedBy,
} from '../ui';
import {
  GoneNotice,
  KindChip,
  MissingHint,
  Value,
  useGone,
} from './DirectoryParts';
import {LookAlike} from './NameHelpers';
import {formatDial, ReachOut} from './ReachOut';

type RescuedValues = Record<string, unknown>;

export type CompanySheetMode =
  | {kind: 'view'; company: Company}
  | {
      kind: 'create';
      prefill?: CompanyPrefill;
      rescued?: RescuedValues;
      review?: FormReview;
    }
  | {
      kind: 'edit';
      company: Company;
      rescued?: RescuedValues;
      review?: FormReview;
    };

interface FormValues {
  name: string;
  kind: CompanyKind;
  categoryIds: string[];
  phone: string;
  email: string;
  website: string;
  notes: string;
  mainContactId: string;
  source: DataSource | null;
  verification: Verification;
}

const EMPTY: FormValues = {
  name: '',
  kind: 'supplier',
  categoryIds: [],
  phone: '',
  email: '',
  website: '',
  notes: '',
  mainContactId: '',
  source: null,
  verification: 'draft',
};

const toValues = (c: Company): FormValues => ({
  name: c.name,
  kind: c.kind,
  categoryIds: [...c.categoryIds],
  phone: c.phone ?? '',
  email: c.email ?? '',
  website: c.website ?? '',
  notes: c.notes ?? '',
  mainContactId: c.mainContactId ?? '',
  source: c.source,
  verification: c.verification,
});

const TEXT_KEYS = [
  'name',
  'phone',
  'email',
  'website',
  'notes',
  'mainContactId',
] as const;

function fromRescue(raw: RescuedValues, fallback: FormValues): FormValues {
  const out = {...fallback};
  for (const k of TEXT_KEYS) if (typeof raw[k] === 'string') out[k] = raw[k];
  if (typeof raw.kind === 'string' && raw.kind in COMPANY_KIND_LABEL) {
    out.kind = raw.kind as CompanyKind;
  }
  if (
    Array.isArray(raw.categoryIds) &&
    raw.categoryIds.every(x => typeof x === 'string')
  ) {
    out.categoryIds = raw.categoryIds as string[];
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
  kind: 'kind',
  categoryIds: 'categoryIds',
  phone: 'phone',
  email: 'email',
  website: 'website',
  notes: 'notes',
  mainContactId: 'mainContactId',
  source: 'source',
  verification: 'verification',
};

const KIND_HELP: Record<CompanyKind, string> = {
  supplier: 'Empresa que presta un servicio o alquila material.',
  public_body: 'Ayuntamiento, área municipal, policía, cabildo…',
  association: 'Asociación vecinal, cultural, de comerciantes…',
  other: 'Cualquier otra organización.',
};

const KIND_OPTIONS = COMPANY_KINDS.map(k => ({
  value: k,
  label: COMPANY_KIND_LABEL[k],
  title: KIND_HELP[k],
}));

function validate(v: FormValues): FormErrors<FormValues> {
  const e: FormErrors<FormValues> = {};
  if (!v.name.trim()) e.name = 'Escribe el nombre, aunque sea provisional.';
  if (v.phone.trim() && !isPlausiblePhone(v.phone)) {
    e.phone =
      'Escribe solo el número: cifras, espacios, guiones y + (por ejemplo 922 00 00 01).';
  }
  if (v.email.trim() && !isPlausibleEmail(v.email)) {
    e.email = 'Revisa el correo: tiene que ser como nombre@dominio.es.';
  }
  if (v.website.trim().length > WEBSITE_MAX) {
    e.website = `Como mucho ${WEBSITE_MAX} caracteres.`;
  }
  if (v.categoryIds.length > MAX_CATEGORIES_PER_COMPANY) {
    e.categoryIds = `Como mucho ${MAX_CATEGORIES_PER_COMPANY} categorías.`;
  }
  return e;
}

const nullIfEmpty = (s: string) => (s.trim() ? s.trim() : null);

/** «example.com» → «https://example.com» for the link (text stays as typed). */
function websiteHref(raw: string): string | null {
  const v = raw.trim();
  if (!v || /\s/.test(v)) return null;
  const url = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

export const CompanySheet: React.FC<{
  mode: CompanySheetMode | null;
  onClose: () => void;
}> = ({mode, onClose}) =>
  mode ? <CompanySheetBody initial={mode} onClose={onClose} /> : null;

const CompanySheetBody: React.FC<{
  initial: CompanySheetMode;
  onClose: () => void;
}> = ({initial, onClose}) => {
  const [mode, setMode] = useState(initial);
  if (mode.kind === 'view') {
    return (
      <CompanyView
        company={mode.company}
        onClose={onClose}
        onEdit={c => setMode({kind: 'edit', company: c})}
      />
    );
  }
  return (
    <CompanyForm
      mode={mode}
      onClose={onClose}
      onSaved={c => setMode({kind: 'view', company: c})}
      onShow={c => setMode({kind: 'view', company: c})}
    />
  );
};

// ---------------------------------------------------------------- view

const CompanyView: React.FC<{
  company: Company;
  onClose: () => void;
  onEdit: (company: Company) => void;
}> = ({company: opened, onClose, onEdit}) => {
  const live = useLogisticsStore(s =>
    s.companies.find(c => c.id === opened.id),
  );
  const loaded = useLogisticsStore(s => s.companiesState === 'ready');
  const allContacts = useLogisticsStore(s => s.contacts);
  const allOffers = useLogisticsStore(s => s.offers);
  const allTasks = useLogisticsStore(s => s.tasks);
  const categories = useLogisticsStore(s => s.categories);
  const {
    canWrite,
    openContact,
    openOffer,
    openTask,
    addContact,
    addOffer,
    addTask,
  } = useActions();
  const plan = usePlan();
  const company = live ?? opened;
  const gone = useGone(live, loaded);
  const people = contactsOfCompany(allContacts, company.id);
  const offers = offersOfCompany(allOffers, company.id);
  const tasks = sortTasks(tasksOfCompany(allTasks, company.id));
  const main = people.find(p => p.id === company.mainContactId);
  const names = categoryNames(categories);
  const cats = company.categoryIds.map(id => names.get(id)).filter(Boolean);
  const info = company.phone ? phoneInfo(company.phone) : null;
  const w = company.restricted;
  const href = company.website ? websiteHref(company.website) : null;
  const [ordering, setOrdering] = useState(false);

  return (
    <Sheet
      open
      onClose={onClose}
      id="lx-company-sheet"
      eyebrow={COMPANY_KIND_LABEL[company.kind]}
      title={company.name}
      meta={
        <>
          <UnsentMark id={company.id} />
          {company.isDemo && <DemoChip />}
          <KindChip kind={company.kind} />
          <VerificationChip verification={company.verification} />
          {cats.length > 0 && (
            <span className="lx-sheet__sub">{cats.join(', ')}</span>
          )}
        </>
      }
      footer={
        canWrite && !gone ? (
          <>
            <Button variant="ghost" onClick={onClose} id="lx-company-close">
              Cerrar
            </Button>
            <span className="lx-sheet__foot-spacer" />
            <Button
              variant="primary"
              icon="edit"
              id="lx-company-edit"
              onClick={() => onEdit(company)}
            >
              Editar
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={onClose} id="lx-company-close">
            Cerrar
          </Button>
        )
      }
    >
      <div className="lx-record">
        {gone && <GoneNotice what="Esta empresa o entidad" />}
        {!canWrite && <ReadOnlyNotice />}
        <ReachOut
          target={company}
          idPrefix="lx-company-reach"
          onAddMissing={canWrite && !gone ? () => onEdit(company) : undefined}
        />
        <MissingHint
          missing={missingForCompany(company)}
          id="lx-company-missing"
        />

        {main && (
          <div className="lx-maincontact" id="lx-company-main">
            <button
              type="button"
              className="lx-maincontact__who"
              onClick={() => openContact(main)}
            >
              <span className="lx-avatar" aria-hidden="true">
                {initials(main.name)}
              </span>
              <span className="lx-maincontact__text">
                <span className="lx-eyebrow">Persona responsable</span>
                <strong>{main.name}</strong>
                {main.role && <span className="lx-muted">{main.role}</span>}
              </span>
              <Icon name="chevronRight" size={18} />
            </button>
            <ReachOut target={main} idPrefix="lx-company-main-reach" compact />
          </div>
        )}

        <dl className="lx-detail" id="lx-company-detail">
          <div>
            <dt>Teléfono</dt>
            <dd className="lx-num">
              <Value
                value={info ? formatDial(info) : company.phone}
                withheld={w}
              />
              {info?.warning && (
                <span className="lx-detail__warn">{info.warning}</span>
              )}
            </dd>
          </div>
          <div>
            <dt>Correo</dt>
            <dd>
              <Value value={company.email} withheld={w} />
            </dd>
          </div>
          <div>
            <dt>Web</dt>
            <dd>
              {company.website ? (
                href ? (
                  <a
                    className="lx-link"
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {company.website}
                    <Icon name="globe" size={15} />
                  </a>
                ) : (
                  company.website
                )
              ) : (
                <Value value={null} empty="—" />
              )}
            </dd>
          </div>
          <div>
            <dt>Categorías</dt>
            <dd>
              <Value value={cats.length ? cats.join(', ') : null} />
            </dd>
          </div>
          <div>
            <dt>Observaciones</dt>
            <dd className="lx-detail__notes">
              <Value value={company.notes} withheld={w} empty="—" />
            </dd>
          </div>
          <div>
            <dt>Origen del dato</dt>
            <dd>
              <Value value={company.source && SOURCE_LABEL[company.source]} />
            </dd>
          </div>
        </dl>

        <section
          className="lx-subsection"
          id="lx-company-people"
          aria-labelledby="lx-company-people-title"
        >
          <div className="lx-subsection__head">
            <h3 className="lx-subsection__title" id="lx-company-people-title">
              Personas
              <span className="lx-count lx-num">{people.length}</span>
            </h3>
            {canWrite && !gone && (
              <Button
                size="sm"
                icon="plus"
                id="lx-company-add-person"
                onClick={() => addContact({companyName: company.name})}
              >
                Añadir persona
              </Button>
            )}
          </div>
          {people.length ? (
            <ul className="lx-linklist">
              {people.map(p => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="lx-linkrow"
                    onClick={() => openContact(p)}
                  >
                    <span
                      className="lx-avatar lx-avatar--sm"
                      aria-hidden="true"
                    >
                      {initials(p.name)}
                    </span>
                    <span className="lx-linkrow__title">{p.name}</span>
                    <span className="lx-linkrow__meta">
                      {p.id === company.mainContactId
                        ? 'Responsable'
                        : (p.role ?? '')}
                    </span>
                    <Icon name="chevronRight" size={16} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="lx-muted">Sin personas registradas.</p>
          )}
        </section>

        <section
          className="lx-subsection"
          id="lx-company-offers"
          aria-labelledby="lx-company-offers-title"
        >
          <div className="lx-subsection__head">
            <h3 className="lx-subsection__title" id="lx-company-offers-title">
              Ofertas
              <span className="lx-count lx-num">{offers.length}</span>
            </h3>
            {canWrite && !gone && (
              <Button
                size="sm"
                icon="plus"
                id="lx-company-add-offer"
                onClick={() => addOffer({companyName: company.name})}
              >
                Añadir oferta
              </Button>
            )}
          </div>
          {offers.length ? (
            <ul className="lx-linklist">
              {offers.map(o => {
                const price = priceLabel(o);
                return (
                  <li key={o.id}>
                    <button
                      type="button"
                      className="lx-linkrow"
                      onClick={() => openOffer(o)}
                    >
                      <Icon name="offer" size={18} />
                      <span className="lx-linkrow__title">{o.name}</span>
                      <span className="lx-linkrow__meta lx-num">
                        {price ??
                          (o.restricted ? (
                            <Withheld>Precio: equipo</Withheld>
                          ) : (
                            'Precio pendiente'
                          ))}
                      </span>
                      <Icon name="chevronRight" size={16} />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="lx-muted">Sin ofertas en el catálogo.</p>
          )}
        </section>

        <section
          className="lx-subsection"
          id="lx-company-tasks"
          aria-labelledby="lx-company-tasks-title"
        >
          <div className="lx-subsection__head">
            <h3 className="lx-subsection__title" id="lx-company-tasks-title">
              Tareas en el plan
              <span className="lx-count lx-num">{tasks.length}</span>
            </h3>
            {canWrite && !gone && (
              <span className="lx-subsection__actions">
                {tasks.length > 0 && (
                  <Button
                    size="sm"
                    variant="primary"
                    icon="order"
                    id="lx-company-work-order"
                    onClick={() => setOrdering(true)}
                  >
                    Orden de trabajo
                  </Button>
                )}
                <Button
                  size="sm"
                  icon="plus"
                  id="lx-company-add-task"
                  onClick={() =>
                    addTask({
                      companyName: company.name,
                      contactId: company.mainContactId,
                    })
                  }
                >
                  Añadir tarea
                </Button>
              </span>
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
            <p className="lx-muted">No tiene tareas asignadas.</p>
          )}
        </section>

        <RecordNotes
          target={{type: 'company', id: company.id}}
          prefill={{
            ref: {type: 'company', id: company.id, label: company.name},
          }}
          idPrefix="lx-company"
          canAdd={!gone}
        />
        <RecordHistory
          entityType="company"
          entityId={company.id}
          version={company.version}
          idPrefix="lx-company"
        />
        <Provenance record={company} id="lx-company-provenance" />
      </div>
      {ordering && canWrite && (
        <WorkOrderSheet
          recipient={{kind: 'company', id: company.id, name: company.name}}
          phone={company.phone}
          email={company.email}
          onClose={() => setOrdering(false)}
        />
      )}
    </Sheet>
  );
};

// ---------------------------------------------------------------- form

const CompanyForm: React.FC<{
  mode: Exclude<CompanySheetMode, {kind: 'view'}>;
  onClose: () => void;
  onSaved: (company: Company) => void;
  /** Shows another company's card in this sheet (the existing duplicate). */
  onShow: (company: Company) => void;
}> = ({mode, onClose, onSaved, onShow}) => {
  const createCompany = useLogisticsStore(s => s.createCompany);
  const updateCompany = useLogisticsStore(s => s.updateCompany);
  const deleteCompany = useLogisticsStore(s => s.deleteCompany);
  const toast = useLogisticsStore(s => s.toast);
  const toastSaved = useLogisticsStore(s => s.toastSaved);
  const companies = useLogisticsStore(s => s.companies);
  const contacts = useLogisticsStore(s => s.contacts);
  const offers = useLogisticsStore(s => s.offers);
  const tasks = useLogisticsStore(s => s.tasks);
  const [duplicate, setDuplicate] = useState<Company | null>(null);
  const duplicateRef = useAlertFocus(duplicate);

  const editing = mode.kind === 'edit' ? mode.company : null;
  const blank = useMemo<FormValues>(
    () =>
      mode.kind === 'create'
        ? {...EMPTY, name: mode.prefill?.name ?? ''}
        : EMPTY,
    // Only the opening values matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const toValuesCb = useCallback(toValues, []);
  const f = useRecordForm<FormValues, Company>({
    entity: 'company',
    editing,
    blank,
    toValues: toValuesCb,
    rescued: mode.rescued,
    review: mode.review,
    fromRescue,
    serverField: SERVER_FIELD,
    onClose: () => (f.base ? onShow(f.base) : onClose()),
    onDuplicate: current => {
      const existing =
        current && typeof current === 'object'
          ? (current as Company)
          : (companies.find(
              c =>
                c.name.trim().toLocaleLowerCase('es-ES') ===
                f.values.name.trim().toLocaleLowerCase('es-ES'),
            ) ?? null);
      setDuplicate(existing);
      if (!existing) {
        f.setErrors({name: 'Ya hay una empresa o entidad con ese nombre.'});
      }
    },
  });
  const {values, set, errors, base, saving} = f;
  const isCreate = !base;
  const people = base ? contactsOfCompany(contacts, base.id) : [];
  const offerCount = base ? offersOfCompany(offers, base.id).length : 0;
  const taskCount = base ? tasksOfCompany(tasks, base.id).length : 0;
  const info = values.phone.trim() ? phoneInfo(values.phone) : null;

  const change = <K extends keyof FormValues>(k: K, v: FormValues[K]) => {
    set(k, v);
    if (k === 'name') setDuplicate(null);
  };

  const inputFrom = (v: FormValues): CompanyInput => ({
    name: v.name.trim(),
    kind: v.kind,
    categoryIds: v.categoryIds,
    phone: nullIfEmpty(v.phone),
    email: nullIfEmpty(v.email),
    website: nullIfEmpty(v.website),
    notes: nullIfEmpty(v.notes),
    mainContactId: v.mainContactId || null,
    source: v.source,
    verification: v.verification,
  });

  const submit = async () => {
    if (saving) return;
    const found = validate(values);
    if (Object.keys(found).length) {
      f.setErrors(found);
      document.getElementById(`lx-company-${Object.keys(found)[0]}`)?.focus();
      return;
    }
    f.setSaving('save');
    f.setErrors({});
    setDuplicate(null);
    try {
      if (!base) {
        const {mainContactId: _main, ...input} = inputFrom(values);
        void _main;
        const created = await createCompany(input, f.writeOptions);
        f.markSaved();
        toastSaved(created, `Empresa o entidad guardada: ${created.name}`);
        onSaved(created);
        return;
      }
      const full = inputFrom(values);
      const patch: CompanyInput = {version: base.version};
      const keys = [
        'name',
        'kind',
        'categoryIds',
        'phone',
        'email',
        'website',
        'notes',
        'mainContactId',
        'source',
        'verification',
      ] as const;
      for (const k of keys) {
        if (f.changed(k)) Object.assign(patch, {[k]: full[k]});
      }
      if (Object.keys(patch).length === 1) {
        toast('No había cambios que guardar.', 'info');
        f.settleReview();
        onSaved(base);
        return;
      }
      const updated = await updateCompany(base.id, patch, f.writeOptions);
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
      await deleteCompany(base);
      toast(`Empresa o entidad borrada: ${base.name}`, 'success');
      onClose();
    } catch (err) {
      f.setConfirm(null);
      f.applyServerError(err, 'delete');
    } finally {
      f.setSaving(null);
    }
  };

  const consequences = [
    offerCount
      ? `Se borrarán sus ${plural(offerCount, 'oferta', 'ofertas')} del catálogo.`
      : '',
    people.length
      ? `${plural(people.length, 'persona se quedará', 'personas se quedarán')} sin empresa.`
      : '',
    taskCount
      ? `${plural(taskCount, 'tarea perderá', 'tareas perderán')} la empresa responsable.`
      : '',
    'No se puede deshacer.',
  ]
    .filter(Boolean)
    .join(' ');

  const footer =
    f.confirm === 'discard' ? (
      <DiscardStrip
        idPrefix="lx-company-discard"
        onKeep={f.keepEditing}
        onDiscard={f.discard}
        leavingFor={f.leavingFor}
      />
    ) : f.confirm === 'delete' && base ? (
      <DeleteStrip
        idPrefix="lx-company"
        question={<>¿Borrar «{base.name}»?</>}
        detail={consequences}
        busy={saving === 'delete'}
        onKeep={() => f.setConfirm(null)}
        onDelete={() => void remove()}
      />
    ) : (
      <>
        {base && (
          <Button
            variant="ghost"
            icon="trash"
            className="lx-btn--danger-text"
            id="lx-company-delete"
            disabled={!!saving}
            onClick={() => f.setConfirm('delete')}
          >
            Borrar
          </Button>
        )}
        <Button variant="ghost" onClick={f.requestClose} id="lx-company-cancel">
          Cancelar
        </Button>
        <span className="lx-sheet__foot-spacer" />
        <Button
          variant="primary"
          id="lx-company-save"
          busy={saving === 'save'}
          disabled={saving === 'delete' || !!f.conflict}
          onClick={() => void submit()}
        >
          {saving === 'save' ? 'Guardando…' : 'Guardar'}
        </Button>
      </>
    );

  return (
    <Sheet
      open
      onClose={f.requestClose}
      id="lx-company-sheet"
      eyebrow={
        isCreate ? 'Nueva empresa o entidad' : 'Editar empresa o entidad'
      }
      title={isCreate ? 'Añadir empresa o entidad' : base.name}
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
        id="lx-company-form"
        className="lx-form"
        noValidate
        onSubmit={e => {
          e.preventDefault();
          void submit();
        }}
      >
        <FormNotices
          idPrefix="lx-company"
          subject="esta empresa o entidad"
          conflict={f.conflict}
          conflictOn={f.conflictOn}
          ownConflict={f.ownConflict}
          onLoadCurrent={f.loadCurrent}
          rescued={f.rescuedNotice}
          currentLoaded={f.conflictResolved}
          error={errors.form}
          alertRef={f.alertRef}
          merge={f.merge}
        />
        {duplicate && (
          <div
            className="lx-conflict"
            role="alert"
            id="lx-company-duplicate"
            tabIndex={-1}
            ref={el => {
              duplicateRef.current = el;
            }}
          >
            <Icon name="alert" size={20} />
            <div>
              <p className="lx-conflict__title">Ya existe «{duplicate.name}»</p>
              <p>
                No se ha guardado: dos empresas o entidades no pueden tener el
                mismo nombre. Abre la existente o cambia el nombre.
              </p>
              <Button
                size="sm"
                variant="primary"
                id="lx-company-open-existing"
                onClick={() =>
                  f.leaveFor(
                    duplicate.name,
                    () => {
                      // A reviewed queued change gives way to the existing one.
                      f.settleReview();
                      onShow(duplicate);
                    },
                    ['name'],
                  )
                }
              >
                Abrir la existente
              </Button>
            </div>
          </div>
        )}

        <Field id="lx-company-name" label="Nombre" error={errors.name}>
          <Input
            id="lx-company-name"
            name="lx-company-name"
            data-autofocus
            value={values.name}
            invalid={!!errors.name}
            aria-describedby={describedBy('lx-company-name', {
              error: errors.name,
            })}
            placeholder="Carpas Demo"
            autoComplete="off"
            autoCapitalize="words"
            onChange={e => change('name', e.target.value)}
          />
        </Field>
        {(isCreate || f.changed('name')) && !duplicate && (
          <LookAlike
            id="lx-company-lookalike"
            name={values.name}
            candidates={companies}
            excludeId={base?.id}
            noun="la misma"
            describe={c => COMPANY_KIND_LABEL[c.kind]}
            onOpen={c => f.leaveFor(c.name, () => onShow(c), ['name'])}
          />
        )}

        <Segmented<CompanyKind>
          name="lx-company-kind"
          id="lx-company-kind"
          legend="Tipo"
          value={values.kind}
          options={KIND_OPTIONS}
          onChange={v => v && change('kind', v)}
          help="Proveedor: presta un servicio o alquila material. Organismo público: ayuntamiento, área municipal, cabildo… Asociación: vecinal, cultural, de comerciantes. Otra entidad: cualquier otra organización."
        />

        <CategoryPicker
          idPrefix="lx-company"
          legend="Categorías"
          multiple
          value={values.categoryIds}
          onChange={ids => change('categoryIds', ids)}
          error={errors.categoryIds}
          lockedIds={base?.categoryIds}
          help="Qué tipo de servicios ofrece. Sirven para filtrar el catálogo y la búsqueda. Puedes añadir categorías nuevas para toda la organización."
        />

        <div className="lx-form__row lx-form__row--2">
          <Field
            id="lx-company-phone"
            label="Teléfono"
            optional
            error={errors.phone}
            hint={
              info?.warning ??
              (info?.international
                ? `Se marcará como ${formatDial(info)}.`
                : undefined)
            }
          >
            <Input
              id="lx-company-phone"
              name="lx-company-phone"
              type="tel"
              inputMode="tel"
              className="lx-num"
              value={values.phone}
              invalid={!!errors.phone}
              aria-describedby={describedBy('lx-company-phone', {
                error: errors.phone,
                hint: info?.warning || info?.international,
              })}
              placeholder="+34 000 000 000"
              autoComplete="off"
              onChange={e => change('phone', e.target.value)}
            />
          </Field>
          <Field
            id="lx-company-email"
            label="Correo"
            optional
            error={errors.email}
          >
            <Input
              id="lx-company-email"
              name="lx-company-email"
              type="email"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              value={values.email}
              invalid={!!errors.email}
              placeholder="info@example.com"
              autoComplete="off"
              onChange={e => change('email', e.target.value)}
            />
          </Field>
        </div>

        <Field
          id="lx-company-website"
          label="Web"
          optional
          error={errors.website}
        >
          <Input
            id="lx-company-website"
            name="lx-company-website"
            type="url"
            inputMode="url"
            autoCapitalize="none"
            spellCheck={false}
            value={values.website}
            invalid={!!errors.website}
            placeholder="www.example.com"
            autoComplete="off"
            onChange={e => change('website', e.target.value)}
          />
        </Field>

        {base && (
          <Field
            id="lx-company-mainContactId"
            label="Persona responsable"
            optional
            error={errors.mainContactId}
            hint={
              people.length
                ? 'A quien llamar primero. Tiene que ser una de sus personas.'
                : 'Añade personas a esta empresa para elegir quién es la responsable.'
            }
          >
            <Select
              id="lx-company-mainContactId"
              name="lx-company-mainContactId"
              value={values.mainContactId}
              disabled={!people.length}
              aria-describedby={describedBy('lx-company-mainContactId', {
                error: errors.mainContactId,
                hint: true,
              })}
              onChange={e => change('mainContactId', e.target.value)}
            >
              <option value="">Sin persona responsable</option>
              {people.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.role ? ` · ${p.role}` : ''}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field
          id="lx-company-notes"
          label="Observaciones"
          optional
          error={errors.notes}
          hint="No se envían al compartir la ficha. No anotes datos de salud ni casos de Punto Violeta."
        >
          <Textarea
            id="lx-company-notes"
            name="lx-company-notes"
            rows={3}
            value={values.notes}
            placeholder="Horario de almacén, condiciones de pago…"
            onChange={e => change('notes', e.target.value)}
          />
        </Field>

        <QualityFields
          idPrefix="lx-company"
          source={values.source}
          verification={values.verification}
          onSource={v => change('source', v)}
          onVerification={v => change('verification', v)}
        />

        {base && <Provenance record={base} id="lx-company-provenance" />}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Sheet>
  );
};
