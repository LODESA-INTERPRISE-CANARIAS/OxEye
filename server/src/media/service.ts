/**
 * Images of records (Revisión 1 · E3): photos of inventory material today,
 * profile photos later (E4). Bytes are stored in PostgreSQL (`media.data`),
 * so backups include them; they are resized on the device before upload.
 *
 * Rules:
 * - the bytes must really be a JPEG, PNG or WebP of the declared type and
 *   size (read from the header), at most MEDIA_MAX_BYTES, each side at most
 *   MEDIA_MAX_SIDE;
 * - at most MEDIA_PER_RECORD per record; the first one is always main, and
 *   at most one is main (deleting the main one promotes the oldest left);
 * - uploads accept a device id and replay like other creates (M6);
 * - writes hold the catalogue lock (resources are written and deleted under
 *   it) and are logged as an update of the owner (`changedFields`
 *   ['media']), without changing the owner's version, so a photo never
 *   turns someone's open form into a conflict.
 *
 * Guests can see material photos (they see the material itself); nothing
 * here derives a quantity, a load or a measurement from an image.
 *
 * Revisión 1 · E4: profile photos (`ownerType: 'user'`). Only the owner
 * uploads or removes theirs, never during a support session; one per
 * account (a new one replaces it); logged in the security log, not in the
 * activity feed. The guest account has none and sees nobody's (404).
 * Material photos need `plan.edit` to change.
 */
import type {Db, Queryable} from '../db/db.ts';
import {toIso} from '../db/db.ts';
import {AppError, notFound, validationError} from '../errors.ts';
import {appendActivity} from '../activity/service.ts';
import {logSecurity} from '../account/security.ts';
import {isShared} from '../account/service.ts';
import {
  checkAccess,
  isUuid,
  requireMembership,
} from '../organizations/service.ts';
import {createOnce, findReplay, fresh} from '../records/device-id.ts';
import type {Created, DeviceCreate} from '../records/device-id.ts';
import {lockCatalogue} from '../records/locks.ts';
import {readImageHeader, stripImageMetadata} from './image.ts';
import type {UploadMediaBody} from './schemas.ts';
import {
  MEDIA_MAX_BYTES,
  MEDIA_PER_RECORD,
} from '../../../shared/logistics/rules.ts';
import type {
  MediaInfo,
  MediaOwnerType,
  SessionUser,
} from '../../../shared/logistics/contracts.ts';

interface MediaRow {
  id: string;
  organization_id: string;
  owner_type: MediaOwnerType;
  owner_id: string;
  content_type: MediaInfo['contentType'];
  bytes: number;
  width: number;
  height: number;
  is_main: boolean;
  created_by: string;
  created_by_name: string;
  created_at: unknown;
  is_demo: boolean;
}

const SELECT_MEDIA = `
  SELECT m.id, m.organization_id, m.owner_type, m.owner_id, m.content_type,
         m.bytes, m.width, m.height, m.is_main, m.created_by,
         cu.display_name AS created_by_name, m.created_at, m.is_demo
    FROM media m JOIN users cu ON cu.id = m.created_by`;

/** Main first, then oldest first. */
const MEDIA_ORDER = 'm.is_main DESC, m.created_at, m.id';

export const MEDIA_NOT_FOUND =
  'No encontramos esa foto: puede que otra persona la haya borrado.';
const OWNER_NOT_FOUND =
  'No encontramos ese material en esta organización: puede que se haya eliminado.';
const OWN_PHOTO_ONLY = 'Solo puedes cambiar tu propia foto de perfil.';
const NO_PHOTO_IN_SUPPORT =
  'Durante una sesión de soporte no se cambia la foto de perfil de la cuenta.';
const SHARED_PHOTO =
  'Esta cuenta es compartida: su nombre y su foto los cambia administración.';
const TOO_MANY = `Este material ya tiene ${MEDIA_PER_RECORD} fotos: borra una para añadir otra.`;
const TOO_BIG = `La foto ocupa demasiado (máximo ${Math.round(MEDIA_MAX_BYTES / 1024)} KB). Vuelve a elegirla para que se reduzca.`;
const NOT_AN_IMAGE =
  'No hemos podido leer esta foto: usa una imagen JPEG, PNG o WebP.';
const TYPE_MISMATCH =
  'El tipo de la foto no coincide con su contenido: vuelve a elegirla.';
const SIZE_MISMATCH =
  'Las medidas de la foto no coinciden con su contenido: vuelve a elegirla.';

