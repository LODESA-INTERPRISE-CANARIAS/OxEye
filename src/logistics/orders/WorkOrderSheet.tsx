/**
 * «Orden de trabajo» for a company or a person (members only): choose the
 * day and the tasks, tick what to include, see the page as it will print,
 * then «Imprimir o guardar como PDF» or «Enviar…».
 *
 * The order is built only by `buildWorkOrder` (shared) from the records in
 * the store, with the fields ticked here; free text the team keeps to itself
 * starts unticked in «Solo si hace falta», and some data is never offered
 * (`WORK_ORDER_NEVER_NOTE`). It always shows the real plan, never a
 * hypothesis.
 *
 * Printing: a copy of the page is portalled to <body> (`.lx-print-root`) and
 * the print stylesheet in `orders.css` shows only that copy while this sheet
 * is open. Nothing changes for the simulator's own printing. While it
 * prints, the page title names the saved PDF (`usePrintTitle`) and the page
 * margin carries «Generado por OxEye · fecha · página N de M».
 */
import React, {useMemo, useState} from 'react';
import {createPortal} from 'react-dom';
import {
  buildWorkOrder,
  defaultWorkOrderFields,
  isDefaultSelected,
  tasksForRecipient,
  WORK_ORDER_FIELDS,
  WORK_ORDER_NEVER_NOTE,
  workOrderText,
  type WorkOrderField,
  type WorkOrderRecipient,
} from '../../../shared/logistics/work-order.ts';
import {printFileName} from '../../../shared/logistics/print-name.ts';
import {useActions} from '../common/actions';
import {TaskStatusChip} from '../common/TaskChips';
import {windowText} from '../common/TimeWindow';
import {useNow} from '../common/useNow';
import {usePlan} from '../common/usePlan';
import {dayMonthShort, plural} from '../lib/format';
import {recordDate, sortTasks} from '../lib/tasks';
import {printWithName, usePrintTitle} from '../shell/usePrintTitle';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Button, EmptyState, Icon, Sheet} from '../ui';
import {SendOrderSheet} from './SendOrderSheet';
import {
  defaultOrderDay,
  generatedAtText,
  orderDays,
  tasksOnDay,
  type OrderDay,
} from './text';
import {WorkOrderPreview} from './WorkOrderPreview';

const BASIC_FIELDS = WORK_ORDER_FIELDS.filter(f => !f.membersOnly);
const EXTRA_FIELDS = WORK_ORDER_FIELDS.filter(f => f.membersOnly);

