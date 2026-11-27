/**
 * «Presupuesto» of one event (Revisión 1 · E5): what the event may spend
 * (taxes included), what is confirmed and what is only planned, and what is
 * left, at a glance; then every expense, grouped by status.
 *
 * - Only for viewers with `budget.read`; changes need `budget.edit` (a
 *   developer reads without the edit controls).
 * - Held in memory only and never queued: without connection it says
 *   «Necesita conexión».
 * - Figures with tax are estimates and say so; expenses missing from the
 *   estimate are counted and named.
 * - A budget changed meanwhile (409) is never overwritten silently: the
 *   sheet shows both figures and lets the person choose.
 */
import React, {useMemo, useState} from 'react';
import {formatEuros} from '../../../shared/logistics/catalogue.ts';
import type {
  EventBudget,
  Expense,
  ExpenseStatus,
  LogisticsEvent,
  Offer,
} from '../../../shared/logistics/contracts.ts';
import {budgetSummary} from '../../../shared/logistics/money.ts';
import {TAX_ESTIMATE_LABEL} from '../../../shared/logistics/rules.ts';
import {useAccess} from '../account/useAccess';
import {errorMessage, isApiError} from '../api/client';
import {euroProblem, eurosForInput, parseEuros} from '../lib/directory';
import {relativeTime} from '../lib/format';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {
  Button,
  Chip,
  EmptyState,
  Field,
  HelpTip,
  Icon,
  Input,
  LoadError,
  Pending,
  Sheet,
  SkeletonRows,
  describedBy,
} from '../ui';
import {budgetApi, isOfflineError} from './api';
import {
  BudgetHeadline,
  BudgetLegend,
  BudgetRibbon,
  ExpenseRow,
} from './BudgetParts';
import {ExpenseSheet, type ExpenseSheetMode} from './ExpenseSheet';
import {OfferPicker} from './OfferPicker';
import {BUDGET_HELP, caveatsOf, groupGapText, headlineOf} from './summary';
import type {EventBudgetState} from './useEventBudget';

const GROUPS: ExpenseStatus[] = ['confirmed', 'planned'];