export function toMediaInfo(row: MediaRow): MediaInfo {
  return {
    id: row.id,
    ownerType: row.owner_type,
    ownerId: row.owner_id,
    contentType: row.content_type,
    bytes: Number(row.bytes),
    width: Number(row.width),
    height: Number(row.height),
    main: Boolean(row.is_main),
    createdBy: {id: row.created_by, displayName: row.created_by_name},
    createdAt: toIso(row.created_at),
  };
}

/**
 * A jsonb list of the media of record alias `t` of `ownerType` (a constant),
 * main first, then oldest first; read it with `parseMediaList`.
 */
export function mediaListColumn(ownerType: MediaOwnerType, t: string): string {
  return `COALESCE((SELECT jsonb_agg(jsonb_build_object(
             'id', m.id, 'ownerType', m.owner_type, 'ownerId', m.owner_id,
             'contentType', m.content_type, 'bytes', m.bytes,
             'width', m.width, 'height', m.height, 'main', m.is_main,
             'createdBy', m.created_by, 'createdByName', mu.display_name,
             'createdAt', m.created_at) ORDER BY ${MEDIA_ORDER})
       FROM media m JOIN users mu ON mu.id = m.created_by
      WHERE m.owner_type = '${ownerType}' AND m.owner_id = ${t}.id),
    '[]'::jsonb)`;
}

/** The list selected with `mediaListColumn`, in contract shape. */
export function parseMediaList(value: unknown): MediaInfo[] {
  const list =
    typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
  if (!Array.isArray(list)) return [];
  return list.map(item => {
    const o = item as Record<string, unknown>;
    return toMediaInfo({
      id: String(o.id),
      organization_id: '',
      owner_type: o.ownerType as MediaOwnerType,
      owner_id: String(o.ownerId),
      content_type: o.contentType as MediaInfo['contentType'],
      bytes: Number(o.bytes),
      width: Number(o.width),
      height: Number(o.height),
      is_main: Boolean(o.main),
      created_by: String(o.createdBy),
      created_by_name: String(o.createdByName ?? ''),
      created_at: String(o.createdAt),
      is_demo: false,
    });
  });
}

/** Deletes every image of the given owners (their delete paths call it first). */
export async function deleteMediaOf(
  tx: Queryable,
  ownerType: MediaOwnerType,
  ownerIds: readonly string[],
): Promise<void> {
  if (ownerIds.length === 0) return;
  await tx.query(
    `DELETE FROM media
      WHERE owner_type = $1
        AND owner_id IN (SELECT value::uuid FROM jsonb_array_elements_text($2::jsonb))`,
    [ownerType, JSON.stringify(ownerIds)],
  );
}

async function loadMedia(
  db: Queryable,
  id: string,
  lock = false,
): Promise<MediaRow | undefined> {
  const rows = await db.query<MediaRow>(
    `${SELECT_MEDIA} WHERE m.id = $1${lock ? ' FOR UPDATE OF m' : ''}`,
    [id],
  );
  return rows[0];
}

/**
 * Loads the image and checks membership; foreign ones are «not found», and
 * so are profile photos for the guest account.
 */
async function loadOwnMedia(
  db: Queryable,
  actor: SessionUser,
  id: string,
): Promise<MediaRow> {
  if (!isUuid(id)) throw notFound(MEDIA_NOT_FOUND);
  const row = await loadMedia(db, id);
  if (!row) throw notFound(MEDIA_NOT_FOUND);
  if (row.owner_type === 'user' && actor.role === 'guest') {
    throw notFound(MEDIA_NOT_FOUND);
  }
  try {
    await requireMembership(db, actor.id, row.organization_id);
  } catch {
    throw notFound(MEDIA_NOT_FOUND);
  }
  return row;
}

/** Changing an image: own profile photo, or `plan.edit` for material. */
async function checkMayChange(
  q: Queryable,
  actor: SessionUser,
  row: {owner_type: MediaOwnerType; owner_id: string; organization_id: string},
): Promise<void> {
  if (row.owner_type === 'user') {
    if (row.owner_id !== actor.id) {
      throw new AppError('FORBIDDEN', OWN_PHOTO_ONLY);
    }
    if (actor.support) throw new AppError('FORBIDDEN', NO_PHOTO_IN_SUPPORT);
    // Shared accounts (Equipo, Invitado): administrators set their photo.
    if (await isShared(q, actor)) {
      throw new AppError('FORBIDDEN', SHARED_PHOTO);
    }
    return;
  }
  const membership = await requireMembership(q, actor.id, row.organization_id);
  checkAccess(membership, actor, 'plan.edit');
}