export const WorkOrderSheet: React.FC<{
  recipient: WorkOrderRecipient;
  /** Where «Enviar…» sends to: the company's or the person's own. */
  phone: string | null;
  email: string | null;
  onClose: () => void;
}> = ({recipient, phone, email, onClose}) => {
  const {today, timeZone} = useActions();
  const tasks = useLogisticsStore(s => s.tasks);
  const events = useLogisticsStore(s => s.events);
  const resources = useLogisticsStore(s => s.resources);
  const warehouses = useLogisticsStore(s => s.warehouses);
  const contacts = useLogisticsStore(s => s.contacts);
  const me = useLogisticsStore(s => s.session?.user.displayName ?? 'OxEye');
  const role = useLogisticsStore(s => s.session?.user.role ?? 'guest');
  const organization = useLogisticsStore(
    s => s.organizations.find(o => o.id === s.orgId) ?? null,
  );
  const plan = usePlan();
  const now = useNow(30_000);

  // The saved PDF is named «SCLL_Ficha-de-trabajo_<empresa>_<fecha>_<hora>».
  usePrintTitle({
    fileName: () =>
      printFileName({
        organization,
        document: 'workOrder',
        subject: recipient.name,
        at: Date.now(),
        timeZone,
      }),
    stamp: () => generatedAtText(Date.now(), timeZone),
  });

  const mine = useMemo(
    () => sortTasks(tasksForRecipient(tasks, recipient)),
    [tasks, recipient],
  );
  const {days, undated} = useMemo(() => orderDays(mine), [mine]);
  const [day, setDay] = useState<OrderDay>(() => defaultOrderDay(days, today));
  const [picked, setPicked] = useState<ReadonlySet<string>>(
    () => new Set(mine.filter(isDefaultSelected).map(t => t.id)),
  );
  const [fields, setFields] = useState<ReadonlySet<WorkOrderField>>(
    defaultWorkOrderFields,
  );
  const [sending, setSending] = useState(false);

  const visible = useMemo(() => tasksOnDay(mine, day), [mine, day]);
  const chosen = useMemo(
    () => visible.filter(t => picked.has(t.id)),
    [visible, picked],
  );

  const order = useMemo(
    () =>
      buildWorkOrder({
        recipient,
        tasks: chosen,
        allTasks: tasks,
        events,
        resources,
        warehouses,
        contacts,
        warnings: plan.warnings,
        fields,
        role,
        generatedBy: me,
        generatedAt: generatedAtText(now, timeZone),
      }),
    [
      recipient,
      chosen,
      tasks,
      events,
      resources,
      warehouses,
      contacts,
      plan.warnings,
      fields,
      role,
      me,
      now,
      timeZone,
    ],
  );
  const text = useMemo(() => workOrderText(order), [order]);
  const empty = chosen.length === 0;

  const toggleTask = (id: string, on: boolean) =>
    setPicked(prev => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const toggleField = (id: WorkOrderField, on: boolean) =>
    setFields(prev => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const allVisible = visible.length > 0 && visible.every(t => picked.has(t.id));
  const toggleAll = () =>
    setPicked(prev => {
      const next = new Set(prev);
      for (const t of visible) {
        if (allVisible) next.delete(t.id);
        else next.add(t.id);
      }
      return next;
    });

  const dayChip = (value: OrderDay, label: string, count: number) => (
    <button
      key={value}
      type="button"
      className="lx-filterchip"
      id={`lx-order-day-${value}`}
      aria-pressed={day === value}
      onClick={() => setDay(value)}
    >
      {label}
      <span className="lx-num">{count}</span>
    </button>
  );

  const fieldRow = (f: (typeof WORK_ORDER_FIELDS)[number]) => {
    const id = `lx-order-field-${f.id}`;
    return (
      <li key={f.id}>
        <input
          type="checkbox"
          id={id}
          checked={fields.has(f.id)}
          aria-describedby={f.hint ? `${id}-hint` : undefined}
          onChange={e => toggleField(f.id, e.target.checked)}
        />
        <label htmlFor={id}>
          <span className="lx-share__label">{f.label}</span>
          {f.hint && (
            <span className="lx-share__value" id={`${id}-hint`}>
              {f.hint}
            </span>
          )}
        </label>
      </li>
    );
  };

  return (
    <Sheet
      open
      onClose={onClose}
      id="lx-order-sheet"
      className="lx-sheet--order"
      eyebrow="Orden de trabajo"
      title={recipient.name}
      meta={
        <span className="lx-sheet__sub">
          Las tareas de{' '}
          {recipient.kind === 'company' ? 'esta empresa' : 'esta persona'} en el
          plan, listas para imprimir o enviar.
        </span>
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} id="lx-order-close">
            Cerrar
          </Button>
          <span className="lx-sheet__foot-spacer" />
          <Button
            icon="send"
            id="lx-order-send"
            disabled={empty}
            onClick={() => setSending(true)}
          >
            Enviar…
          </Button>
          <Button
            variant="primary"
            icon="print"
            id="lx-order-print"
            disabled={empty}
            onClick={printWithName}
          >
            Imprimir o guardar como PDF
          </Button>
        </>
      }
    >
      {mine.length === 0 ? (
        <EmptyState
          icon="task"
          title="No hay tareas a su nombre"
          id="lx-order-empty"
        >
          Asigna tareas a {recipient.name} en el plan y vuelve aquí.
        </EmptyState>
      ) : (
        <div className="lx-orderbuilder">
          <div className="lx-orderbuilder__controls">
            <fieldset className="lx-orderpick" id="lx-order-tasks">
              <legend className="lx-field__label lx-segmented__legend">
                Tareas{' '}
                <span className="lx-orderpick__count lx-num">
                  · {chosen.length} de{' '}
                  {plural(visible.length, 'tarea', 'tareas')}
                </span>
              </legend>
              {(days.length > 1 || undated) && (
                <div
                  className="lx-filterchips"
                  role="group"
                  aria-label="Día de la orden"
                  id="lx-order-days"
                >
                  {days.map(d =>
                    dayChip(
                      d,
                      d === today
                        ? `Hoy, ${dayMonthShort(d)}`
                        : dayMonthShort(d),
                      tasksOnDay(mine, d).length,
                    ),
                  )}
                  {undated &&
                    dayChip(
                      'undated',
                      'Sin fecha',
                      tasksOnDay(mine, 'undated').length,
                    )}
                  {dayChip('all', 'Todas', mine.length)}
                </div>
              )}
              {visible.length > 1 && (
                <Button
                  size="sm"
                  variant="ghost"
                  id="lx-order-toggle-all"
                  onClick={toggleAll}
                >
                  {allVisible ? 'No elegir ninguna' : 'Elegir todas'}
                </Button>
              )}
              <ul className="lx-picklist__list lx-orderpick__list">
                {visible.map(t => {
                  const id = `lx-order-task-${t.id}`;
                  return (
                    <li key={t.id}>
                      <input
                        type="checkbox"
                        id={id}
                        checked={picked.has(t.id)}
                        onChange={e => toggleTask(t.id, e.target.checked)}
                      />
                      <label htmlFor={id}>
                        <span className="lx-orderpick__when lx-num">
                          {day === 'all' && recordDate(t)
                            ? `${dayMonthShort(recordDate(t)!)} · `
                            : ''}
                          {windowText(t)}
                        </span>
                        <span className="lx-picklist__title">{t.title}</span>
                        <TaskStatusChip status={t.status} />
                      </label>
                    </li>
                  );
                })}
              </ul>
              {visible.some(t => !isDefaultSelected(t)) && (
                <p className="lx-form__note">
                  Las tareas hechas o canceladas empiezan sin marcar.
                </p>
              )}
            </fieldset>

            <fieldset className="lx-share__fields" id="lx-order-fields">
              <legend className="lx-field__label lx-segmented__legend">
                Qué datos incluir
              </legend>
              <ul>{BASIC_FIELDS.map(fieldRow)}</ul>
            </fieldset>

            {role === 'member' && (
              <fieldset
                className="lx-share__fields lx-orderextra"
                id="lx-order-fields-extra"
              >
                <legend className="lx-field__label lx-segmented__legend">
                  Solo si hace falta
                </legend>
                <p className="lx-form__note">
                  Datos que el equipo guarda para sí: empiezan sin marcar.
                  Léelos antes de enviarlos.
                </p>
                <ul>{EXTRA_FIELDS.map(fieldRow)}</ul>
              </fieldset>
            )}
            <p className="lx-muted lx-share__note" id="lx-order-never">
              <Icon name="lock" size={14} /> {WORK_ORDER_NEVER_NOTE}
            </p>
          </div>

          <section
            className="lx-orderbuilder__preview"
            aria-labelledby="lx-order-preview-title"
          >
            <p className="lx-subtitle" id="lx-order-preview-title">
              Así se verá
            </p>
            <div className="lx-orderpage">
              <WorkOrderPreview order={order} id="lx-order-preview" />
            </div>
          </section>
        </div>
      )}
      {createPortal(
        <div className="lx-print-root" aria-hidden="true">
          <WorkOrderPreview order={order} />
        </div>,
        document.body,
      )}
      {sending && (
        <SendOrderSheet
          order={order}
          text={text}
          phone={phone}
          email={email}
          onClose={() => setSending(false)}
        />
      )}
    </Sheet>
  );
};
