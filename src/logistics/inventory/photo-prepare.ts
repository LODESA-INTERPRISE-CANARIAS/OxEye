/**
 * Prepares a material photo on the device before it is sent (Revisión 1 ·
 * E3): upright (EXIF orientation applied), at most PHOTO_LONG_SIDE pixels on
 * the long side, re-encoded as JPEG under PHOTO_TARGET_BYTES. A phone photo
 * of 4–8 MB becomes ~200–400 KB, so it uploads on a weak signal and can wait
 * in the outbox without filling the device.
 *
 * Re-encoding also drops the original file's metadata (GPS position, camera
 * model): only the pixels leave the device.
 */
import {MEDIA_MAX_BYTES} from '../../../shared/logistics/rules.ts';

/** Long side of a prepared photo, in pixels. */
export const PHOTO_LONG_SIDE = 1600;
/** Size a prepared photo aims under (the server accepts up to MEDIA_MAX_BYTES). */
export const PHOTO_TARGET_BYTES = Math.min(400 * 1024, MEDIA_MAX_BYTES);
/** Larger originals are refused before decoding (they would stall a phone). */
export const PHOTO_SOURCE_MAX_BYTES = 40 * 1024 * 1024;

const QUALITIES = [0.82, 0.72, 0.62, 0.52] as const;
const SHRINK_PASSES = 4;

export const PHOTO_UNREADABLE =
  'No podemos leer este archivo como foto. Prueba con una foto JPEG, PNG o WebP.';
export const PHOTO_SOURCE_TOO_BIG =
  'Este archivo es demasiado grande para prepararlo aquí (más de 40 MB). Elige una foto más ligera.';
export const PHOTO_NOT_SMALL_ENOUGH =
  'No hemos podido reducir esta foto lo suficiente. Prueba con otra.';

export class PhotoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PhotoError';
  }
}

export interface PreparedPhoto {
  contentType: 'image/jpeg';
  width: number;
  height: number;
  /** Base64 of the JPEG bytes, without the `data:` prefix. */
  data: string;
  bytes: number;
}

/**
 * The size that fits `width × height` inside `max` on the long side, keeping
 * the proportions (never enlarged; at least 1 px each way).
 */
export function fitWithin(
  width: number,
  height: number,
  max: number,
): {width: number; height: number} {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const scale = Math.min(1, max / Math.max(w, h));
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

/** The long sides tried in turn: PHOTO_LONG_SIDE, then 75 % each pass. */
export function longSides(passes = SHRINK_PASSES): number[] {
  const out: number[] = [];
  let side = PHOTO_LONG_SIDE;
  for (let i = 0; i < passes; i++) {
    out.push(side);
    side = Math.round(side * 0.75);
  }
  return out;
}

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

async function decode(file: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: 'from-image',
      });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      // Older engines reject the options or the format: try an <img>.
    }
  }
  // Browsers apply the EXIF orientation to images by default.
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    if (!img.naturalWidth || !img.naturalHeight) throw new Error('empty');
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch {
    URL.revokeObjectURL(url);
    throw new PhotoError(PHOTO_UNREADABLE);
  }
}

function toBlob(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Blob | null> {
  return new Promise(resolve =>
    canvas.toBlob(b => resolve(b), 'image/jpeg', quality),
  );
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result ?? '');
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.onerror = () => reject(new PhotoError(PHOTO_UNREADABLE));
    reader.readAsDataURL(blob);
  });
}

/** Resizes and re-encodes one picked or captured photo. */
export async function preparePhoto(file: Blob): Promise<PreparedPhoto> {
  if (file.type && !file.type.startsWith('image/')) {
    throw new PhotoError(PHOTO_UNREADABLE);
  }
  if (file.size > PHOTO_SOURCE_MAX_BYTES) {
    throw new PhotoError(PHOTO_SOURCE_TOO_BIG);
  }
  const decoded = await decode(file);
  try {
    for (const side of longSides()) {
      const size = fitWithin(decoded.width, decoded.height, side);
      const canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new PhotoError(PHOTO_UNREADABLE);
      // JPEG has no transparency: a transparent PNG gets a plain white
      // background instead of black (image pixels, not interface colour).
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size.width, size.height);
      ctx.drawImage(decoded.source, 0, 0, size.width, size.height);
      for (const quality of QUALITIES) {
        const blob = await toBlob(canvas, quality);
        if (!blob) throw new PhotoError(PHOTO_UNREADABLE);
        if (blob.size <= PHOTO_TARGET_BYTES) {
          return {
            contentType: 'image/jpeg',
            width: size.width,
            height: size.height,
            data: await toBase64(blob),
            bytes: blob.size,
          };
        }
      }
    }
  } finally {
    decoded.release();
  }
  throw new PhotoError(PHOTO_NOT_SMALL_ENOUGH);
}