/** The owner record's label and demo flag, if it belongs to the organization. */
async function findOwner(
  tx: Queryable,
  organizationId: string,
  ownerType: MediaOwnerType,
  ownerId: string,
): Promise<{id: string; label: string; isDemo: boolean} | undefined> {
  if (ownerType === 'user') {
    const users = await tx.query<{id: string; name: string}>(
      `SELECT u.id, u.display_name AS name FROM users u
         JOIN organization_members m ON m.user_id = u.id
        WHERE u.id = $1 AND m.organization_id = $2`,
      [ownerId, organizationId],
    );
    const user = users[0];
    return user ? {id: user.id, label: user.name, isDemo: false} : undefined;
  }
  const rows = await tx.query<{id: string; name: string; is_demo: boolean}>(
    'SELECT id, name, is_demo FROM resources WHERE id = $1 AND organization_id = $2',
    [ownerId, organizationId],
  );
  const row = rows[0];
  return row ? {id: row.id, label: row.name, isDemo: row.is_demo} : undefined;
}

async function logOwnerChange(
  tx: Queryable,
  args: {
    organizationId: string;
    actorId: string;
    owner: {id: string; label: string; isDemo: boolean};
    ownerType: MediaOwnerType;
    now: Date;
  },
): Promise<void> {
  if (args.ownerType === 'user') {
    // A profile photo is not plan data: security log only.
    await logSecurity(tx, {
      userId: args.owner.id,
      kind: 'profile_changed',
      at: args.now,
    });
    return;
  }
  await appendActivity(tx, {
    organizationId: args.organizationId,
    userId: args.actorId,
    entityType: args.ownerType,
    entityId: args.owner.id,
    entityLabel: args.owner.label,
    action: 'update',
    changedFields: ['media'],
    at: args.now,
    isDemo: args.owner.isDemo,
  });
}

/**
 * Checks the bytes against what was declared; the decoded bytes without
 * their metadata when valid (the stored size is the stripped one).
 */
export function checkImage(input: {
  contentType: MediaInfo['contentType'];
  width: number;
  height: number;
  data: string;
}): Uint8Array {
  const bytes = new Uint8Array(Buffer.from(input.data, 'base64'));
  if (bytes.length === 0) throw validationError({data: NOT_AN_IMAGE});
  if (bytes.length > MEDIA_MAX_BYTES) throw validationError({data: TOO_BIG});
  const header = readImageHeader(bytes);
  if (!header) throw validationError({data: NOT_AN_IMAGE});
  if (header.contentType !== input.contentType) {
    throw validationError({contentType: TYPE_MISMATCH});
  }
  if (header.width !== input.width || header.height !== input.height) {
    throw validationError({width: SIZE_MISMATCH});
  }
  // Safety audit: never store EXIF/XMP/IPTC (GPS, device, owner) of a photo.
  const stripped = stripImageMetadata(bytes, header);
  if (!stripped) throw validationError({data: NOT_AN_IMAGE});
  return stripped;
}

/** Stores one image of a record (see the file comment for the rules). */
export async function uploadMedia(
  db: Db,
  actor: SessionUser,
  input: UploadMediaBody,
  now: Date,
): Promise<Created<MediaInfo>> {
  const device: DeviceCreate<MediaInfo> = {
    table: 'media',
    id: input.id,
    organizationId: input.organizationId,
    actorId: actor.id,
    load: async (q, id) => {
      const row = await loadMedia(q, id);
      return row && toMediaInfo(row);
    },
  };
  return createOnce(db, device, async tx => {
    const org = await requireMembership(tx, actor.id, input.organizationId);
    await lockCatalogue(tx, org.id);
    const replay = await findReplay(tx, device, org.id);
    if (replay) return replay;
    const profile = input.ownerType === 'user';
    await checkMayChange(tx, actor, {
      owner_type: input.ownerType,
      owner_id: input.ownerId,
      organization_id: org.id,
    });
    if (profile) {
      // Serialises two uploads of the same account.
      await tx.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [
        actor.id,
      ]);
    }
    const owner = await findOwner(tx, org.id, input.ownerType, input.ownerId);
    if (!owner) {
      throw validationError({
        ownerId: profile ? OWN_PHOTO_ONLY : OWNER_NOT_FOUND,
      });
    }
    const bytes = checkImage(input);
    if (profile) {
      // One profile photo per account: the new one replaces it (any organization).
      await tx.query(
        "DELETE FROM media WHERE owner_type = 'user' AND owner_id = $1",
        [owner.id],
      );
    }
    const existing = await tx.query<{id: string; is_main: boolean}>(
      `SELECT id, is_main FROM media WHERE owner_type = $1 AND owner_id = $2
        ORDER BY id FOR UPDATE`,
      [input.ownerType, owner.id],
    );
    if (existing.length >= MEDIA_PER_RECORD) {
      throw validationError({ownerId: TOO_MANY}, TOO_MANY);
    }
    const main = existing.length === 0 || input.main === true;
    if (main && existing.some(e => e.is_main)) {
      await tx.query(
        `UPDATE media SET is_main = false
          WHERE owner_type = $1 AND owner_id = $2 AND is_main`,
        [input.ownerType, owner.id],
      );
    }
    const inserted = await tx.query<{id: string}>(
      `INSERT INTO media
         (organization_id, owner_type, owner_id, content_type, bytes, width,
          height, is_main, data, created_by, created_at, is_demo, id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, decode($9, 'base64'), $10,
               $11::timestamptz, $12, COALESCE($13::uuid, gen_random_uuid()))
       RETURNING id`,
      [
        org.id,
        input.ownerType,
        owner.id,
        input.contentType,
        bytes.length,
        input.width,
        input.height,
        main,
        Buffer.from(bytes).toString('base64'),
        actor.id,
        now.toISOString(),
        owner.isDemo,
        input.id ?? null,
      ],
    );
    await logOwnerChange(tx, {
      organizationId: org.id,
      actorId: actor.id,
      owner,
      ownerType: input.ownerType,
      now,
    });
    const row = (await loadMedia(
      tx,
      (inserted[0] as {id: string}).id,
    )) as MediaRow;
    return fresh(toMediaInfo(row));
  });
}

