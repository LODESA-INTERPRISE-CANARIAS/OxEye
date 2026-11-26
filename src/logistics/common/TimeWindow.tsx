/**
 * Local time window of an event or task: «17:00 – 21:00», «22:00 – 02:00
 * (día siguiente)», «2 dic 10:00 – 4 dic 18:00». Missing parts show as
 * «Pendiente de verificar», never guessed.
 */
import React from 'react';
import type {LocalDate} from '../../../shared/logistics/contracts.ts';
import {utcToLocal} from '../../../shared/logistics/time.ts';
import {dayMonthShort} from '../lib/format';
import {recordSlot, taskZone} from '../lib/tasks';
import {Pending} from '../ui';

export interface WindowRecord {
  date: LocalDate | null;
  endDate: LocalDate | null;
  startsAt: string | null;
  endsAt: string | null;
  timezone: string;
}

/** Last local day of the record when it differs from the first, else null. */
export function lastDay(record: WindowRecord): LocalDate | null {
  const {date} = recordSlot(record);
  if (!date) return null;
  let last = record.endDate && record.endDate > date ? record.endDate : null;
  if (record.endsAt) {
    const end = utcToLocal(record.endsAt, taskZone(record));
    if (end.date > date && (!last || end.date > last)) last = end.date;
  }
  return last;
}

/** Plain text version, for accessible names and summaries. */
export function windowText(record: WindowRecord): string {
  const {date, startTime, endTime} = recordSlot(record);
  const last = lastDay(record);
  const multi = !!(date && last && record.endDate);
  if (!startTime && !endTime) {
    if (multi) return `${dayMonthShort(date!)} – ${dayMonthShort(last!)}`;
    return 'horario pendiente de verificar';
  }
  const s = startTime ?? 'inicio pendiente';
  const e = endTime ?? 'fin pendiente';
  if (multi) {
    return `${dayMonthShort(date!)} ${s} – ${dayMonthShort(last!)} ${e}`;
  }
  return `${s} – ${e}${last ? ' (día siguiente)' : ''}`;
}

export const TimeWindow: React.FC<{record: WindowRecord}> = ({record}) => {
  const {date, startTime, endTime} = recordSlot(record);
  const last = lastDay(record);
  const multi = !!(date && last && record.endDate);
  if (!startTime && !endTime) {
    if (multi) {
      return (
        <span className="lx-num">
          {dayMonthShort(date!)} – {dayMonthShort(last!)}{' '}
          <Pending>horas pendientes</Pending>
        </span>
      );
    }
    return <Pending>Horario pendiente de verificar</Pending>;
  }
  return (
    <span className="lx-num">
      {multi && `${dayMonthShort(date!)} `}
      {startTime ?? <Pending>inicio</Pending>}
      {' – '}
      {multi && `${dayMonthShort(last!)} `}
      {endTime ?? <Pending>fin</Pending>}
      {!multi && last && (
        <span className="lx-muted" title="Termina al día siguiente">
          {' '}
          (+1 día)
        </span>
      )}
    </span>
  );
};
