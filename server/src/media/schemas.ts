/**
 * Input schemas for images (MediaUploadInput in the shared contract,
 * Revisión 1 · E3). Unknown keys are ignored, so a newer client can talk to
 * this server.
 */
import {z} from 'zod';
import {REQUIRED, uuid} from '../http/validate.ts';
import {deviceIdField} from '../records/device-id.ts';
import {
  MEDIA_CONTENT_TYPES,
  MEDIA_MAX_BYTES,
  MEDIA_MAX_SIDE,
} from '../../../shared/logistics/rules.ts';

const TYPE_INVALID = 'Tipo de imagen no válido: usa JPEG, PNG o WebP.';
const SIDE_INVALID = `Medida no válida: un número entero de píxeles entre 1 y ${MEDIA_MAX_SIDE}.`;
const DATA_INVALID =
  'La foto no ha llegado bien (se esperaba base64 sin prefijo). Vuelve a elegirla.';
const DATA_TOO_BIG = `La foto ocupa demasiado (máximo ${Math.round(MEDIA_MAX_BYTES / 1024)} KB). Vuelve a elegirla para que se reduzca.`;

/** Longest base64 text of MEDIA_MAX_BYTES bytes. */
const MAX_BASE64 = Math.ceil(MEDIA_MAX_BYTES / 3) * 4;

const side = z
  .number({error: iss => (iss.input === undefined ? REQUIRED : SIDE_INVALID)})
  .int({error: SIDE_INVALID})
  .min(1, {error: SIDE_INVALID})
  .max(MEDIA_MAX_SIDE, {error: SIDE_INVALID});

export const uploadMediaSchema = z.object({
  id: deviceIdField,
  organizationId: uuid,
  ownerType: z.enum(['resource', 'user'], {
    error: 'Tipo de registro no válido para una foto.',
  }),
  ownerId: uuid.transform(v => v.toLowerCase()),
  contentType: z.enum(MEDIA_CONTENT_TYPES, {
    error: iss => (iss.input === undefined ? REQUIRED : TYPE_INVALID),
  }),
  width: side,
  height: side,
  data: z
    .string({error: iss => (iss.input === undefined ? REQUIRED : DATA_INVALID)})
    .max(MAX_BASE64, {error: DATA_TOO_BIG})
    .refine(v => v.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(v), {
      error: DATA_INVALID,
    }),
  main: z.boolean({error: 'Indica sí o no: ¿es la foto principal?'}).optional(),
});

/** PATCH /media/:id: only `{main: true}`. */
export const setMainSchema = z.object({
  main: z.literal(true, {
    error:
      'Para cambiar la foto principal envía {main: true} en la que quieras.',
  }),
});

export type UploadMediaBody = z.output<typeof uploadMediaSchema>;