export const BudgetSheet: React.FC<{
  event: LogisticsEvent;
  budget: EventBudgetState;
  onClose: () => void;
}> = ({event, budget, onClose}) => {
  const {can, denial} = useAccess();
  const offers = useLogisticsStore(s => s.offers);
  const {load, reload} = budget;
  const data = load.data;
  const offline = load.status === 'offline';
  const editable =
    can('budget.edit') && !offline && load.status !== 'forbidden';
  const editDenial = denial('budget.edit');
  const [expenseMode, setExpenseMode] = useState<ExpenseSheetMode | null>(null);
  const [picking, setPicking] = useState(false);

  const summary = useMemo(
    () => (data ? budgetSummary(data.budget, data.expenses) : null),
    [data],
  );

  let body: React.ReactNode;
  if (load.status === 'forbidden') {
    body = (
      <EmptyState
        icon="lock"
        title="Sin acceso al presupuesto"
        id="lx-budget-forbidden"
      >
        {load.message}
      </EmptyState>
    );
  } else if (!data && load.status === 'offline') {
    body = (
      <EmptyState
        icon="cloudOff"
        title="Necesita conexión"
        id="lx-budget-offline"
        action={
          <Button size="sm" icon="refresh" onClick={reload}>
            Reintentar
          </Button>
        }
      >
        {load.message}
      </EmptyState>
    );
  } else if (!data && load.status === 'error') {
    body = <LoadError message={load.message} onRetry={reload} />;
  } else if (!data || !summary) {
    body = <SkeletonRows rows={5} label="Cargando el presupuesto" />;
  } else {
    const caveats = caveatsOf(summary);
    const byStatus = (s: ExpenseStatus) =>
      data.expenses.filter(x => x.status === s);
    body = (
      <>
        {offline && (
          <p className="lx-notice" role="status" id="lx-budget-stale">
            <Icon name="cloudOff" size={16} />
            Sin conexión: esto es lo último que se cargó y puede no estar al
            día. Para cambiarlo hace falta conexión.
          </p>
        )}
        <section
          className="lx-budget__hero"
          aria-labelledby="lx-budget-total-label"
          id="lx-budget-hero"
        >
          <div className="lx-budget__figures">
            <BudgetTotal
              event={event}
              value={data.budget}
              editable={editable}
              onSaved={budget.putBudget}
            />
            <BudgetHeadline
              headline={headlineOf(summary)}
              incomplete={summary.incomplete}
              id="lx-budget-headline"
            />
          </div>
          {summary.total.count > 0 && (
            <>
              <BudgetRibbon summary={summary} id="lx-budget-ribbon" />
              <BudgetLegend summary={summary} id="lx-budget-legend" />
            </>
          )}
          {caveats.length > 0 && (
            <ul className="lx-budget__caveats" id="lx-budget-caveats">
              {caveats.map(c => (
                <li key={c}>
                  <Icon name="alert" size={14} />
                  {c}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          className="lx-budget__expenses"
          aria-labelledby="lx-budget-expenses-title"
        >
          <div className="lx-budget__exphead">
            <h3 className="lx-subsection__title" id="lx-budget-expenses-title">
              Gastos
              <span className="lx-count lx-num">{data.expenses.length}</span>
            </h3>
            {editable && (
              <div className="lx-budget__actions">
                {can('directory.read') && offers.length > 0 && (
                  <Button
                    size="sm"
                    icon="catalog"
                    id="lx-budget-from-catalog"
                    onClick={() => setPicking(true)}
                  >
                    Desde el catálogo
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="primary"
                  icon="plus"
                  id="lx-budget-add"
                  onClick={() => setExpenseMode({kind: 'create'})}
                >
                  Añadir gasto
                </Button>
              </div>
            )}
          </div>
          {!editable && !offline && editDenial && (
            <p className="lx-notice lx-notice--quiet" id="lx-budget-readonly">
              <Icon name="lock" size={16} />
              {editDenial.message}
            </p>
          )}
          {data.expenses.length === 0 ? (
            <EmptyState
              compact
              icon="budget"
              title="Aún no hay gastos"
              id="lx-budget-empty"
            >
              {editable
                ? 'Apunta lo que costará el evento: a mano, o desde una oferta del catálogo para copiar su precio y su impuesto de hoy.'
                : 'Cuando se apunten gastos de este evento, aparecerán aquí.'}
            </EmptyState>
          ) : (
            GROUPS.map(status => {
              const list = byStatus(status);
              if (!list.length) return null;
              const totals = summary[status];
              const gap = groupGapText(totals);
              return (
                <div
                  className="lx-budget__group"
                  key={status}
                  data-status={status}
                  id={`lx-budget-group-${status}`}
                >
                  <p className="lx-budget__grouphead lx-num">
                    <span>
                      {status === 'confirmed' ? 'Confirmados' : 'Previstos'}
                      <span className="lx-muted"> · {list.length}</span>
                    </span>
                    <span>
                      {formatEuros(totals.beforeTax)} sin impuestos ·{' '}
                      <strong>≈ {formatEuros(totals.withTax)}</strong> con
                      impuestos · {TAX_ESTIMATE_LABEL}
                    </span>
                  </p>
                  {gap && (
                    <p
                      className="lx-budget__groupgap"
                      id={`lx-budget-group-${status}-gap`}
                    >
                      <Icon name="alert" size={14} />
                      {gap}
                    </p>
                  )}
                  <ul className="lx-expenses">
                    {list.map(x => (
                      <li key={x.id}>
                        <ExpenseRow
                          expense={x}
                          timeZone={event.timezone}
                          onOpen={
                            editable
                              ? e => setExpenseMode({kind: 'edit', expense: e})
                              : undefined
                          }
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })
          )}
        </section>
      </>
    );
  }

  return (
    <Sheet
      open
      onClose={onClose}
      id="lx-budget-sheet"
      eyebrow="Presupuesto del evento"
      title={event.name}
      className="lx-budget"
      meta={
        <Chip size="sm" tag tone="neutral" title={BUDGET_HELP}>
          Estimación · sin contabilidad
        </Chip>
      }
      footer={
        <>
          {load.status === 'loading' && data && (
            <span className="lx-muted lx-budget__refreshing" role="status">
              Actualizando…
            </span>
          )}
          <span className="lx-sheet__foot-spacer" />
          <Button variant="primary" onClick={onClose} id="lx-budget-close">
            Cerrar
          </Button>
        </>
      }
    >
      {body}
      {picking && (
        <OfferPicker
          onClose={() => setPicking(false)}
          onPick={(offer: Offer) => {
            setPicking(false);
            setExpenseMode({kind: 'create', offer});
          }}
        />
      )}
      {expenseMode && (
        <ExpenseSheet
          event={event}
          mode={expenseMode}
          onClose={() => setExpenseMode(null)}
          onSaved={(x: Expense) => budget.putExpense(x)}
          onDeleted={budget.dropExpense}
        />
      )}
    </Sheet>
  );
};

/**
 * The event's budget, big, with «Fijar» / «Cambiar». The amount is what the
 * event may spend with taxes. Version 0 = never set.
 */
const BudgetTotal: React.FC<{
  event: LogisticsEvent;
  value: EventBudget;
  editable: boolean;
  onSaved: (budget: EventBudget) => void;
}> = ({event, value, editable, onSaved}) => {
  const toast = useLogisticsStore(s => s.toast);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<EventBudget | null>(null);

  const open = () => {
    setText(eurosForInput(value.amount));
    setError(null);
    setConflict(null);
    setEditing(true);
  };

  const save = async (amount: number | null, version: number) => {
    setBusy(true);
    setError(null);
    try {
      const saved = await budgetApi.set(event.id, {amount, version});
      onSaved(saved);
      setEditing(false);
      setConflict(null);
      toast(
        amount === null ? 'Presupuesto quitado' : 'Presupuesto guardado',
        'success',
      );
    } catch (err) {
      if (isApiError(err) && err.code === 'VERSION_CONFLICT' && err.current) {
        setConflict(err.current as EventBudget);
      } else if (isApiError(err) && err.code === 'VALIDATION' && err.fields) {
        setError(err.fields.amount ?? Object.values(err.fields)[0] ?? null);
      } else {
        setError(
          isOfflineError(err)
            ? 'Sin conexión: no se ha guardado. Vuelve a intentarlo cuando haya cobertura.'
            : errorMessage(err),
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    const problem = euroProblem(text);
    if (problem) {
      setError(problem);
      return;
    }
    const amount = parseEuros(text);
    void save(
      amount === null || Number.isNaN(amount) ? null : amount,
      value.version,
    );
  };

  const mine = (() => {
    const a = parseEuros(text);
    return a === null || Number.isNaN(a) ? null : a;
  })();

  return (
    <div className="lx-budget__total">
      <p className="lx-eyebrow" id="lx-budget-total-label">
        Presupuesto · con impuestos
        <HelpTip label="presupuesto">{BUDGET_HELP}</HelpTip>
      </p>
      {!editing ? (
        <>
          <p className="lx-budget__amount lx-num" id="lx-budget-amount">
            {value.amount === null ? (
              <Pending>Sin fijar</Pending>
            ) : (
              formatEuros(value.amount)
            )}
          </p>
          {value.updatedBy && value.updatedAt && (
            <p className="lx-budget__who lx-muted">
              Fijado por {value.updatedBy.displayName},{' '}
              {relativeTime(value.updatedAt, event.timezone)}
            </p>
          )}
          {editable && (
            <Button
              size="sm"
              variant={value.amount === null ? 'primary' : 'secondary'}
              icon={value.amount === null ? 'plus' : 'edit'}
              id="lx-budget-edit"
              onClick={open}
            >
              {value.amount === null ? 'Fijar presupuesto' : 'Cambiar'}
            </Button>
          )}
        </>
      ) : (
        <form
          className="lx-budget__form"
          id="lx-budget-form"
          noValidate
          onSubmit={e => {
            e.preventDefault();
            // Nested in the event sheet: never let the event form see it.
            e.stopPropagation();
            submit();
          }}
        >
          {conflict ? (
            <div className="lx-conflict" role="alert" id="lx-budget-conflict">
              <Icon name="alert" size={20} />
              <div>
                <p className="lx-conflict__title">
                  Otra persona ha cambiado el presupuesto
                </p>
                <p>
                  {conflict.updatedBy?.displayName ?? 'Alguien'} lo dejó en{' '}
                  <strong className="lx-num">
                    {conflict.amount === null
                      ? 'sin fijar'
                      : formatEuros(conflict.amount)}
                  </strong>
                  {conflict.updatedAt
                    ? ` ${relativeTime(conflict.updatedAt, event.timezone)}`
                    : ''}
                  . El tuyo no se ha guardado.
                </p>
                <div className="lx-budget__formactions">
                  <Button
                    size="sm"
                    id="lx-budget-keep-theirs"
                    onClick={() => {
                      onSaved(conflict);
                      setConflict(null);
                      setEditing(false);
                    }}
                  >
                    Quedarme con{' '}
                    {conflict.amount === null
                      ? 'el actual'
                      : formatEuros(conflict.amount)}
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    id="lx-budget-use-mine"
                    busy={busy}
                    onClick={() => void save(mine, conflict.version)}
                  >
                    Guardar el mío (
                    {mine === null ? 'sin fijar' : formatEuros(mine)})
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <>
              <Field
                id="lx-budget-input"
                label="Lo que el evento puede gastar, con impuestos"
                error={error}
                hint="Vacío para quitarlo."
              >
                <span className="lx-money lx-money--big">
                  <Input
                    id="lx-budget-input"
                    ref={el => {
                      // Opened by «Cambiar»: straight into the figure.
                      if (el && !el.dataset.focused) {
                        el.dataset.focused = '1';
                        el.focus();
                        el.select();
                      }
                    }}
                    inputMode="decimal"
                    className="lx-num"
                    value={text}
                    invalid={!!error}
                    aria-describedby={describedBy('lx-budget-input', {
                      error,
                      hint: true,
                    })}
                    placeholder="5.000"
                    autoComplete="off"
                    onChange={e => {
                      setText(e.target.value);
                      setError(null);
                    }}
                  />
                  <span className="lx-money__unit" aria-hidden="true">
                    €
                  </span>
                </span>
              </Field>
              <div className="lx-budget__formactions">
                <Button
                  size="sm"
                  variant="ghost"
                  id="lx-budget-cancel"
                  disabled={busy}
                  onClick={() => setEditing(false)}
                >
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  type="submit"
                  id="lx-budget-save"
                  busy={busy}
                >
                  {busy ? 'Guardando…' : 'Guardar'}
                </Button>
              </div>
            </>
          )}
        </form>
      )}
    </div>
  );
};
