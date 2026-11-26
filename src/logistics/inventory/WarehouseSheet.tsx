/**
 * A warehouse: view first, with its resources and «Añadir recurso aquí»;
 * «Editar» for members. Name, address and observations only: no map and no
 * geometry (a storage area on the venue needs its own plan, because it must
 * never block routes A/B/C or accessibility services).
 *
 * - Two warehouses cannot share a name: the server answers 409 DUPLICATE and
 *   the sheet offers «Abrir el existente».
 * - Deleting keeps its resources, without a warehouse.
 * - Guests see the name and the material; address and observations are
 *   «Visible para el equipo».
 */
import React, {useCallback, useMemo, useState} from 'react';
import type {
  DataSource,
  Verification,
  Warehouse,
  WarehouseInput,
} from '../../../shared/logistics/contracts.ts';
import {missingForWarehouse} from '../../../shared/logistics/quality.ts';
import {
  ADDRESS_MAX,
  NOTE_PRIVACY_HINT,
  NOTES_MAX,
} from '../../../shared/logistics/rules.ts';
import {useActions, type WarehousePrefill} from '../common/actions';
import {RecordHistory} from '../common/RecordHistory';
import {RecordNotes} from '../common/RecordNotes';
import {
  GoneNotice,
  MissingHint,
  Value,
  useGone,
} from '../contacts/DirectoryParts';
import {LookAlike} from '../contacts/NameHelpers';
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
import {categoryNames} from '../lib/directory';
import {SOURCE_LABEL, VERIFICATION_LABEL} from '../lib/events';
import {plural} from '../lib/format';
import {sortResources} from '../lib/inventory';
import {nameKey} from '../lib/tasks';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Button, Field, Icon, Input, Sheet, Textarea, describedBy} from '../ui';
import {ResourceRow} from './ResourceParts';

type RescuedValues = Record<string, unknown>;

export type WarehouseSheetMode =
  | {kind: 'view'; warehouse: Warehouse}
  | {kind: 'create'; prefill?: WarehousePrefill; rescued?: RescuedValues}
  | {kind: 'edit'; warehouse: Warehouse; rescued?: RescuedValues};

interface FormValues {
  name: string;
  address: string;
  notes: string;
  source: DataSource | null;
  verification: Verification;
}

const EMPTY: FormValues = {
  name: '',
  address: '',
  notes: '',
  source: null,
  verification: 'draft',
};

const toValues = (w: Warehouse): FormValues => ({
  name: w.name,
  address: w.address ?? '',
  notes: w.notes ?? '',
  source: w.source,
  verification: w.verification,
});

