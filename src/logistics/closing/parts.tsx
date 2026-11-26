/**
 * Small pieces shared by the «Cierre de jornada» sections: a report line
 * that opens its record, the «Pendiente de enviar» mark, a list that shows
 * its first rows and «Ver todo», and the quiet line for empty sections.
 */
import React, {useState} from 'react';
import type {Uuid} from '../../../shared/logistics/contracts.ts';
import type {
  DayRecordLine,
  DayRecordType,
} from '../../../shared/logistics/day-report.ts';
import {utcToLocal} from '../../../shared/logistics/time.ts';
import {DemoChip, VerificationChip} from '../events/EventChips';
import {useLogisticsStore} from '../store/useLogisticsStore';
import {Button, Icon, type IconName} from '../ui';
import {changeLabel} from './day';
import {useOpenRecord, type OpenTarget} from './useOpenRecord';

export const TYPE_ICON: Record<DayRecordType, IconName> = {
  event: 'calendar',
  task: 'task',
  contact: 'user',
  company: 'building',
  offer: 'offer',
  warehouse: 'warehouse',
  resource: 'inventory',
  note: 'note',
};

/** Local «HH:MM» of an instant. */
export function timeIn(instant: string, timeZone: string): string {
  return utcToLocal(instant, timeZone).time;
}

/** Opens a record from a line, or says it is gone. */
export function useOpenLine(): (type: OpenTarget, id: Uuid) => void {
  const open = useOpenRecord();
  const toast = useLogisticsStore(s => s.toast);
  return (type, id) => {
    if (!open(type, id)) {
      toast('Ese registro ya no está en la lista: puede que lo hayan borrado.');
    }
  };
}

/** A write of this record still waits on this device. */
export const UnsentMark: React.FC = () => (
  <span
    className="lx-unsent"
    title="Guardado en este dispositivo; se enviará cuando vuelva la conexión. El equipo aún no lo ve."
  >
    <Icon name="cloudOff" size={13} />
    Pendiente de enviar
  </span>
);

/** One created or modified record: name, detail, certainty and who. */
export const RecordLineRow: React.FC<{
  line: DayRecordLine;
  timeZone: string;
  unsent: boolean;
}> = ({line, timeZone, unsent}) => {
  const open = useOpenLine();
  return (
    <li>
      <button
        type="button"
        className="lx-dayline"
        onClick={() => open(line.type, line.id)}
      >
        <Icon
          name={TYPE_ICON[line.type]}
          size={18}
          className="lx-dayline__icon"
        />
        <span className="lx-dayline__main">
          <span className="lx-dayline__name">{line.label}</span>
          {line.detail && (
            <span className="lx-dayline__detail">{line.detail}</span>
          )}
          <span className="lx-dayline__meta lx-num">
            <span
              className={`lx-dayline__change${line.change === 'created' ? ' is-new' : ''}`}
            >
              {changeLabel(line)}
            </span>
            {' · '}
            {line.by.displayName} · {timeIn(line.at, timeZone)}
          </span>
        </span>
        <span className="lx-dayline__chips">
          <VerificationChip verification={line.verification} />
          {line.isDemo && <DemoChip />}
          {unsent && <UnsentMark />}
        </span>
        <Icon name="chevronRight" size={18} className="lx-dayline__go" />
      </button>
    </li>
  );
};

/** First `shown` items, then «Ver todo (N)» / «Ver menos». */
export function ShowMore<T>({
  items,
  shown,
  render,
  className,
  labelledBy,
  noun,
}: {
  items: readonly T[];
  shown: number;
  render: (item: T) => React.ReactNode;
  className?: string;
  labelledBy?: string;
  /** «registros», «tareas»: what «Ver todo» counts. */
  noun: string;
}): React.ReactElement {
  const [all, setAll] = useState(false);
  const visible = all ? items : items.slice(0, shown);
  const hidden = items.length - visible.length;
  return (
    <>
      <ul className={className} aria-labelledby={labelledBy}>
        {visible.map(render)}
      </ul>
      {(hidden > 0 || all) && items.length > shown && (
        <Button
          size="sm"
          variant="ghost"
          className="lx-dayclose__more"
          icon={all ? undefined : 'chevronDown'}
          aria-expanded={all}
          onClick={() => setAll(v => !v)}
        >
          {all ? 'Ver menos' : `Ver todo (${items.length} ${noun})`}
        </Button>
      )}
    </>
  );
}

/** One quiet line instead of an empty card. */
export const QuietLine: React.FC<{
  children: React.ReactNode;
  id?: string;
}> = ({children, id}) => (
  <p className="lx-dayclose__quiet" id={id}>
    <Icon name="check" size={15} />
    <span>{children}</span>
  </p>
);
