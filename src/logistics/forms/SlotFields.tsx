/**
 * Date, start and end time, with a «Varios días» switch that reveals the last
 * day. Shared by events and tasks; times are local to `zone`.
 */
import React from 'react';
import {MAX_SPAN_DAYS} from '../../../shared/logistics/rules.ts';
import {addDays, daysBetween} from '../../../shared/logistics/time.ts';
import {zoneHoursNote} from '../lib/format';
import {Field, HelpTip, Input, describedBy} from '../ui';

export interface SlotValues {
  date: string;
  endDate: string;
  startTime: string;
  endTime: string;
  multiDay: boolean;
}

export type SlotErrors = Partial<Record<keyof SlotValues, string>>;

/** Client-side checks that mirror the server's rules. */
export function validateSlot(v: SlotValues): SlotErrors {
  const errors: SlotErrors = {};
  if ((v.startTime || v.endTime) && !v.date) {
    errors.date = 'Indica la fecha para poder guardar el horario.';
  } else if (v.multiDay && !v.date) {
    errors.date = 'Indica el primer día para poder guardar varios días.';
  }
  if (v.multiDay) {
    if (!v.endDate) {
      errors.endDate = 'Indica el último día o desactiva «Varios días».';
    } else if (v.date && v.endDate <= v.date) {
      errors.endDate = 'El último día tiene que ser posterior al primero.';
    } else if (v.date && daysBetween(v.date, v.endDate) > MAX_SPAN_DAYS) {
      errors.endDate = 'Como mucho, un año después del primer día.';
    }
  }
  return errors;
}

/** Slot fields as sent to the API (null when empty or not multi-day). */
export function slotInput(v: SlotValues) {
  const orNull = (s: string) => (s.trim() ? s.trim() : null);
  return {
    date: orNull(v.date),
    endDate: v.multiDay ? orNull(v.endDate) : null,
    startTime: orNull(v.startTime),
    endTime: orNull(v.endTime),
  };
}

export function slotChanged(a: SlotValues, b: SlotValues): boolean {
  const x = slotInput(a);
  const y = slotInput(b);
  return (
    x.date !== y.date ||
    x.endDate !== y.endDate ||
    x.startTime !== y.startTime ||
    x.endTime !== y.endTime
  );
}

const MULTI_DAY_HELP =
  'Para ferias, montajes o actividades que duran más de un día. La hora de inicio es la del primer día y la de fin, la del último. En el calendario aparecerá en todos los días.';

export const SlotFields: React.FC<{
  idPrefix: string;
  values: SlotValues;
  errors: SlotErrors;
  onChange: <K extends keyof SlotValues>(key: K, value: SlotValues[K]) => void;
  zone: string;
  /** «el evento», «la tarea». */
  subject: string;
}> = ({idPrefix, values, errors, onChange, zone, subject}) => {
  const id = (k: string) => `${idPrefix}-${k}`;
  const endsNextDay =
    !values.multiDay &&
    !!values.startTime &&
    !!values.endTime &&
    values.endTime <= values.startTime;
  const toggleMultiDay = (on: boolean) => {
    onChange('multiDay', on);
    if (!on) onChange('endDate', '');
    else if (!values.endDate && values.date) {
      onChange('endDate', addDays(values.date, 1));
    }
  };
  return (
    <div className="lx-slot">
      <div className="lx-form__row lx-form__row--slot">
        <Field
          id={id('date')}
          label={values.multiDay ? 'Primer día' : 'Fecha'}
          optional
          error={errors.date}
        >
          <Input
            id={id('date')}
            name={id('date')}
            type="date"
            value={values.date}
            invalid={!!errors.date}
            aria-describedby={describedBy(id('date'), {error: errors.date})}
            onChange={e => onChange('date', e.target.value)}
          />
        </Field>
        <Field
          id={id('start')}
          label="Inicio"
          optional
          error={errors.startTime}
        >
          <Input
            id={id('start')}
            name={id('start')}
            type="time"
            className="lx-num"
            value={values.startTime}
            invalid={!!errors.startTime}
            aria-describedby={describedBy(id('start'), {
              error: errors.startTime,
            })}
            onChange={e => onChange('startTime', e.target.value)}
          />
        </Field>
        <Field
          id={id('end')}
          label="Fin"
          optional
          error={errors.endTime}
          hint={endsNextDay ? 'Termina al día siguiente.' : undefined}
        >
          <Input
            id={id('end')}
            name={id('end')}
            type="time"
            className="lx-num"
            value={values.endTime}
            invalid={!!errors.endTime}
            aria-describedby={describedBy(id('end'), {
              error: errors.endTime,
              hint: endsNextDay,
            })}
            onChange={e => onChange('endTime', e.target.value)}
          />
        </Field>
      </div>

      <div className="lx-slot__multi">
        <span className="lx-switch">
          <input
            type="checkbox"
            role="switch"
            id={id('multiday')}
            checked={values.multiDay}
            aria-controls={values.multiDay ? id('enddate') : undefined}
            onChange={e => toggleMultiDay(e.target.checked)}
          />
          <label htmlFor={id('multiday')}>
            <span className="lx-switch__track" aria-hidden="true" />
            Varios días
          </label>
        </span>
        <HelpTip label="varios días">{MULTI_DAY_HELP}</HelpTip>
      </div>

      {values.multiDay && (
        <Field
          id={id('enddate')}
          label="Último día"
          error={errors.endDate}
          hint="La hora de fin es la de ese día."
          className="lx-slot__enddate"
        >
          <Input
            id={id('enddate')}
            name={id('enddate')}
            type="date"
            min={values.date ? addDays(values.date, 1) : undefined}
            value={values.endDate}
            invalid={!!errors.endDate}
            aria-describedby={describedBy(id('enddate'), {
              error: errors.endDate,
              hint: true,
            })}
            onChange={e => onChange('endDate', e.target.value)}
          />
        </Field>
      )}

      <p className="lx-form__note">
        {zoneHoursNote(zone)}. Si aún no las sabes, déjalas en blanco: {subject}{' '}
        quedará como «Pendiente de verificar».
      </p>
    </div>
  );
};
