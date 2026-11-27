/**
 * 24 h time field: type it («930», «9.30», «21h») or pick it from a panel
 * with big targets (hours grid, 5-minute steps, «Ahora»). The value is
 * `HH:MM`, or `''` when the time is not known yet. ↑/↓ move it by 5 minutes;
 * Alt+↓ opens the panel. Text that cannot be read is not saved: on leaving
 * the field it goes back to the last good value and says so.
 *
 * The panel follows the WAI-ARIA date picker dialog pattern: a button next to
 * the input opens a non-modal dialog, arrow keys move inside each grid,
 * Escape closes it and focus returns to the button.
 */
import React, {useEffect, useId, useRef, useState} from 'react';
import {DEFAULT_TIMEZONE, utcToLocal} from '../../../shared/logistics/time.ts';
import {TIME_STEP, parseTime, roundTime, stepTime} from './controls';
import {Icon} from './icons';
import {Popover} from './Popover';

export interface TimeSuggestion {
  value: string;
  /** Chip text; defaults to the time itself. */
  label?: string;
}

export interface TimeFieldProps {
  id: string;
  /** `HH:MM`, or `''` when unknown. */
  value: string;
  onChange: (value: string) => void;
  name?: string;
  invalid?: boolean;
  disabled?: boolean;
  'aria-describedby'?: string;
  /** Accessible name when there is no `<label for>` (toolbars). */
  'aria-label'?: string;
  placeholder?: string;
  /** Minutes per ↑/↓ press and per step in the panel. */
  step?: number;
  /** Time zone of «Ahora». */
  timeZone?: string;
  /** Extra quick choices in the panel (e.g. «+1 h» after the start). */
  suggestions?: TimeSuggestion[];
  /** Shows «Sin hora» in the panel (default true). */
  clearable?: boolean;
  className?: string;
}

/** The current time in `timeZone`, to the nearest step. */
export function nowRounded(timeZone = DEFAULT_TIMEZONE, step = TIME_STEP) {
  return roundTime(
    utcToLocal(new Date().toISOString(), timeZone).time.slice(0, 5),
    step,
  );
}

const HOURS = Array.from({length: 24}, (_, h) => String(h).padStart(2, '0'));

/** Arrow keys between the buttons of a grid with `cols` columns. */
export function gridKeyDown(e: React.KeyboardEvent<HTMLElement>, cols: number) {
  const cells = [
    ...e.currentTarget.querySelectorAll<HTMLButtonElement>(
      '[data-cell]:not(:disabled)',
    ),
  ];
  const i = cells.indexOf(document.activeElement as HTMLButtonElement);
  if (i < 0) return;
  const row = Math.floor(i / cols) * cols;
  const moves: Record<string, number> = {
    ArrowRight: i + 1,
    ArrowLeft: i - 1,
    ArrowDown: i + cols,
    ArrowUp: i - cols,
    Home: row,
    End: Math.min(cells.length - 1, row + cols - 1),
  };
  if (!(e.key in moves)) return;
  e.preventDefault();
  // At an edge the focus stays where it is.
  cells[moves[e.key]]?.focus();
}

export const TimeField: React.FC<TimeFieldProps> = ({
  id,
  value,
  onChange,
  name,
  invalid,
  disabled,
  'aria-describedby': describedBy,
  'aria-label': ariaLabel,
  placeholder = 'hh:mm',
  step = TIME_STEP,
  timeZone = DEFAULT_TIMEZONE,
  suggestions = [],
  clearable = true,
  className,
}) => {
  const [text, setText] = useState(value);
  const [seen, setSeen] = useState(value);
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelId = `${id}-picker-${useId().replace(/:/g, '')}`;
  const noteId = `${id}-note`;

  // A new value from outside (load current version, merge, reset) replaces
  // the text unless the text already means that value.
  if (value !== seen) {
    setSeen(value);
    if (parseTime(text) !== value) setText(value);
  }

  const commit = (next: string) => {
    if (next !== value) onChange(next);
  };

  const onText = (t: string) => {
    setText(t);
    setNote(null);
    const parsed = parseTime(t, nowRounded(timeZone, step));
    if (parsed !== null) commit(parsed);
  };

  const settle = () => {
    const parsed = parseTime(text, nowRounded(timeZone, step));
    if (parsed === null) {
      setNote(
        `No he entendido «${text.trim()}»: ${
          value ? `se mantiene ${value}` : 'queda sin hora'
        }. Escribe, por ejemplo, 930 o 9:30.`,
      );
      setText(value);
    } else {
      setText(parsed);
    }
  };

  const nudge = (direction: 1 | -1) => {
    const base = parseTime(text) || value || nowRounded(timeZone, step);
    const next = stepTime(base, direction, step);
    setText(next);
    setNote(null);
    commit(next);
  };

  const close = (focusButton: boolean) => {
    setOpen(false);
    if (focusButton) toggleRef.current?.focus();
  };

  const pick = (next: string, done: boolean) => {
    setText(next);
    setNote(null);
    commit(next);
    if (done) close(true);
  };

  const described = [describedBy, note ? noteId : ''].filter(Boolean).join(' ');

  return (
    <>
      <div
        ref={wrapRef}
        className={[
          'lx-ctl',
          'lx-ctl--time',
          open ? 'lx-ctl--open' : '',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <input
          ref={inputRef}
          id={id}
          name={name}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          maxLength={12}
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
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              if (e.altKey && e.key === 'ArrowDown') setOpen(true);
              else nudge(e.key === 'ArrowUp' ? 1 : -1);
            } else if (e.key === 'Enter') {
              settle();
            }
          }}
        />
        <button
          ref={toggleRef}
          type="button"
          className="lx-ctl__toggle"
          aria-label={value ? `Elegir hora, ahora ${value}` : 'Elegir hora'}
          title="Elegir hora"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={panelId}
          disabled={disabled}
          onClick={() => (open ? close(false) : setOpen(true))}
        >
          <Icon name="clock" size={20} />
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
        width={328}
        onClose={reason => close(reason === 'escape')}
        role="dialog"
        aria-label="Elegir hora"
        className="lx-pop--picker"
      >
        <TimePanel
          id={id}
          value={value}
          step={step}
          now={nowRounded(timeZone, step)}
          suggestions={suggestions}
          clearable={clearable}
          onPick={pick}
          onDone={() => close(true)}
        />
      </Popover>
    </>
  );
};