/** The image bytes for an authenticated member or guest of its organization. */
export async function readMedia(
  db: Db,
  actor: SessionUser,
  id: string,
): Promise<{contentType: string; bytes: Uint8Array}> {
  const row = await loadOwnMedia(db, actor, id);
  const [data] = await db.query<{data: string}>(
    "SELECT encode(data, 'base64') AS data FROM media WHERE id = $1",
    [row.id],
  );
  if (!data) throw notFound(MEDIA_NOT_FOUND);
  return {
    contentType: row.content_type,
    bytes: new Uint8Array(Buffer.from(data.data, 'base64')),
  };
}

/** Deletes an image; the oldest one left becomes main if it was the main one. */
export async function deleteMedia(
  db: Db,
  actor: SessionUser,
  id: string,
  now: Date,
): Promise<void> {
  await db.transaction(async tx => {
    const unlocked = await loadOwnMedia(tx, actor, id);
    await lockCatalogue(tx, unlocked.organization_id);
    const row = await loadMedia(tx, unlocked.id, true);
    if (!row) throw notFound(MEDIA_NOT_FOUND);
    await checkMayChange(tx, actor, row);
    await tx.query('DELETE FROM media WHERE id = $1', [row.id]);
    if (row.is_main) {
      await tx.query(
        `UPDATE media SET is_main = true
          WHERE id = (SELECT id FROM media
                       WHERE owner_type = $1 AND owner_id = $2
                       ORDER BY created_at, id LIMIT 1)`,
        [row.owner_type, row.owner_id],
      );
    }
    const owner = await findOwner(
      tx,
      row.organization_id,
      row.owner_type,
      row.owner_id,
    );
    if (owner) {
      await logOwnerChange(tx, {
        organizationId: row.organization_id,
        actorId: actor.id,
        owner,
        ownerType: row.owner_type,
        now,
      });
    }
  });
}

/** Makes an image the main one of its record. */
export async function setMainMedia(
  db: Db,
  actor: SessionUser,
  id: string,
  now: Date,
): Promise<MediaInfo> {
  return db.transaction(async tx => {
    const unlocked = await loadOwnMedia(tx, actor, id);
    await lockCatalogue(tx, unlocked.organization_id);
    const row = await loadMedia(tx, unlocked.id, true);
    if (!row) throw notFound(MEDIA_NOT_FOUND);
    await checkMayChange(tx, actor, row);
    if (row.is_main) return toMediaInfo(row);
    await tx.query(
      `UPDATE media SET is_main = false
        WHERE owner_type = $1 AND owner_id = $2 AND is_main`,
      [row.owner_type, row.owner_id],
    );
    await tx.query('UPDATE media SET is_main = true WHERE id = $1', [row.id]);
    const owner = await findOwner(
      tx,
      row.organization_id,
      row.owner_type,
      row.owner_id,
    );
    if (owner) {
      await logOwnerChange(tx, {
        organizationId: row.organization_id,
        actorId: actor.id,
        owner,
        ownerType: row.owner_type,
        now,
      });
    }
    return toMediaInfo((await loadMedia(tx, row.id)) as MediaRow);
  });
}
