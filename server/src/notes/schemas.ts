/**
 * Input schemas for notes (NoteInput in the shared contract). Unknown keys
 * are ignored, so a newer client can talk to this server.
 */
import {z} from 'zod';
import {REQUIRED, requiredText, uuid} from '../http/validate.ts';
import {
  optionalUuid,
  source,
  verification,
  versionField,
} from '../records/schemas.ts';
import {
  NOTE_KINDS,
  NOTE_REF_TYPES,
  NOTE_TEXT_MAX,
} from '../../../shared/logistics/rules.ts';
import type {NoteRefType} from '../../../shared/logistics/contracts.ts';

const KIND_INVALID =
  'Tipo no válido: usa nota, incidencia, decisión, pregunta abierta o idea para la herramienta.';
const kind = z.enum(NOTE_KINDS, {
  error: iss => (iss.input === undefined ? REQUIRED : KIND_INVALID),
});

export const REF_INVALID =
  'Vínculo no válido: indica el tipo de registro (tarea, lugar, empresa, persona, oferta, almacén o recurso) y su identificador.';

const refShape = z.object({type: z.enum(NOTE_REF_TYPES), id: uuid});

/**
 * {type, id} of one record, or null to remove the link. Any problem is
 * reported on `ref` itself, so the form can show it next to the link.
 */
const ref = z
  .unknown()
  .transform(
    (value, ctx): {type: NoteRefType; id: string} | null | undefined => {
      if (value === undefined) return undefined;
      if (value === null) return null;
      const parsed = refShape.safeParse(value);
      if (!parsed.success) {
        ctx.addIssue({code: 'custom', message: REF_INVALID});
        return z.NEVER;
      }
      return {type: parsed.data.type, id: parsed.data.id.toLowerCase()};
    },
  )
  .optional();

const common = {
  eventId: optionalUuid,
  ref,
  resolved: z.boolean({error: 'Indica sí o no: ¿está resuelta?'}).optional(),
  source,
  verification,
};

export const createNoteSchema = z.object({
  organizationId: uuid,
  kind,
  text: requiredText(NOTE_TEXT_MAX),
  ...common,
});

/** A note never moves to another organization: `organizationId` is ignored. */
export const updateNoteSchema = z.object({
  version: versionField('la nota'),
  kind: kind.optional(),
  text: requiredText(NOTE_TEXT_MAX).optional(),
  ...common,
});

export type CreateNoteBody = z.output<typeof createNoteSchema>;
export type UpdateNoteBody = z.output<typeof updateNoteSchema>;
export type NoteBody = CreateNoteBody | UpdateNoteBody;
