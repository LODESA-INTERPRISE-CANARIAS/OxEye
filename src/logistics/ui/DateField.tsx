/**
 * Date field in the Gestor's style: type it («2/12», «2-12-2026», «hoy»,
 * «mañana», «viernes») or pick it from a month calendar (Monday first,
 * Spanish names, today marked). The value is `YYYY-MM-DD`, or `''` when the
 * date is not known yet. Shown as «02/12/2026» with the weekday beside it.
 *
 * WAI-ARIA date picker dialog pattern: a button next to the input opens a
 * non-modal dialog with a `grid`; arrows move by day and week, Home/End to
 * the week's ends, Page Up/Down by month (with Shift, by year), Enter picks,
 * Escape closes and focus returns to the button. `min`/`max` disable the
 * days outside the range in the calendar; a typed date outside it is kept
 * so the form can explain why it cannot be saved.
 */
import React, {useEffect, useId, useRef, useState} from 'react';
import {DEFAULT_TIMEZONE, utcToLocal} from '../../../shared/logistics/time.ts';
import {
  WEEK_HEADS,
  clampDate,
  dateInRange,
  dateLong,
  formatDate,
  monthLabel,
  monthStart,
  monthWeeks,
  parseDate,
  shiftDate,
  shiftMonth,
  weekdayIndex,
  weekdayShort,
} from './controls';
import {IconButton} from './Button';
import {Icon} from './icons';
import {Popover} from './Popover';

export interface DateFieldProps {
  id: string;
  /** `YYYY-MM-DD`, or `''` when unknown. */
  value: string;
  onChange: (value: string) => void;
  name?: string;
  min?: string;
  max?: string;
  invalid?: boolean;
  disabled?: boolean;
  'aria-describedby'?: string;
  /** Accessible name when there is no `<label for>` (toolbars). */
  'aria-label'?: string;
  placeholder?: string;
  /** Today in the organization's zone (defaults to Atlantic/Canary). */
  today?: string;
  timeZone?: string;
  /** Shows «Sin fecha» in the panel (default true). */
  clearable?: boolean;
  className?: string;
}

function todayIn(timeZone: string): string {
  return utcToLocal(new Date().toISOString(), timeZone).date;
}

/** The text a value shows in the input. */
const shown = (value: string) => (value ? formatDate(value) : '');

