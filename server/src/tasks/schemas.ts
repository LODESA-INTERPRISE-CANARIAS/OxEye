/**
 * Input schemas for tasks (TaskInput in the shared contract). Unknown keys
 * are ignored, so a newer client can talk to this server.
 */
import {z} from 'zod';
import {isUuid} from '../organizations/service.ts';
import {validationError} from '../errors.ts';
import {
  localDate,
  localTime,
  oneOf,
  optionalText,
  requiredText,
  uuid,
} from '../http/validate.ts';
import {
  idList,
  NAME_MAX,
  NOTES_MAX,
  parseVersionParam as parseRecordVersion,
  source,
  verification,
  versionField,
} from '../records/schemas.ts';
import {MAX_RESOURCES_PER_TASK} from '../../../shared/logistics/rules.ts';
import {
  MAX_DEPENDENCIES,
  normalizeIds,
  TASK_KINDS,
  TASK_STATUSES,
} from './domain.ts';

const kind = oneOf(
  TASK_KINDS,
  'Tipo no válido: usa montaje, actividad, desmontaje, transporte, entrega u otra.',
);
const status = oneOf(
  TASK_STATUSES,
  'Estado no válido: usa prevista, confirmada, en curso, hecha, retrasada o cancelada.',
);
const optionalUuid = uuid.nullable().optional();

const heavyLoad = z
  .boolean({error: 'Indica sí, no o déjalo sin saber.'})
  .nullable()
  .optional();

const dependsOn = z
  .array(z.unknown(), {error: 'Debe ser una lista de tareas.'})
  .max(MAX_DEPENDENCIES, {
    error: `Como máximo ${MAX_DEPENDENCIES} tareas previas.`,
  })
  .refine(list => list.every(isUuid), {
    error: 'Alguna de las tareas previas no es válida.',
  })
  .transform(list => normalizeIds(list as string[]))
  .optional();

const common = {
  eventId: optionalUuid,
  venueName: optionalText(NAME_MAX),
  kind: kind.optional(),
  status: status.optional(),
  date: localDate,
  endDate: localDate,
  startTime: localTime,
  endTime: localTime,
  companyId: optionalUuid,
  companyName: optionalText(NAME_MAX),
  contactId: optionalUuid,
  dependsOn,
  heavyLoad,
  resourceIds: idList(MAX_RESOURCES_PER_TASK, {
    list: 'recursos',
    invalid: 'Alguno de los recursos no es válido.',
  }),
  notes: optionalText(NOTES_MAX),
  source,
  verification,
};

export const createTaskSchema = z.object({
  organizationId: uuid,
  title: requiredText(NAME_MAX),
  ...common,
});

/** A task never moves to another organization: `organizationId` is ignored. */
export const updateTaskSchema = z.object({
  version: versionField('la tarea'),
  title: requiredText(NAME_MAX).optional(),
  ...common,
});

export type CreateTaskBody = z.output<typeof createTaskSchema>;
export type UpdateTaskBody = z.output<typeof updateTaskSchema>;
export type TaskBody = CreateTaskBody | UpdateTaskBody;

/** `?version=N` of DELETE /tasks/:id. */
export function parseVersionParam(raw: string | undefined): number {
  return parseRecordVersion(raw, 'la tarea');
}

/** `?eventId=` of GET /organizations/:orgId/tasks. */
export function parseEventIdParam(raw: string | undefined): string | null {
  if (raw === undefined || raw === '') return null;
  if (!isUuid(raw)) {
    throw validationError({eventId: 'Identificador no válido.'});
  }
  return raw.toLowerCase();
}
