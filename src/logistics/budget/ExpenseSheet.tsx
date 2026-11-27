/**
 * Add, edit or delete one expense of an event's budget (Revisión 1 · E5).
 *
 * - Written by hand, or from a catalogue offer: then the server copies the
 *   offer's price and tax as they are today (the snapshot) and nothing that
 *   happens to the offer later changes it. The amount starts at the price
 *   before tax × a quantity the user can change.
 * - Amounts are before tax; the estimate with tax is shown live.
 * - Never queued: without connection it says so and keeps what was typed.
 * - A version conflict (409) never overwrites: «Ver versión actual» loads
 *   the other person's version.
 */
import React, {useMemo, useRef, useState} from 'react';
import {
  formatEuros,
  perUnitLabel,
} from '../../../shared/logistics/catalogue.ts';
import type {
  Expense,
  ExpenseInput,
  ExpenseStatus,
  LogisticsEvent,
  Offer,
} from '../../../shared/logistics/contracts.ts';
import {
  effectiveTax,
  priceEstimate,
  roundCents,
  snapshotOf,
} from '../../../shared/logistics/money.ts';
import {
  EXPENSE_STATUSES,
  EXPENSE_STATUS_LABEL,
  NOTES_MAX,
} from '../../../shared/logistics/rules.ts';

/** Same limit as the server's names (`NAME_MAX` in server/src/records). */
const NAME_MAX = 200;
import {errorMessage, isApiError} from '../api/client';
import {ConflictNotice, DiscardStrip, useAlertFocus} from '../forms/FormParts';
import {euroProblem, eurosForInput, parseEuros} from '../lib/directory';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {
  Button,
  Field,
  Icon,
  Input,
  Segmented,
  SelectField,
  Sheet,
  Textarea,
  describedBy,
} from '../ui';
import {budgetApi, isOfflineError} from './api';
import {expenseEstimate, snapshotText} from './summary';
import {
  EMPTY_TAX_DRAFT,
  taxDraftOf,
  taxFieldError,
  taxInfoOfDraft,
  taxProblem,
  taxToSend,
  type TaxDraft,
} from './tax';
import {TaxField} from './TaxField';

export type ExpenseSheetMode =
  {kind: 'create'; offer?: Offer} | {kind: 'edit'; expense: Expense};

interface Values {
  concept: string;
  companyId: string;
  /** From an offer: how many units of its price. */
  quantity: string;
  amount: string;
  tax: TaxDraft;
  status: ExpenseStatus;
  notes: string;
}

type Errors = Partial<Record<keyof Values | 'form', string>>;

const STATUS_HELP =
  'Previsto: está en el plan, aún sin cerrar con la empresa. Confirmado: ya está cerrado.';

function fromExpense(x: Expense): Values {
  return {
    concept: x.concept,
    companyId: x.company?.id ?? '',
    quantity: '1',
    amount: eurosForInput(x.amount),
    tax: taxDraftOf(x.tax),
    status: x.status,
    notes: x.notes ?? '',
  };
}

function fromOffer(o: Offer): Values {
  return {
    concept: o.name,
    companyId: o.company.id,
    quantity: '1',
    amount: eurosForInput(priceEstimate(o).beforeTax),
    tax: taxDraftOf(effectiveTax(o)),
    status: 'planned',
    notes: '',
  };
}

const EMPTY: Values = {
  concept: '',
  companyId: '',
  quantity: '1',
  amount: '',
  tax: EMPTY_TAX_DRAFT,
  status: 'planned',
  notes: '',
};

/** «3», «2,5» → number; '' → 1; else NaN. */
function parseQuantity(text: string): number {
  const raw = text.trim().replace(',', '.');
  if (!raw) return 1;
  return /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : NaN;
}

/** Server field names → form fields. */
const SERVER_FIELD: Record<string, keyof Values | 'form'> = {
  concept: 'concept',
  amount: 'amount',
  companyId: 'companyId',
  status: 'status',
  notes: 'notes',
  eventId: 'form',
  offerId: 'form',
};