export const DateField: React.FC<DateFieldProps> = ({
  id,
  value,
  onChange,
  name,
  min,
  max,
  invalid,
  disabled,
  'aria-describedby': describedBy,
  'aria-label': ariaLabel,
  placeholder = 'dd/mm/aaaa',
  today: todayProp,
  timeZone = DEFAULT_TIMEZONE,
  clearable = true,
  className,
}) => {
  const [text, setText] = useState(() => shown(value));
  const [seen, setSeen] = useState(value);
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelId = `${id}-picker-${useId().replace(/:/g, '')}`;
  const noteId = `${id}-note`;
  const dayId = `${id}-weekday`;
  const today = todayProp ?? todayIn(timeZone);

  // A typed date outside min/max is kept, as a native date input does: the
  // form says why it cannot be saved (and the calendar never offers it).
  const read = (t: string) => parseDate(t, today);

  if (value !== seen) {
    setSeen(value);
    if (read(text) !== value) setText(shown(value));
  }

  const commit = (next: string) => {
    if (next !== value) onChange(next);
  };

  const onText = (t: string) => {
    setText(t);
    setNote(null);
    const parsed = read(t);
    if (parsed !== null) commit(parsed);
  };

  const settle = () => {
    const parsed = read(text);
    if (parsed === null) {
      const keep = value
        ? `se mantiene el ${formatDate(value)}`
        : 'queda sin fecha';
      setNote(
        `No he entendido «${text.trim()}»: ${keep}. Escribe, por ejemplo, 2/12 o «mañana».`,
      );
      setText(shown(value));
    } else {
      setText(shown(parsed));
    }
  };

  const close = (focusButton: boolean) => {
    setOpen(false);
    if (focusButton) toggleRef.current?.focus();
  };

  const pick = (next: string) => {
    setText(shown(next));
    setNote(null);
    commit(next);
    close(true);
  };

  const described = [describedBy, value ? dayId : '', note ? noteId : '']
    .filter(Boolean)
    .join(' ');

  return (
    <>
      <div
        ref={wrapRef}
        className={[
          'lx-ctl',
          'lx-ctl--date',
          value ? 'lx-ctl--hasday' : '',
          open ? 'lx-ctl--open' : '',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <input
          id={id}
          name={name}
          type="text"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          maxLength={24}
          className="lx-input lx-ctl__input lx-num"
          placeholder={placeholder}
          value={text}
          data-value={value}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-invalid={invalid || !!note || undefined}
          aria-describedby={described || undefined}
          onChange={e => onText(e.target.value)}
          onBlur={settle}
          onKeyDown={e => {
            if (e.altKey && e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
            } else if (e.key === 'Enter') {
              settle();
            }
          }}
        />
        {value && (
          <span className="lx-ctl__weekday" id={dayId}>
            <span className="lx-visually-hidden">{dateLong(value)}</span>
            <span aria-hidden="true">{weekdayShort(value)}</span>
          </span>
        )}
        <button
          ref={toggleRef}
          type="button"
          className="lx-ctl__toggle"
          aria-label="Elegir fecha"
          title="Elegir fecha"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={panelId}
          disabled={disabled}
          onClick={() => (open ? close(false) : setOpen(true))}
        >
          <Icon name="calendar" size={20} />
        </button>
      </div>
      {note && (
        <p className="lx-ctl__note" id={noteId} role="status">
          {note}
        </p>
      )}
      <Popover
        id={panelId}
        open={open}
        anchorRef={wrapRef}
        width={344}
        onClose={reason => close(reason === 'escape')}
        role="dialog"
        aria-label="Elegir fecha"
        className="lx-pop--picker"
      >
        <DatePanel
          id={id}
          value={value}
          today={today}
          min={min}
          max={max}
          clearable={clearable}
          onPick={pick}
        />
      </Popover>
    </>
  );
};

const DatePanel: React.FC<{
  id: string;
  value: string;
  today: string;
  min?: string;
  max?: string;
  clearable: boolean;
  onPick: (value: string) => void;
}> = ({id, value, today, min, max, clearable, onPick}) => {
  const [focus, setFocus] = useState(() => clampDate(value || today, min, max));
  /** Whether DOM focus should follow `focus` (keyboard in the grid). */
  const [moveFocus, setMoveFocus] = useState(true);
  const gridRef = useRef<HTMLTableElement>(null);
  const titleId = `${id}-month`;

  useEffect(() => {
    if (!moveFocus) return;
    gridRef.current
      ?.querySelector<HTMLElement>(`[data-date="${focus}"]`)
      ?.focus();
  }, [focus, moveFocus]);

  const go = (next: string, keyboard: boolean) => {
    setMoveFocus(keyboard);
    setFocus(clampDate(next, min, max));
  };

  const month = monthStart(focus);
  const prevMonthEnd = shiftDate(month, -1);
  const nextMonthStart = shiftMonth(month, 1);
  const canPrev = !min || prevMonthEnd >= min;
  const canNext = !max || nextMonthStart <= max;

  const onGridKey = (e: React.KeyboardEvent) => {
    const wd = weekdayIndex(focus);
    const moves: Record<string, () => string> = {
      ArrowRight: () => shiftDate(focus, 1),
      ArrowLeft: () => shiftDate(focus, -1),
      ArrowDown: () => shiftDate(focus, 7),
      ArrowUp: () => shiftDate(focus, -7),
      Home: () => shiftDate(focus, -wd),
      End: () => shiftDate(focus, 6 - wd),
      PageUp: () => shiftMonth(focus, e.shiftKey ? -12 : -1),
      PageDown: () => shiftMonth(focus, e.shiftKey ? 12 : 1),
    };
    if (e.key in moves) {
      e.preventDefault();
      go(moves[e.key](), true);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (dateInRange(focus, min, max)) onPick(focus);
    }
  };

  const quick = [
    {label: 'Hoy', value: today},
    {label: 'Mañana', value: shiftDate(today, 1)},
  ];

  return (
    <div className="lx-dp">
      <div className="lx-dp__head">
        <IconButton
          icon="chevronLeft"
          label="Mes anterior"
          id={`${id}-prev-month`}
          disabled={!canPrev}
          onClick={() => go(shiftMonth(focus, -1), false)}
        />
        <h3 className="lx-dp__title" id={titleId} aria-live="polite">
          {monthLabel(focus)}
        </h3>
        <IconButton
          icon="chevronRight"
          label="Mes siguiente"
          id={`${id}-next-month`}
          disabled={!canNext}
          onClick={() => go(shiftMonth(focus, 1), false)}
        />
      </div>

      <table
        ref={gridRef}
        className="lx-dp__grid"
        role="grid"
        aria-labelledby={titleId}
        onKeyDown={onGridKey}
      >
        <thead>
          <tr>
            {WEEK_HEADS.map(h => (
              <th key={h.long} scope="col" abbr={h.long}>
                <span aria-hidden="true">{h.short}</span>
                <span className="lx-visually-hidden">{h.long}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {monthWeeks(focus).map((week, wi) => (
            <tr key={wi}>
              {week.map((day, di) =>
                day ? (
                  <td
                    key={day}
                    data-date={day}
                    tabIndex={day === focus ? 0 : -1}
                    aria-selected={day === value}
                    aria-current={day === today ? 'date' : undefined}
                    aria-disabled={!dateInRange(day, min, max) || undefined}
                    aria-label={dateLong(day)}
                    className={[
                      'lx-dp__day',
                      'lx-num',
                      di >= 5 ? 'lx-dp__day--weekend' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => {
                      if (dateInRange(day, min, max)) onPick(day);
                    }}
                  >
                    {Number(day.slice(8))}
                  </td>
                ) : (
                  <td key={`e${di}`} className="lx-dp__day--empty" />
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="lx-pick__foot">
        {clearable ? (
          <button
            type="button"
            className="lx-pick__clear"
            id={`${id}-clear`}
            disabled={!value}
            onClick={() => onPick('')}
          >
            Sin fecha
          </button>
        ) : (
          <span />
        )}
        <div className="lx-pick__quick" role="group" aria-label="Atajos">
          {quick.map(q => (
            <button
              key={q.label}
              type="button"
              className="lx-pick__chip"
              id={`${id}-${q.label === 'Hoy' ? 'today' : 'tomorrow'}`}
              disabled={!dateInRange(q.value, min, max)}
              aria-pressed={value === q.value}
              onClick={() => onPick(q.value)}
            >
              {q.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
