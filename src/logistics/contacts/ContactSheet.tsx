/**
 * A person: view first (big «Llamar / WhatsApp / Correo» and «Compartir»),
 * «Editar» for members.
 *
 * - Capturing someone on the street takes only the name; everything else can
 *   stay «Pendiente de verificar». «Guardar y seguir» keeps the company for
 *   the next person of the same supplier.
 * - The company is typed by name: found if it exists, created otherwise.
 * - «¿Es la misma persona que…?» before saving a look-alike name.
 * - Same guarantees as the event and task sheets (`useRecordForm`).
 * - Guests see names, roles and companies; phones, e-mails and observations
 *   come withheld (`restricted`) and show «Visible para el equipo».
 */
import React, {useCallback, useMemo, useRef, useState} from 'react';
import {
  phoneInfo,
  shareableFields,
} from '../../../shared/logistics/contact-links.ts';
import type {
  Contact,
  ContactInput,
  DataSource,
  Verification,
} from '../../../shared/logistics/contracts.ts';
import {missingForContact} from '../../../shared/logistics/quality.ts';
import {
  isPlausibleEmail,
  isPlausiblePhone,
  MAX_EVENTS_PER_CONTACT,
  ROLE_MAX,
} from '../../../shared/logistics/rules.ts';
import {useActions, type ContactPrefill} from '../common/actions';
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
} from '../forms/FormParts';
import {useRecordForm, type FormErrors} from '../forms/useRecordForm';
import {tasksOfContact} from '../lib/directory';
import {WorkOrderSheet} from '../orders/WorkOrderSheet';
import {SOURCE_LABEL, sortEvents, VERIFICATION_LABEL} from '../lib/events';
import {dayMonthShort, plural} from '../lib/format';
import {recordDate, sortTasks} from '../lib/tasks';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Button, Field, Icon, Input, Sheet, Textarea, describedBy} from '../ui';
import {GoneNotice, MissingHint, Value, useGone} from './DirectoryParts';
import {CompanyField, LookAlike} from './NameHelpers';
import {formatDial, ReachOut} from './ReachOut';
import {ShareContactSheet} from './ShareContact';

type RescuedValues = Record<string, unknown>;

export type ContactSheetMode =
  | {kind: 'view'; contact: Contact}
  | {kind: 'create'; prefill?: ContactPrefill; rescued?: RescuedValues}
  | {kind: 'edit'; contact: Contact; rescued?: RescuedValues};

interface FormValues {
  name: string;
  companyName: string;
  role: string;
  phone: string;
  email: string;
  description: string;
  notes: string;
  eventIds: string[];
  source: DataSource | null;
  verification: Verification;
}

const EMPTY: FormValues = {
  name: '',
  companyName: '',
  role: '',
  phone: '',
  email: '',
  description: '',
  notes: '',
  eventIds: [],
  source: null,
  verification: 'draft',
};

const toValues = (c: Contact): FormValues => ({
  name: c.name,
  companyName: c.company?.name ?? '',
  role: c.role ?? '',
  phone: c.phone ?? '',
  email: c.email ?? '',
  description: c.description ?? '',
  notes: c.notes ?? '',
  eventIds: [...c.eventIds],
  source: c.source,
  verification: c.verification,
});

const TEXT_KEYS = [
  'name',
  'companyName',
  'role',
  'phone',
  'email',
  'description',
  'notes',
] as const;