const TimePanel: React.FC<{
  id: string;
  value: string;
  step: number;
  now: string;
  suggestions: TimeSuggestion[];
  clearable: boolean;
  onPick: (value: string, done: boolean) => void;
  onDone: () => void;
}> = ({id, value, step, now, suggestions, clearable, onPick, onDone}) => {
  const hour = value ? value.slice(0, 2) : null;
  const minute = value ? value.slice(3, 5) : null;
  const minutes = Array.from({length: Math.ceil(60 / step)}, (_, i) =>
    String(i * step).padStart(2, '0'),
  );
  const hoursRef = useRef<HTMLDivElement>(null);
  const minutesRef = useRef<HTMLDivElement>(null);
  const [focusMinutes, setFocusMinutes] = useState(false);

  // On open: the chosen hour, or the current one.
  useEffect(() => {
    const target = hour ?? now.slice(0, 2);
    hoursRef.current
      ?.querySelector<HTMLButtonElement>(`[data-cell="${target}"]`)
      ?.focus();
    // Only when the panel opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // After an hour: on to the minutes.
  useEffect(() => {
    if (!focusMinutes) return;
    setFocusMinutes(false);
    const list = minutesRef.current;
    (
      list?.querySelector<HTMLButtonElement>('[aria-pressed="true"]') ??
      list?.querySelector<HTMLButtonElement>('[data-cell]')
    )?.focus();
  }, [focusMinutes]);

  const quick: TimeSuggestion[] = [
    {value: now, label: 'Ahora'},
    ...suggestions,
  ];
  const rovingHour = hour ?? now.slice(0, 2);
  const minuteOnGrid = minute && minutes.includes(minute) ? minute : null;
  const rovingMinute = minuteOnGrid ?? minutes[0];

  return (
    <div className="lx-tp">
      <div
        className="lx-pick__quick lx-pick__quick--grid"
        role="group"
        aria-label="Atajos"
      >
        {quick.map(s => (
          <button
            key={`${s.label ?? ''}${s.value}`}
            type="button"
            className="lx-pick__chip"
            id={s.label === 'Ahora' ? `${id}-now` : undefined}
            aria-pressed={value === s.value && s.label !== 'Ahora'}
            onClick={() => onPick(s.value, true)}
          >
            {s.label ?? s.value}
            {s.label && (
              <>
                {' '}
                <span className="lx-num">{s.value}</span>
              </>
            )}
          </button>
        ))}
      </div>

      <p className="lx-pick__label" id={`${id}-hours-label`}>
        Hora
      </p>
      <div
        ref={hoursRef}
        className="lx-tp__grid lx-tp__grid--hours"
        role="group"
        aria-labelledby={`${id}-hours-label`}
        onKeyDown={e => gridKeyDown(e, 6)}
      >
        {HOURS.map(h => (
          <button
            key={h}
            type="button"
            data-cell={h}
            className={[
              'lx-tp__cell',
              'lx-num',
              Number(h) < 6 ? 'lx-tp__cell--night' : '',
              h === now.slice(0, 2) ? 'lx-tp__cell--now' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            aria-pressed={hour === h}
            aria-label={`${h} h`}
            tabIndex={h === rovingHour ? 0 : -1}
            onClick={() => {
              onPick(`${h}:${minute ?? '00'}`, false);
              setFocusMinutes(true);
            }}
          >
            {h}
          </button>
        ))}
      </div>

      <p className="lx-pick__label" id={`${id}-minutes-label`}>
        Minutos
      </p>
      <div
        ref={minutesRef}
        className="lx-tp__grid lx-tp__grid--minutes"
        role="group"
        aria-labelledby={`${id}-minutes-label`}
        onKeyDown={e => gridKeyDown(e, 6)}
      >
        {minutes.map(m => (
          <button
            key={m}
            type="button"
            data-cell={m}
            className="lx-tp__cell lx-tp__cell--minute lx-num"
            aria-pressed={minuteOnGrid === m}
            aria-label={`${m} minutos`}
            tabIndex={m === rovingMinute ? 0 : -1}
            onClick={() => onPick(`${hour ?? now.slice(0, 2)}:${m}`, true)}
          >
            :{m}
          </button>
        ))}
      </div>

      <div className="lx-pick__foot">
        {clearable ? (
          <button
            type="button"
            className="lx-pick__clear"
            id={`${id}-clear`}
            disabled={!value}
            onClick={() => onPick('', true)}
          >
            Sin hora
          </button>
        ) : (
          <span />
        )}
        <output className="lx-pick__value lx-num" aria-live="polite">
          {value || '--:--'}
        </output>
        <button
          type="button"
          className="lx-btn lx-btn--primary lx-btn--sm"
          id={`${id}-done`}
          onClick={onDone}
        >
          Listo
        </button>
      </div>
    </div>
  );
};
