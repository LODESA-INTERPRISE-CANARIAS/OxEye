/**
 * Material photos (Revisión 1 · E3): the order the server keeps (main first,
 * then oldest first), the local copy of a resource after a photo write, the
 * photos still waiting on this device, and the icon a resource shows when it
 * has no photo. No React, no store.
 *
 * A photo is a picture of the material, nothing more: nothing here derives a
 * quantity, a size or a load from an image.
 */
import type {
  MediaInfo,
  Resource,
  Uuid,
} from '../../../shared/logistics/contracts.ts';
import {MEDIA_PER_RECORD} from '../../../shared/logistics/rules.ts';
import {
  queuedMedia,
  type OutboxEntry,
} from '../../../shared/logistics/outbox.ts';
import type {IconName} from '../ui/icons';

/** Main first, then oldest first (the server's order). */
export function sortMedia(list: readonly MediaInfo[]): MediaInfo[] {
  return [...list].sort(
    (a, b) =>
      Number(b.main) - Number(a.main) ||
      Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** The main photo of a resource, if it has any. */
export function mainMedia(r: Pick<Resource, 'media'>): MediaInfo | null {
  const list = r.media ?? [];
  return list.find(m => m.main) ?? list[0] ?? null;
}

/**
 * The resource with one stored photo added (or refreshed). A new main photo
 * takes the mark from the current one, as the server does.
 */
export function withMedia<R extends Pick<Resource, 'media'>>(
  r: R,
  info: MediaInfo,
): R {
  const rest = (r.media ?? []).filter(m => m.id !== info.id);
  const others = info.main ? rest.map(m => ({...m, main: false})) : rest;
  const next = [...others, info];
  if (!next.some(m => m.main)) next[0] = {...next[0], main: true};
  return {...r, media: sortMedia(next)};
}

/** The resource with `id` as its main photo. */
export function withMain<R extends Pick<Resource, 'media'>>(r: R, id: Uuid): R {
  const list = r.media ?? [];
  if (!list.some(m => m.id === id)) return r;
  return {
    ...r,
    media: sortMedia(list.map(m => ({...m, main: m.id === id}))),
  };
}

/**
 * The resource without photo `id`. Removing the main photo makes the oldest
 * remaining one main, as the server does.
 */
export function withoutMedia<R extends Pick<Resource, 'media'>>(
  r: R,
  id: Uuid,
): R {
  const list = r.media ?? [];
  const gone = list.find(m => m.id === id);
  if (!gone) return r;
  const rest = list.filter(m => m.id !== id);
  if (gone.main && rest.length) {
    const oldest = [...rest].sort(
      (a, b) =>
        Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )[0];
    return {
      ...r,
      media: sortMedia(rest.map(m => ({...m, main: m.id === oldest.id}))),
    };
  }
  return {...r, media: sortMedia(rest)};
}

// ---------------------------------------------------------------- waiting

/** A photo saved on this device that the server does not have yet. */
export interface QueuedPhoto {
  /** The outbox entry. */
  entryId: string;
  /** The photo's device id (its id once stored). */
  id: Uuid;
  ownerId: Uuid;
  /** `data:` URL of the resized image, for the preview. */
  src: string;
  width: number;
  height: number;
  /** Waiting or being sent; `refused` = the server did not accept it. */
  state: 'waiting' | 'refused';
  /** Why the server refused it (its own words). */
  error: string | null;
}

/** The waiting photos of one resource (or of all), oldest first. */
export function queuedPhotos(
  entries: readonly OutboxEntry[],
  ownerId?: Uuid,
): QueuedPhoto[] {
  return queuedMedia(entries, ownerId).map(e => {
    const input = e.input;
    const type =
      typeof input.contentType === 'string' ? input.contentType : 'image/jpeg';
    return {
      entryId: e.id,
      id: e.recordId,
      ownerId: String(input.ownerId ?? ''),
      src: `data:${type};base64,${String(input.data ?? '')}`,
      width: Number(input.width) || 0,
      height: Number(input.height) || 0,
      state:
        e.status === 'rejected' || e.status === 'conflict'
          ? 'refused'
          : 'waiting',
      // A photo has no field to mark: the field message says what is wrong.
      error:
        Object.values(e.error?.fields ?? {})[0] ?? e.error?.message ?? null,
    };
  });
}

/**
 * Room left for photos of a resource: stored ones plus those still waiting
 * here count against MEDIA_PER_RECORD.
 */
export function photoRoom(storedCount: number, waitingCount: number): number {
  return Math.max(0, MEDIA_PER_RECORD - storedCount - waitingCount);
}

// ---------------------------------------------------------------- no photo

/**
 * The icon of a built-in category, for a resource without a photo. Custom
 * categories and resources without one show the generic material icon.
 */
const CATEGORY_ICON: Record<string, IconName> = {
  Carpas: 'tent',
  Vallas: 'fence',
  Mesas: 'table',
  'Sillas y bancos': 'chair',
  'Escenarios y tarimas': 'stage',
  Vehículos: 'transport',
  'Generadores y electricidad': 'bolt',
  'Sonido e iluminación': 'speaker',
  Señalización: 'sign',
  'Otros materiales': 'inventory',
};

export function categoryIcon(
  categoryName: string | null | undefined,
): IconName {
  return (categoryName && CATEGORY_ICON[categoryName]) || 'inventory';
}