function fromRescue(raw: RescuedValues, fallback: FormValues): FormValues {
  const out = {...fallback};
  for (const k of TEXT_KEYS) if (typeof raw[k] === 'string') out[k] = raw[k];
  if (
    Array.isArray(raw.eventIds) &&
    raw.eventIds.every(x => typeof x === 'string')
  ) {
    out.eventIds = raw.eventIds as string[];
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
  companyName: 'companyName',
  companyId: 'companyName',
  role: 'role',
  phone: 'phone',
  email: 'email',
  description: 'description',
  notes: 'notes',
  eventIds: 'eventIds',
  source: 'source',
  verification: 'verification',
};

function validate(v: FormValues): FormErrors<FormValues> {
  const e: FormErrors<FormValues> = {};
  if (!v.name.trim()) e.name = 'Escribe el nombre, aunque sea solo el de pila.';
  if (v.role.trim().length > ROLE_MAX) {
    e.role = `Como mucho ${ROLE_MAX} caracteres.`;
  }
  if (v.phone.trim() && !isPlausiblePhone(v.phone)) {
    e.phone =
      'Escribe solo el número: cifras, espacios, guiones y + (por ejemplo 600 00 00 01).';
  }
  if (v.email.trim() && !isPlausibleEmail(v.email)) {
    e.email = 'Revisa el correo: tiene que ser como nombre@dominio.es.';
  }
  if (v.eventIds.length > MAX_EVENTS_PER_CONTACT) {
    e.eventIds = `Como mucho ${MAX_EVENTS_PER_CONTACT} eventos.`;
  }
  return e;
}

const nullIfEmpty = (s: string) => (s.trim() ? s.trim() : null);

export const ContactSheet: React.FC<{
  mode: ContactSheetMode | null;
  onClose: () => void;
}> = ({mode, onClose}) =>
  mode ? <ContactSheetBody initial={mode} onClose={onClose} /> : null;

const ContactSheetBody: React.FC<{
  initial: ContactSheetMode;
  onClose: () => void;
}> = ({initial, onClose}) => {
  const [mode, setMode] = useState(initial);
  if (mode.kind === 'view') {
    return (
      <ContactView
        contact={mode.contact}
        onClose={onClose}
        onEdit={c => setMode({kind: 'edit', contact: c})}
      />
    );
  }
  return (
    <ContactForm
      mode={mode}
      onClose={onClose}
      onSaved={c => setMode({kind: 'view', contact: c})}
      onCancelEdit={c => setMode({kind: 'view', contact: c})}
    />
  );
};

// ---------------------------------------------------------------- view

const ContactView: React.FC<{
  contact: Contact;
  onClose: () => void;
  onEdit: (contact: Contact) => void;
}> = ({contact: opened, onClose, onEdit}) => {
  const live = useLogisticsStore(s => s.contacts.find(c => c.id === opened.id));
  const loaded = useLogisticsStore(s => s.contactsState === 'ready');
  const companies = useLogisticsStore(s => s.companies);
  const events = useLogisticsStore(s => s.events);
  const tasks = useLogisticsStore(s => s.tasks);
  const {canWrite, openCompany, openEvent, openTask} = useActions();
  const plan = usePlan();
  const [sharing, setSharing] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const contact = live ?? opened;
  const gone = useGone(live, loaded);
  const company = contact.company
    ? companies.find(c => c.id === contact.company?.id)
    : undefined;
  const linked = sortEvents(
    events.filter(e => contact.eventIds.includes(e.id)),
  );
  const itsTasks = sortTasks(tasksOfContact(tasks, contact.id));
  const info = contact.phone ? phoneInfo(contact.phone) : null;
  const missing = missingForContact(contact);
  const w = contact.restricted;
  const canShare = !w && shareableFields(contact).length > 1;
  const isMain = !!company && company.mainContactId === contact.id;

  return (
    <Sheet
      open
      onClose={onClose}
      id="lx-contact-sheet"
      eyebrow={isMain ? 'Persona · responsable' : 'Persona'}
      title={contact.name}
      meta={
        <>
          {contact.isDemo && <DemoChip />}
          <VerificationChip verification={contact.verification} />
          {(contact.role || contact.company) && (
            <span className="lx-sheet__sub" id="lx-contact-subtitle">
              {[contact.role, contact.company?.name]
                .filter(Boolean)
                .join(' · ')}
            </span>
          )}
        </>
      }
      footer={
        canWrite && !gone ? (
          <>
            <Button variant="ghost" onClick={onClose} id="lx-contact-close">
              Cerrar
            </Button>
            <span className="lx-sheet__foot-spacer" />
            <Button
              variant="primary"
              icon="edit"
              id="lx-contact-edit"
              onClick={() => onEdit(contact)}
            >
              Editar
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={onClose} id="lx-contact-close">
            Cerrar
          </Button>
        )
      }
    >
      <div className="lx-record">
        {gone && <GoneNotice what="Esta persona" />}
        {!canWrite && <ReadOnlyNotice />}
        <ReachOut
          target={contact}
          idPrefix="lx-contact-reach"
          onAddMissing={canWrite && !gone ? () => onEdit(contact) : undefined}
        />
        {canShare && (
          <Button
            icon="share"
            className="lx-record__share"
            id="lx-contact-share"
            onClick={() => setSharing(true)}
          >
            Compartir contacto
          </Button>
        )}
        <MissingHint missing={missing} id="lx-contact-missing" />

        <dl className="lx-detail" id="lx-contact-detail">
          <div>
            <dt>Cargo</dt>
            <dd>
              <Value value={contact.role} />
            </dd>
          </div>
          <div>
            <dt>Empresa o entidad</dt>
            <dd>
              {contact.company ? (
                company ? (
                  <button
                    type="button"
                    className="lx-link"
                    id="lx-contact-company"
                    onClick={() => openCompany(company)}
                  >
                    {contact.company.name}
                    <Icon name="chevronRight" size={16} />
                  </button>
                ) : (
                  contact.company.name
                )
              ) : (
                <Value value={null} />
              )}
            </dd>
          </div>
          <div>
            <dt>Teléfono</dt>
            <dd className="lx-num">
              <Value
                value={info ? formatDial(info) : contact.phone}
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
              <Value value={contact.email} withheld={w} />
            </dd>
          </div>
          <div>
            <dt>Descripción</dt>
            <dd className="lx-detail__notes">
              <Value value={contact.description} withheld={w} empty="—" />
            </dd>
          </div>
          <div>
            <dt>Observaciones</dt>
            <dd className="lx-detail__notes">
              <Value value={contact.notes} withheld={w} empty="—" />
            </dd>
          </div>
          <div>
            <dt>Origen del dato</dt>
            <dd>
              <Value value={contact.source && SOURCE_LABEL[contact.source]} />
            </dd>
          </div>
        </dl>

        <section
          className="lx-subsection"
          id="lx-contact-events"
          aria-labelledby="lx-contact-events-title"
        >
          <h3 className="lx-subsection__title" id="lx-contact-events-title">
            Eventos
            <span className="lx-count lx-num">{linked.length}</span>
          </h3>
          {linked.length ? (
            <ul className="lx-linklist">
              {linked.map(e => {
                const d = recordDate(e);
                return (
                  <li key={e.id}>
                    <button
                      type="button"
                      className="lx-linkrow"
                      onClick={() => openEvent(e)}
                    >
                      <Icon name="calendar" size={18} />
                      <span className="lx-linkrow__title">{e.name}</span>
                      <span className="lx-linkrow__meta lx-num">
                        {d ? dayMonthShort(d) : 'Sin fecha'}
                      </span>
                      <Icon name="chevronRight" size={16} />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="lx-muted">Sin eventos vinculados.</p>
          )}
        </section>

        {itsTasks.length > 0 && (
          <section
            className="lx-subsection"
            id="lx-contact-tasks"
            aria-labelledby="lx-contact-tasks-title"
          >
            <div className="lx-subsection__head">
              <h3 className="lx-subsection__title" id="lx-contact-tasks-title">
                Tareas en las que es la persona de contacto
                <span className="lx-count lx-num">{itsTasks.length}</span>
              </h3>
              {canWrite && !gone && (
                <Button
                  size="sm"
                  variant="primary"
                  icon="order"
                  id="lx-contact-work-order"
                  onClick={() => setOrdering(true)}
                >
                  Orden de trabajo
                </Button>
              )}
            </div>
            <ul className="lx-tasklist">
              {itsTasks.map(t => (
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
          </section>
        )}

        <RecordNotes
          target={{type: 'contact', id: contact.id}}
          prefill={{
            ref: {type: 'contact', id: contact.id, label: contact.name},
          }}
          idPrefix="lx-contact"
          canAdd={!gone}
        />
        <RecordHistory
          entityType="contact"
          entityId={contact.id}
          version={contact.version}
          idPrefix="lx-contact"
        />
        <Provenance record={contact} id="lx-contact-provenance" />
      </div>
      {sharing && (
        <ShareContactSheet
          contact={contact}
          onClose={() => setSharing(false)}
        />
      )}
      {ordering && canWrite && (
        <WorkOrderSheet
          recipient={{kind: 'contact', id: contact.id, name: contact.name}}
          phone={contact.phone}
          email={contact.email}
          onClose={() => setOrdering(false)}
        />
      )}
    </Sheet>
  );
};

// ---------------------------------------------------------------- form

const ContactForm: React.FC<{
  mode: Exclude<ContactSheetMode, {kind: 'view'}>;
  onClose: () => void;
  onSaved: (contact: Contact) => void;
  onCancelEdit: (contact: Contact) => void;
}> = ({mode, onClose, onSaved, onCancelEdit}) => {
  const createContact = useLogisticsStore(s => s.createContact);
  const updateContact = useLogisticsStore(s => s.updateContact);
  const deleteContact = useLogisticsStore(s => s.deleteContact);
  const toast = useLogisticsStore(s => s.toast);
  const contacts = useLogisticsStore(s => s.contacts);
  const companies = useLogisticsStore(s => s.companies);
  const events = useLogisticsStore(s => s.events);
  const tasks = useLogisticsStore(s => s.tasks);
  const {openContact} = useActions();
  const [savedName, setSavedName] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const editing = mode.kind === 'edit' ? mode.contact : null;
  const blank = useMemo<FormValues>(
    () =>
      mode.kind === 'create'
        ? {
            ...EMPTY,
            name: mode.prefill?.name ?? '',
            companyName: mode.prefill?.companyName ?? '',
          }
        : EMPTY,
    // Only the opening values matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const toValuesCb = useCallback(toValues, []);
  const f = useRecordForm<FormValues, Contact>({
    entity: 'contact',
    editing,
    blank,
    toValues: toValuesCb,
    rescued: mode.rescued,
    fromRescue,
    serverField: SERVER_FIELD,
    // Leaving an edit goes back to the card; leaving a new one closes.
    onClose: () => (f.base ? onCancelEdit(f.base) : onClose()),
  });
  const {values, set, errors, base, saving} = f;
  const isCreate = !base;

  const sortedEvents = useMemo(() => sortEvents(events), [events]);
  const info = values.phone.trim() ? phoneInfo(values.phone) : null;
  const ownTasks = base ? tasksOfContact(tasks, base.id) : [];
  const mainOf = base
    ? companies.find(c => c.mainContactId === base.id)
    : undefined;

  const setAndClear = <K extends keyof FormValues>(k: K, v: FormValues[K]) => {
    set(k, v);
    setSavedName(null);
  };

  const inputFrom = (v: FormValues): ContactInput => ({
    name: v.name.trim(),
    companyName: nullIfEmpty(v.companyName),
    role: nullIfEmpty(v.role),
    phone: nullIfEmpty(v.phone),
    email: nullIfEmpty(v.email),
    description: nullIfEmpty(v.description),
    notes: nullIfEmpty(v.notes),
    eventIds: v.eventIds,
    source: v.source,
    verification: v.verification,
  });

  const submit = async (next: boolean) => {
    if (saving) return;
    const found = validate(values);
    if (Object.keys(found).length) {
      f.setErrors(found);
      const first = Object.keys(found)[0];
      document.getElementById(`lx-contact-${first}`)?.focus();
      return;
    }
    f.setSaving(next ? 'next' : 'save');
    f.setErrors({});
    try {
      if (!base) {
        const created = await createContact(inputFrom(values));
        toast(`Persona guardada: ${created.name}`, 'success');
        f.markSaved();
        if (next) {
          f.startNext({
            ...EMPTY,
            companyName: values.companyName,
            source: values.source,
            verification: values.verification,
          });
          setSavedName(created.name);
          nameRef.current?.focus();
        } else {
          onSaved(created);
        }
        return;
      }
      const full = inputFrom(values);
      const patch: ContactInput = {version: base.version};
      const keys = [
        'name',
        'companyName',
        'role',
        'phone',
        'email',
        'description',
        'notes',
        'eventIds',
        'source',
        'verification',
      ] as const;
      for (const k of keys) {
        if (f.changed(k)) Object.assign(patch, {[k]: full[k]});
      }
      if (Object.keys(patch).length === 1) {
        toast('No había cambios que guardar.', 'info');
        onSaved(base);
        return;
      }
      const updated = await updateContact(base.id, patch);
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
      await deleteContact(base);
      toast(`Persona borrada: ${base.name}`, 'success');
      onClose();
    } catch (err) {
      f.setConfirm(null);
      f.applyServerError(err, 'delete');
    } finally {
      f.setSaving(null);
    }
  };

  const deleteDetail = [
    ownTasks.length
      ? `${plural(ownTasks.length, 'tarea perderá', 'tareas perderán')} su persona de contacto.`
      : '',
    mainOf ? `«${mainOf.name}» se quedará sin persona responsable.` : '',
    'No se puede deshacer.',
  ]
    .filter(Boolean)
    .join(' ');

  const footer =
    f.confirm === 'discard' ? (
      <DiscardStrip
        idPrefix="lx-contact-discard"
        onKeep={f.keepEditing}
        onDiscard={f.discard}
        leavingFor={f.leavingFor}
      />
    ) : f.confirm === 'delete' && base ? (
      <DeleteStrip
        idPrefix="lx-contact"
        question={<>¿Borrar a «{base.name}»?</>}
        detail={deleteDetail}
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
            id="lx-contact-delete"
            disabled={!!saving}
            onClick={() => f.setConfirm('delete')}
          >
            Borrar
          </Button>
        ) : (
          <Button
            variant="ghost"
            onClick={f.requestClose}
            id="lx-contact-cancel"
          >
            Cancelar
          </Button>
        )}
        <span className="lx-sheet__foot-spacer" />
        {isCreate ? (
          <Button
            id="lx-contact-save-next"
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
            id="lx-contact-cancel"
          >
            Cancelar
          </Button>
        )}
        <Button
          variant="primary"
          id="lx-contact-save"
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
      id="lx-contact-sheet"
      eyebrow={isCreate ? 'Nueva persona' : 'Editar persona'}
      title={isCreate ? 'Añadir persona' : base.name}
      meta={
        base ? (
          <>
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
        id="lx-contact-form"
        className="lx-form"
        noValidate
        onSubmit={e => {
          e.preventDefault();
          void submit(false);
        }}
      >
        <FormNotices
          idPrefix="lx-contact"
          subject="esta persona"
          conflict={f.conflict}
          conflictOn={f.conflictOn}
          ownConflict={f.ownConflict}
          onLoadCurrent={f.loadCurrent}
          rescued={f.rescuedNotice}
          currentLoaded={f.conflictResolved}
          saved={
            savedName && (
              <>Guardada «{savedName}». Puedes añadir la siguiente persona.</>
            )
          }
          error={errors.form}
          alertRef={f.alertRef}
          merge={f.merge}
        />

        <Field id="lx-contact-name" label="Nombre" error={errors.name}>
          <Input
            ref={nameRef}
            id="lx-contact-name"
            name="lx-contact-name"
            data-autofocus
            value={values.name}
            invalid={!!errors.name}
            aria-describedby={describedBy('lx-contact-name', {
              error: errors.name,
            })}
            placeholder="Ana Demo"
            autoComplete="off"
            autoCapitalize="words"
            enterKeyHint="next"
            onChange={e => setAndClear('name', e.target.value)}
          />
        </Field>
        {(isCreate || f.changed('name')) && (
          <LookAlike
            id="lx-contact-lookalike"
            name={values.name}
            candidates={contacts}
            excludeId={base?.id}
            noun="la misma persona"
            describe={c =>
              [c.role, c.company?.name].filter(Boolean).join(' · ') || null
            }
            onOpen={c => f.leaveFor(c.name, () => openContact(c), ['name'])}
          />
        )}

        <CompanyField
          id="lx-contact-companyName"
          label="Empresa o entidad"
          optional
          value={values.companyName}
          onChange={v => setAndClear('companyName', v)}
          companies={companies}
          error={errors.companyName}
        />

        <Field id="lx-contact-role" label="Cargo" optional error={errors.role}>
          <Input
            id="lx-contact-role"
            name="lx-contact-role"
            value={values.role}
            invalid={!!errors.role}
            placeholder="Responsable de montaje"
            autoComplete="off"
            onChange={e => setAndClear('role', e.target.value)}
          />
        </Field>

        <div className="lx-form__row lx-form__row--2">
          <Field
            id="lx-contact-phone"
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
              id="lx-contact-phone"
              name="lx-contact-phone"
              type="tel"
              inputMode="tel"
              className="lx-num"
              value={values.phone}
              invalid={!!errors.phone}
              aria-describedby={describedBy('lx-contact-phone', {
                error: errors.phone,
                hint: info?.warning || info?.international,
              })}
              placeholder="+34 000 000 000"
              autoComplete="off"
              onChange={e => setAndClear('phone', e.target.value)}
            />
          </Field>
          <Field
            id="lx-contact-email"
            label="Correo"
            optional
            error={errors.email}
          >
            <Input
              id="lx-contact-email"
              name="lx-contact-email"
              type="email"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              value={values.email}
              invalid={!!errors.email}
              aria-describedby={describedBy('lx-contact-email', {
                error: errors.email,
              })}
              placeholder="ana@example.com"
              autoComplete="off"
              onChange={e => setAndClear('email', e.target.value)}
            />
          </Field>
        </div>

        <fieldset className="lx-picklist" id="lx-contact-eventIds">
          <legend className="lx-field__label lx-segmented__legend">
            Eventos en los que participa
            <span className="lx-field__optional"> · opcional</span>
          </legend>
          {sortedEvents.length === 0 ? (
            <p className="lx-muted">Aún no hay eventos registrados.</p>
          ) : (
            <ul className="lx-picklist__list">
              {sortedEvents.map(e => {
                const id = `lx-contact-event-${e.id}`;
                const d = recordDate(e);
                return (
                  <li key={e.id}>
                    <input
                      type="checkbox"
                      id={id}
                      checked={values.eventIds.includes(e.id)}
                      onChange={ev =>
                        setAndClear(
                          'eventIds',
                          ev.target.checked
                            ? [...values.eventIds, e.id]
                            : values.eventIds.filter(x => x !== e.id),
                        )
                      }
                    />
                    <label htmlFor={id}>
                      <Icon name="calendar" size={17} />
                      <span className="lx-picklist__title">{e.name}</span>
                      <span className="lx-picklist__meta lx-num">
                        {d ? dayMonthShort(d) : 'Sin fecha'}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {errors.eventIds && (
            <p className="lx-field__error" role="alert">
              {errors.eventIds}
            </p>
          )}
        </fieldset>

        <Field
          id="lx-contact-description"
          label="Descripción"
          optional
          error={errors.description}
          hint="Qué hace o qué ofrece. No se comparte al enviar la ficha."
        >
          <Textarea
            id="lx-contact-description"
            name="lx-contact-description"
            rows={2}
            value={values.description}
            placeholder="Coordina el personal de montaje"
            onChange={e => setAndClear('description', e.target.value)}
          />
        </Field>

        <Field
          id="lx-contact-notes"
          label="Observaciones"
          optional
          error={errors.notes}
          hint="No se envían al compartir la ficha. No anotes datos de salud ni casos de Punto Violeta."
        >
          <Textarea
            id="lx-contact-notes"
            name="lx-contact-notes"
            rows={2}
            value={values.notes}
            placeholder="Prefiere WhatsApp por la mañana"
            onChange={e => setAndClear('notes', e.target.value)}
          />
        </Field>

        <QualityFields
          idPrefix="lx-contact"
          source={values.source}
          verification={values.verification}
          onSource={v => setAndClear('source', v)}
          onVerification={v => setAndClear('verification', v)}
        />

        {mainOf && f.changed('companyName') && (
          <p className="lx-notice" id="lx-contact-main-note">
            <Icon name="alert" size={16} />
            Es la persona responsable de «{mainOf.name}». Si cambia de empresa,
            «{mainOf.name}» se quedará sin responsable.
          </p>
        )}
        {base && <Provenance record={base} id="lx-contact-provenance" />}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Sheet>
  );
};