function fromRescue(raw: RescuedValues, fallback: FormValues): FormValues {
  const out = {...fallback};
  for (const k of ['name', 'address', 'notes'] as const) {
    if (typeof raw[k] === 'string') out[k] = raw[k];
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
  address: 'address',
  notes: 'notes',
  source: 'source',
  verification: 'verification',
};

function validate(v: FormValues): FormErrors<FormValues> {
  const e: FormErrors<FormValues> = {};
  if (!v.name.trim()) e.name = 'Escribe el nombre, aunque sea provisional.';
  if (v.address.trim().length > ADDRESS_MAX) {
    e.address = `Como mucho ${ADDRESS_MAX} caracteres.`;
  }
  if (v.notes.trim().length > NOTES_MAX) {
    e.notes = `Como mucho ${NOTES_MAX} caracteres.`;
  }
  return e;
}

const nullIfEmpty = (s: string) => (s.trim() ? s.trim() : null);

export const WarehouseSheet: React.FC<{
  mode: WarehouseSheetMode | null;
  onClose: () => void;
}> = ({mode, onClose}) =>
  mode ? <WarehouseSheetBody initial={mode} onClose={onClose} /> : null;

const WarehouseSheetBody: React.FC<{
  initial: WarehouseSheetMode;
  onClose: () => void;
}> = ({initial, onClose}) => {
  const [mode, setMode] = useState(initial);
  if (mode.kind === 'view') {
    return (
      <WarehouseView
        warehouse={mode.warehouse}
        onClose={onClose}
        onEdit={w => setMode({kind: 'edit', warehouse: w})}
      />
    );
  }
  return (
    <WarehouseForm
      mode={mode}
      onClose={onClose}
      onSaved={w => setMode({kind: 'view', warehouse: w})}
      onShow={w => setMode({kind: 'view', warehouse: w})}
    />
  );
};

// ---------------------------------------------------------------- view

const WarehouseView: React.FC<{
  warehouse: Warehouse;
  onClose: () => void;
  onEdit: (warehouse: Warehouse) => void;
}> = ({warehouse: opened, onClose, onEdit}) => {
  const live = useLogisticsStore(s =>
    s.warehouses.find(w => w.id === opened.id),
  );
  const loaded = useLogisticsStore(s => s.warehousesState === 'ready');
  const allResources = useLogisticsStore(s => s.resources);
  const categories = useLogisticsStore(s => s.categories);
  const {canWrite, openResource, addResource} = useActions();
  const w = live ?? opened;
  const gone = useGone(live, loaded);
  const names = useMemo(() => categoryNames(categories), [categories]);
  const resources = useMemo(
    () => sortResources(allResources.filter(r => r.warehouse?.id === w.id)),
    [allResources, w.id],
  );
  const contracted = resources.filter(r => r.ownership === 'contracted');
  const owned = resources.filter(r => r.ownership === 'owned');

  return (
    <Sheet
      open
      onClose={onClose}
      id="lx-warehouse-sheet"
      eyebrow="Almacén"
      title={w.name}
      meta={
        <>
          {w.isDemo && <DemoChip />}
          <VerificationChip verification={w.verification} />
          <span className="lx-sheet__sub lx-num">
            {plural(w.resourceCount, 'recurso', 'recursos')}
          </span>
        </>
      }
      footer={
        canWrite && !gone ? (
          <>
            <Button variant="ghost" onClick={onClose} id="lx-warehouse-close">
              Cerrar
            </Button>
            <span className="lx-sheet__foot-spacer" />
            <Button
              variant="primary"
              icon="edit"
              id="lx-warehouse-edit"
              onClick={() => onEdit(w)}
            >
              Editar
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={onClose} id="lx-warehouse-close">
            Cerrar
          </Button>
        )
      }
    >
      <div className="lx-record">
        {gone && <GoneNotice what="Este almacén" masculine />}
        {!canWrite && <ReadOnlyNotice />}
        <MissingHint
          missing={missingForWarehouse(w)}
          id="lx-warehouse-missing"
        />

        <dl className="lx-detail" id="lx-warehouse-detail">
          <div>
            <dt>Dirección</dt>
            <dd>
              <Value value={w.address} withheld={w.restricted} />
            </dd>
          </div>
          <div>
            <dt>Observaciones</dt>
            <dd className="lx-detail__notes">
              <Value value={w.notes} withheld={w.restricted} empty="—" />
            </dd>
          </div>
          <div>
            <dt>Origen del dato</dt>
            <dd>
              <Value value={w.source && SOURCE_LABEL[w.source]} />
            </dd>
          </div>
        </dl>

        <section
          className="lx-subsection"
          id="lx-warehouse-resources"
          aria-labelledby="lx-warehouse-resources-title"
        >
          <div className="lx-subsection__head">
            <h3
              className="lx-subsection__title"
              id="lx-warehouse-resources-title"
            >
              Recursos
              <span className="lx-count lx-num">{resources.length}</span>
            </h3>
            {canWrite && !gone && (
              <Button
                size="sm"
                icon="plus"
                id="lx-warehouse-add-resource"
                onClick={() =>
                  addResource({ownership: 'owned', warehouseName: w.name})
                }
              >
                Añadir recurso aquí
              </Button>
            )}
          </div>
          {resources.length ? (
            <>
              <ul className="lx-reslist">
                {owned.map(r => (
                  <ResourceRow
                    key={r.id}
                    resource={r}
                    category={r.categoryId ? names.get(r.categoryId) : null}
                    onOpen={openResource}
                  />
                ))}
              </ul>
              {contracted.length > 0 && (
                <>
                  <p className="lx-eyebrow lx-warehouse__sub">
                    Contratados guardados aquí
                  </p>
                  <ul className="lx-reslist">
                    {contracted.map(r => (
                      <ResourceRow
                        key={r.id}
                        resource={r}
                        category={r.categoryId ? names.get(r.categoryId) : null}
                        context={r.company?.name ?? null}
                        onOpen={openResource}
                      />
                    ))}
                  </ul>
                </>
              )}
            </>
          ) : (
            <p className="lx-muted">
              {canWrite
                ? 'Aún no hay nada apuntado aquí. Recorre el almacén y añade lo que veas: basta con el nombre.'
                : 'Sin recursos registrados.'}
            </p>
          )}
        </section>

        <RecordNotes
          target={{type: 'warehouse', id: w.id}}
          prefill={{ref: {type: 'warehouse', id: w.id, label: w.name}}}
          idPrefix="lx-warehouse"
          canAdd={!gone}
        />
        <RecordHistory
          entityType="warehouse"
          entityId={w.id}
          version={w.version}
          idPrefix="lx-warehouse"
        />
        <Provenance record={w} id="lx-warehouse-provenance" />
      </div>
    </Sheet>
  );
};

// ---------------------------------------------------------------- form

const WarehouseForm: React.FC<{
  mode: Exclude<WarehouseSheetMode, {kind: 'view'}>;
  onClose: () => void;
  onSaved: (warehouse: Warehouse) => void;
  /** Shows another warehouse in this sheet (the existing duplicate). */
  onShow: (warehouse: Warehouse) => void;
}> = ({mode, onClose, onSaved, onShow}) => {
  const createWarehouse = useLogisticsStore(s => s.createWarehouse);
  const updateWarehouse = useLogisticsStore(s => s.updateWarehouse);
  const deleteWarehouse = useLogisticsStore(s => s.deleteWarehouse);
  const toast = useLogisticsStore(s => s.toast);
  const warehouses = useLogisticsStore(s => s.warehouses);
  const [duplicate, setDuplicate] = useState<Warehouse | null>(null);
  const duplicateRef = useAlertFocus(duplicate);

  const editing = mode.kind === 'edit' ? mode.warehouse : null;
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
  const f = useRecordForm<FormValues, Warehouse>({
    entity: 'warehouse',
    editing,
    blank,
    toValues: toValuesCb,
    rescued: mode.rescued,
    fromRescue,
    serverField: SERVER_FIELD,
    onClose: () => (f.base ? onShow(f.base) : onClose()),
    onDuplicate: current => {
      const existing =
        current && typeof current === 'object'
          ? (current as Warehouse)
          : (warehouses.find(w => nameKey(w.name) === nameKey(f.values.name)) ??
            null);
      setDuplicate(existing);
      if (!existing) f.setErrors({name: 'Ya hay un almacén con ese nombre.'});
    },
  });
  const {values, set, errors, base, saving} = f;
  const isCreate = !base;
  const count = base?.resourceCount ?? 0;

  const change = <K extends keyof FormValues>(k: K, v: FormValues[K]) => {
    set(k, v);
    if (k === 'name') setDuplicate(null);
  };

  const inputFrom = (v: FormValues): WarehouseInput => ({
    name: v.name.trim(),
    address: nullIfEmpty(v.address),
    notes: nullIfEmpty(v.notes),
    source: v.source,
    verification: v.verification,
  });

  const submit = async () => {
    if (saving) return;
    const found = validate(values);
    if (Object.keys(found).length) {
      f.setErrors(found);
      document.getElementById(`lx-warehouse-${Object.keys(found)[0]}`)?.focus();
      return;
    }
    f.setSaving('save');
    f.setErrors({});
    setDuplicate(null);
    try {
      if (!base) {
        const created = await createWarehouse(inputFrom(values));
        f.markSaved();
        toast(`Almacén guardado: ${created.name}`, 'success');
        onSaved(created);
        return;
      }
      const full = inputFrom(values);
      const patch: WarehouseInput = {version: base.version};
      for (const k of [
        'name',
        'address',
        'notes',
        'source',
        'verification',
      ] as const) {
        if (f.changed(k)) Object.assign(patch, {[k]: full[k]});
      }
      if (Object.keys(patch).length === 1) {
        toast('No había cambios que guardar.', 'info');
        onSaved(base);
        return;
      }
      const updated = await updateWarehouse(base.id, patch);
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
      await deleteWarehouse(base);
      toast(`Almacén borrado: ${base.name}`, 'success');
      onClose();
    } catch (err) {
      f.setConfirm(null);
      f.applyServerError(err, 'delete');
    } finally {
      f.setSaving(null);
    }
  };

  const consequences = [
    count
      ? `${plural(count, 'recurso se queda', 'recursos se quedan')} en el inventario, sin almacén: no se borra ninguno.`
      : 'No tiene recursos.',
    'Sus notas se quedan, sin el vínculo.',
    'No se puede deshacer.',
  ].join(' ');

  const footer =
    f.confirm === 'discard' ? (
      <DiscardStrip
        idPrefix="lx-warehouse-discard"
        onKeep={f.keepEditing}
        onDiscard={f.discard}
        leavingFor={f.leavingFor}
      />
    ) : f.confirm === 'delete' && base ? (
      <DeleteStrip
        idPrefix="lx-warehouse"
        question={<>¿Borrar el almacén «{base.name}»?</>}
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
            id="lx-warehouse-delete"
            disabled={!!saving}
            onClick={() => f.setConfirm('delete')}
          >
            Borrar
          </Button>
        )}
        <Button
          variant="ghost"
          onClick={f.requestClose}
          id="lx-warehouse-cancel"
        >
          Cancelar
        </Button>
        <span className="lx-sheet__foot-spacer" />
        <Button
          variant="primary"
          id="lx-warehouse-save"
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
      id="lx-warehouse-sheet"
      eyebrow={isCreate ? 'Nuevo almacén' : 'Editar almacén'}
      title={isCreate ? 'Añadir almacén' : base.name}
      meta={
        base ? (
          <>
            {base.isDemo && <DemoChip />}
            <VerificationChip verification={base.verification} />
          </>
        ) : (
          <span className="lx-muted">
            Solo el nombre es obligatorio. La dirección puede quedar pendiente.
          </span>
        )
      }
      footer={footer}
    >
      <form
        id="lx-warehouse-form"
        className="lx-form"
        noValidate
        onSubmit={e => {
          e.preventDefault();
          void submit();
        }}
      >
        <FormNotices
          idPrefix="lx-warehouse"
          subject="este almacén"
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
            id="lx-warehouse-duplicate"
            tabIndex={-1}
            ref={el => {
              duplicateRef.current = el;
            }}
          >
            <Icon name="alert" size={20} />
            <div>
              <p className="lx-conflict__title">Ya existe «{duplicate.name}»</p>
              <p>
                No se ha guardado: dos almacenes no pueden llamarse igual. Abre
                el existente o cambia el nombre.
              </p>
              <Button
                size="sm"
                variant="primary"
                id="lx-warehouse-open-existing"
                onClick={() =>
                  f.leaveFor(duplicate.name, () => onShow(duplicate), ['name'])
                }
              >
                Abrir el existente
              </Button>
            </div>
          </div>
        )}

        <Field id="lx-warehouse-name" label="Nombre" error={errors.name}>
          <Input
            id="lx-warehouse-name"
            name="lx-warehouse-name"
            data-autofocus
            value={values.name}
            invalid={!!errors.name}
            aria-describedby={describedBy('lx-warehouse-name', {
              error: errors.name,
            })}
            placeholder="Almacén Demo Norte"
            autoComplete="off"
            autoCapitalize="words"
            onChange={e => change('name', e.target.value)}
          />
        </Field>
        {(isCreate || f.changed('name')) && !duplicate && (
          <LookAlike
            id="lx-warehouse-lookalike"
            name={values.name}
            candidates={warehouses}
            excludeId={base?.id}
            noun="el mismo almacén"
            dismissLabel="No, es otro"
            onOpen={w => f.leaveFor(w.name, () => onShow(w), ['name'])}
          />
        )}

        <Field
          id="lx-warehouse-address"
          label="Dirección"
          optional
          error={errors.address}
          hint="Solo la ve el equipo. Sin mapa: basta con calle, número y municipio."
        >
          <Input
            id="lx-warehouse-address"
            name="lx-warehouse-address"
            value={values.address}
            invalid={!!errors.address}
            aria-describedby={describedBy('lx-warehouse-address', {
              error: errors.address,
              hint: true,
            })}
            placeholder="Calle Demo 1, La Laguna"
            autoComplete="off"
            onChange={e => change('address', e.target.value)}
          />
        </Field>

        <Field
          id="lx-warehouse-notes"
          label="Observaciones"
          optional
          error={errors.notes}
          hint={NOTE_PRIVACY_HINT}
        >
          <Textarea
            id="lx-warehouse-notes"
            name="lx-warehouse-notes"
            rows={3}
            value={values.notes}
            aria-describedby={describedBy('lx-warehouse-notes', {
              error: errors.notes,
              hint: true,
            })}
            placeholder="Abre de 7:30 a 15:00; la llave está en conserjería."
            onChange={e => change('notes', e.target.value)}
          />
        </Field>

        <QualityFields
          idPrefix="lx-warehouse"
          source={values.source}
          verification={values.verification}
          onSource={v => change('source', v)}
          onVerification={v => change('verification', v)}
        />

        {base && (
          <>
            <RecordHistory
              entityType="warehouse"
              entityId={base.id}
              version={base.version}
              idPrefix="lx-warehouse-form"
            />
            <Provenance record={base} id="lx-warehouse-provenance" />
          </>
        )}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Sheet>
  );
};
