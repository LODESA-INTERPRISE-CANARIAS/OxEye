/**
 * Task status chip (certainty grammar), kind label with icon, and the
 * heavy-load answer. Shared by the calendar, «Hoy» and the task sheet.
 */
import React from 'react';
import type {
  TaskKind,
  TaskStatus,
} from '../../../shared/logistics/contracts.ts';
import {
  TASK_KIND_ICON,
  TASK_KIND_LABEL,
  TASK_STATUS_HELP,
  TASK_STATUS_LABEL,
} from '../lib/tasks';
import {Chip, Icon, Pending} from '../ui';

export const TaskStatusChip: React.FC<{
  status: TaskStatus;
  size?: 'sm' | 'md';
}> = ({status, size = 'sm'}) => {
  const label = TASK_STATUS_LABEL[status];
  const title = TASK_STATUS_HELP[status];
  switch (status) {
    case 'confirmed':
    case 'in_progress':
    case 'done':
      return (
        <Chip certainty="confirmed" size={size} title={title}>
          {status === 'done' && <Icon name="check" size={13} />}
          {label}
        </Chip>
      );
    case 'delayed':
      return (
        <Chip certainty="confirmed" tone="danger" size={size} title={title}>
          {label}
        </Chip>
      );
    case 'cancelled':
      return (
        <Chip tag tone="neutral" struck size={size} title={title}>
          {label}
        </Chip>
      );
    default:
      return (
        <Chip certainty="planned" size={size} title={title}>
          {label}
        </Chip>
      );
  }
};

export const KindLabel: React.FC<{kind: TaskKind; iconOnly?: boolean}> = ({
  kind,
  iconOnly = false,
}) =>
  iconOnly ? (
    <Icon name={TASK_KIND_ICON[kind]} size={16} label={TASK_KIND_LABEL[kind]} />
  ) : (
    <span className="lx-kind">
      <Icon name={TASK_KIND_ICON[kind]} size={16} />
      {TASK_KIND_LABEL[kind]}
    </span>
  );

export function heavyLoadText(value: boolean | null): string {
  return value === true
    ? 'Sí, lleva carga pesada'
    : value === false
      ? 'No lleva carga pesada'
      : 'Pendiente de verificar';
}

export const HeavyLoadValue: React.FC<{value: boolean | null}> = ({value}) =>
  value === null ? (
    <Pending />
  ) : value ? (
    <span className="lx-heavy">
      <Icon name="weight" size={16} /> Sí: revisar el subsuelo en el simulador
    </span>
  ) : (
    <span>No</span>
  );