export const ExpenseSheet: React.FC<{
  event: LogisticsEvent;
  mode: ExpenseSheetMode;
  onClose: () => void;
  onSaved: (expense: Expense) => void;
  onDeleted: (id: string) => void;
}> = ({event, mode, onClose, onSaved, onDeleted}) => {
  const companies = useLogisticsStore(s => s.companies);
  const toast = useLogisticsStore(s => s.toast);
  const [base, setBase] = useState<Expense | null>(
    mode.kind === 'edit' ? mode.expense : null,
  );
  const offer = mode.kind === 'create' ? (mode.offer ?? null) : null;
  const initial = useMemo(
    () => (base ? fromExpense(base) : offer ? fromOffer(offer) : EMPTY),
    [base, offer],
  );
  const [values, setValues] = useState<Values>(initial);
  const [amountByHand, setAmountByHand] = useState(mode.kind === 'edit');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  const [conflict, setConflict] = useState<Expense | null>(null);
  const [confirm, setConfirm] = useState<'discard' | 'delete' | null>(null);
  // One device id per new expense: a retry after a lost answer is a replay.
  const deviceId = useRef<string>(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : '',
  );
  const alertRef = useAlertFocus(conflict ?? errors.form);
  const id = 'lx-expense';

  const dirty = (Object.keys(values) as (keyof Values)[]).some(
    k => JSON.stringify(values[k]) !== JSON.stringify(initial[k]),
  );

  const unitPrice = offer ? priceEstimate(offer).beforeTax : null;
  const set = <K extends keyof Values>(key: K, value: Values[K]) => {
    setValues(v => {
      const next = {...v, [key]: value};
      // From an offer, the amount follows the quantity until typed by hand.
      if (key === 'quantity' && unitPrice !== null && !amountByHand) {
        const q = parseQuantity(String(value));
        if (Number.isFinite(q)) {
          next.amount = eurosForInput(roundCents(unitPrice * q));
        }
      }
      // A company picked for a new expense lends its tax if none is chosen.
      if (key === 'companyId' && !base && !offer && v.tax.regime === '') {
        const c = companies.find(k => k.id === value);
        if (c?.tax) next.tax = taxDraftOf(c.tax);
      }
      return next;
    });
    if (key === 'amount') setAmountByHand(true);
    setErrors(e => ({...e, [key]: undefined, form: undefined}));
  };

  const companyOptions = useMemo(() => {
    const list = companies.map(c => ({value: c.id, label: c.name}));
    // An expense keeps a company the list no longer has (deleted, or no
    // directory access): offer it as it is.
    const current = base?.company;
    if (current?.id && !list.some(o => o.value === current.id)) {
      list.unshift({value: current.id, label: current.name});
    }
    return [{value: '', label: 'Sin empresa'}, ...list];
  }, [companies, base]);

  const preview = expenseEstimate({
    amount: (() => {
      const a = parseEuros(values.amount);
      return a === null || Number.isNaN(a) ? null : a;
    })(),
    tax: taxInfoOfDraft(values.tax),
  });

  const validate = (): Errors => {
    const e: Errors = {};
    const concept = values.concept.trim();
    if (!concept) {
      e.concept =
        'Escribe el concepto del gasto (por ejemplo, «Alquiler de carpas»).';
    } else if (concept.length > NAME_MAX) {
      e.concept = `Como mucho ${NAME_MAX} caracteres.`;
    }
    const amount = euroProblem(values.amount);
    if (amount) e.amount = amount;
    if (offer && !Number.isFinite(parseQuantity(values.quantity))) {
      e.quantity = 'Escribe la cantidad con cifras, por ejemplo 3 o 2,5.';
    }
    const tax = taxProblem(values.tax);
    if (tax) e.tax = tax.message;
    if (values.notes.trim().length > NOTES_MAX) {
      e.notes = `Como mucho ${NOTES_MAX} caracteres.`;
    }
    return e;
  };

  const showError = (err: unknown) => {
    if (isApiError(err) && err.code === 'VERSION_CONFLICT' && err.current) {
      setConflict(err.current as Expense);
      return;
    }
    if (isApiError(err) && err.code === 'NOT_FOUND' && base) {
      toast('Este gasto ya no existe: otra persona lo ha eliminado.', 'info');
      onDeleted(base.id);
      onClose();
      return;
    }
    if (isApiError(err) && err.code === 'VALIDATION' && err.fields) {
      const next: Errors = {};
      for (const [k, m] of Object.entries(err.fields)) {
        const field = k.startsWith('tax') ? 'tax' : (SERVER_FIELD[k] ?? 'form');
        next[field] = m;
      }
      setErrors(next);
      return;
    }
    setErrors({
      form: isOfflineError(err)
        ? 'Sin conexión: el gasto no se ha guardado. Lo que has escrito sigue aquí; vuelve a guardar cuando haya cobertura.'
        : errorMessage(err),
    });
  };

  const submit = async () => {
    if (busy) return;
    const found = validate();
    if (Object.keys(found).length) {
      setErrors({...found, form: 'Revisa los datos marcados.'});
      return;
    }
    const amount = parseEuros(values.amount);
    const input: ExpenseInput = {
      concept: values.concept.trim(),
      companyId: values.companyId || null,
      amount: amount === null || Number.isNaN(amount) ? null : amount,
      tax: taxToSend(values.tax),
      status: values.status,
      notes: values.notes.trim() || null,
    };
    setBusy('save');
    setErrors({});
    try {
      let saved: Expense;
      if (base) {
        const patch: ExpenseInput = {version: base.version};
        const was = fromExpense(base);
        if (values.concept !== was.concept) patch.concept = input.concept;
        if (values.companyId !== was.companyId) {
          patch.companyId = input.companyId;
        }
        if (values.amount !== was.amount) patch.amount = input.amount;
        if (JSON.stringify(values.tax) !== JSON.stringify(was.tax)) {
          patch.tax = input.tax;
        }
        if (values.status !== was.status) patch.status = input.status;
        if (values.notes !== was.notes) patch.notes = input.notes;
        saved = await budgetApi.updateExpense(base.id, patch);
      } else {
        saved = await budgetApi.createExpense({
          ...input,
          eventId: event.id,
          ...(offer ? {offerId: offer.id} : {}),
          ...(deviceId.current ? {id: deviceId.current} : {}),
        });
      }
      onSaved(saved);
      toast(
        base ? 'Gasto guardado' : 'Gasto añadido al presupuesto',
        'success',
      );
      onClose();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!base || busy) return;
    setBusy('delete');
    try {
      await budgetApi.deleteExpense(base.id, base.version);
      onDeleted(base.id);
      toast(`Gasto «${base.concept}» eliminado`, 'success');
      onClose();
    } catch (err) {
      setConfirm(null);
      showError(err);
    } finally {
      setBusy(null);
    }
  };

  const loadCurrent = () => {
    if (!conflict) return;
    setBase(conflict);
    setValues(fromExpense(conflict));
    setConflict(null);
    setErrors({});
  };

  const requestClose = () => {
    if (busy) return;
    if (dirty && confirm !== 'discard') setConfirm('discard');
    else onClose();
  };

  const snap = base?.snapshot
    ? snapshotText(base.snapshot, event.timezone)
    : null;
  const offerPreview = offer
    ? snapshotText(snapshotOf(offer, new Date().toISOString()), event.timezone)
    : null;
  const per = offer ? perUnitLabel(offer) : null;
  const taxErr = taxFieldError(values.tax, errors.tax);

  return (
    <Sheet
      open
      onClose={requestClose}
      id="lx-expense-sheet"
      size="md"
      eyebrow={`Presupuesto · ${event.name}`}
      title={
        base
          ? 'Editar gasto'
          : offer
            ? 'Gasto desde el catálogo'
            : 'Nuevo gasto'
      }
      footer={
        confirm === 'discard' ? (
          <DiscardStrip
            idPrefix="lx-expense-discard"
            onKeep={() => setConfirm(null)}
            onDiscard={onClose}
          />
        ) : confirm === 'delete' ? (
          <div
            className="lx-confirm-strip"
            role="alertdialog"
            aria-labelledby="lx-expense-delete-text"
          >
            <p id="lx-expense-delete-text">
              ¿Eliminar «{base?.concept}» del presupuesto? No se puede deshacer.
            </p>
            <div className="lx-confirm-strip__actions">
              <Button
                onClick={() => setConfirm(null)}
                id="lx-expense-delete-keep"
              >
                No, mantenerlo
              </Button>
              <Button
                variant="danger"
                icon="trash"
                busy={busy === 'delete'}
                onClick={() => void remove()}
                id="lx-expense-delete-confirm"
              >
                Eliminar
              </Button>
            </div>
          </div>
        ) : (
          <>
            {base && (
              <Button
                variant="ghost"
                icon="trash"
                id="lx-expense-delete"
                disabled={!!busy}
                onClick={() => setConfirm('delete')}
              >
                Eliminar
              </Button>
            )}
            <span className="lx-sheet__foot-spacer" />
            <Button
              variant="ghost"
              onClick={requestClose}
              id="lx-expense-cancel"
            >
              Cancelar
            </Button>
            <Button
              variant="primary"
              id="lx-expense-save"
              busy={busy === 'save'}
              disabled={!!conflict || busy === 'delete'}
              onClick={() => void submit()}
            >
              {busy === 'save'
                ? 'Guardando…'
                : base
                  ? 'Guardar'
                  : 'Añadir gasto'}
            </Button>
          </>
        )
      }
    >
      <form
        id="lx-expense-form"
        className="lx-form"
        noValidate
        onSubmit={e => {
          e.preventDefault();
          // Nested in the event sheet: never let the event form see it.
          e.stopPropagation();
          void submit();
        }}
      >
        {conflict && (
          <ConflictNotice
            id="lx-expense-conflict"
            loadId="lx-expense-load-current"
            subject="este gasto"
            current={conflict}
            ownConflict={false}
            onLoad={loadCurrent}
            alertRef={alertRef}
          />
        )}
        {errors.form && (
          <p
            className="lx-notice lx-notice--error"
            role="alert"
            id="lx-expense-error"
            tabIndex={-1}
            ref={el => {
              alertRef.current = el;
            }}
          >
            <Icon name="alert" size={16} />
            {errors.form}
          </p>
        )}

        {offerPreview && (
          <div className="lx-snapcopy" id="lx-expense-offer-copy">
            <Icon name="copy" size={18} />
            <p>
              <strong>Se copiará el precio de hoy.</strong> {offerPreview.what}.
              Si la oferta cambia después, este gasto no cambia.
            </p>
          </div>
        )}
        {snap && (
          <div className="lx-snapcopy" id="lx-expense-snapshot">
            <Icon name="copy" size={18} />
            <p>
              <strong>{snap.when}.</strong> {snap.what}. Editar la oferta no
              cambia este gasto.
            </p>
          </div>
        )}

        <Field id={`${id}-concept`} label="Concepto" error={errors.concept}>
          <Input
            id={`${id}-concept`}
            data-autofocus
            value={values.concept}
            invalid={!!errors.concept}
            aria-describedby={describedBy(`${id}-concept`, {
              error: errors.concept,
            })}
            placeholder="Alquiler de carpas"
            autoComplete="off"
            onChange={e => set('concept', e.target.value)}
          />
        </Field>

        <Field
          id={`${id}-company`}
          label="Empresa"
          optional
          error={errors.companyId}
        >
          <SelectField
            id={`${id}-company`}
            value={values.companyId}
            invalid={!!errors.companyId}
            options={companyOptions}
            onChange={v => set('companyId', v)}
          />
        </Field>

        <div className="lx-expense-form__money">
          {offer && unitPrice !== null && (
            <Field
              id={`${id}-quantity`}
              label={`Cantidad${per ? ` (${per})` : ''}`}
              error={errors.quantity}
              hint={`× ${formatEuros(unitPrice)}${per ? ` / ${per}` : ''} sin impuestos`}
            >
              <Input
                id={`${id}-quantity`}
                inputMode="decimal"
                className="lx-num"
                value={values.quantity}
                invalid={!!errors.quantity}
                aria-describedby={describedBy(`${id}-quantity`, {
                  error: errors.quantity,
                  hint: true,
                })}
                autoComplete="off"
                onChange={e => set('quantity', e.target.value)}
              />
            </Field>
          )}
          <Field
            id={`${id}-amount`}
            label="Importe, sin impuestos"
            optional
            error={errors.amount}
            hint={
              values.amount.trim()
                ? undefined
                : 'Si aún no lo sabes, déjalo vacío: no cuenta como 0.'
            }
          >
            <span className="lx-money">
              <Input
                id={`${id}-amount`}
                inputMode="decimal"
                className="lx-num"
                value={values.amount}
                invalid={!!errors.amount}
                aria-describedby={describedBy(`${id}-amount`, {
                  error: errors.amount,
                  hint: !values.amount.trim(),
                })}
                placeholder="Sin indicar"
                autoComplete="off"
                onChange={e => set('amount', e.target.value)}
              />
              <span className="lx-money__unit" aria-hidden="true">
                €
              </span>
            </span>
          </Field>
        </div>

        <TaxField
          id={`${id}-tax`}
          legend="Impuesto del gasto"
          emptyLabel="Sin indicar"
          emptyHint="No se estima con impuestos"
          value={values.tax}
          onChange={t => set('tax', t)}
          error={taxErr}
        />

        <p
          className={`lx-estimate lx-estimate--${preview.amount ? 'estimate' : 'none'}`}
          id={`${id}-estimate`}
          data-estimate={preview.amount ? 'estimate' : 'none'}
          aria-live="polite"
        >
          {preview.amount ? (
            <>
              <span className="lx-estimate__approx" aria-hidden="true">
                ≈
              </span>
              <span>
                <strong className="lx-num lx-estimate__amount">
                  {preview.amount}
                </strong>{' '}
                {preview.text}
              </span>
            </>
          ) : (
            <>
              <Icon name="alert" size={15} />
              <span>{preview.text}</span>
            </>
          )}
        </p>

        <Segmented<ExpenseStatus>
          name={`${id}-status`}
          id={`${id}-status`}
          legend="Estado"
          value={values.status}
          options={EXPENSE_STATUSES.map(s => ({
            value: s,
            label: EXPENSE_STATUS_LABEL[s],
          }))}
          onChange={v => v && set('status', v)}
          help={STATUS_HELP}
        />

        <Field
          id={`${id}-notes`}
          label="Observaciones"
          optional
          error={errors.notes}
        >
          <Textarea
            id={`${id}-notes`}
            rows={2}
            value={values.notes}
            invalid={!!errors.notes}
            aria-describedby={describedBy(`${id}-notes`, {error: errors.notes})}
            placeholder="Qué incluye, a quién se pidió…"
            onChange={e => set('notes', e.target.value)}
          />
        </Field>
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Sheet>
  );
};
