/**
 * Reads the type and pixel size of an uploaded image from its own bytes
 * (Revisión 1 · E3), so the server stores only what it really is: a JPEG,
 * PNG or WebP of the declared size. Pure; no decoding beyond the header.
 */
import type {MediaInfo} from '../../../shared/logistics/contracts.ts';

export interface ImageHeader {
  contentType: MediaInfo['contentType'];
  width: number;
  height: number;
}

const u16be = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;
const u32be = (b: Uint8Array, i: number) =>
  ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!;
const ascii = (b: Uint8Array, i: number, n: number) =>
  String.fromCharCode(...b.subarray(i, i + n));

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function png(b: Uint8Array): ImageHeader | null {
  if (b.length < 24 || !PNG_SIGNATURE.every((v, i) => b[i] === v)) return null;
  if (ascii(b, 12, 4) !== 'IHDR') return null;
  return {contentType: 'image/png', width: u32be(b, 16), height: u32be(b, 20)};
}

/** Start-of-frame markers (baseline, progressive…), not DHT/JPG/DAC. */
function isSof(marker: number): boolean {
  return (
    marker >= 0xc0 &&
    marker <= 0xcf &&
    marker !== 0xc4 &&
    marker !== 0xc8 &&
    marker !== 0xcc
  );
}

function jpeg(b: Uint8Array): ImageHeader | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1]!;
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    // Markers without a length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // end / scan before a frame
    const length = u16be(b, i + 2);
    if (length < 2) return null;
    if (isSof(marker)) {
      if (i + 8 >= b.length) return null;
      return {
        contentType: 'image/jpeg',
        height: u16be(b, i + 5),
        width: u16be(b, i + 7),
      };
    }
    i += 2 + length;
  }
  return null;
}

function webp(b: Uint8Array): ImageHeader | null {
  if (b.length < 30 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP') {
    return null;
  }
  const chunk = ascii(b, 12, 4);
  if (chunk === 'VP8 ') {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return {
      contentType: 'image/webp',
      width: (b[26]! | (b[27]! << 8)) & 0x3fff,
      height: (b[28]! | (b[29]! << 8)) & 0x3fff,
    };
  }
  if (chunk === 'VP8L') {
    if (b[20] !== 0x2f) return null;
    const [b1, b2, b3, b4] = [b[21]!, b[22]!, b[23]!, b[24]!];
    return {
      contentType: 'image/webp',
      width: 1 + (((b2 & 0x3f) << 8) | b1),
      height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)),
    };
  }
  if (chunk === 'VP8X') {
    return {
      contentType: 'image/webp',
      width: 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)),
      height: 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16)),
    };
  }
  return null;
}

/** The image's real type and size, or null when it is none of the three. */
export function readImageHeader(bytes: Uint8Array): ImageHeader | null {
  return jpeg(bytes) ?? png(bytes) ?? webp(bytes);
}

// ---------------------------------------------------------------- metadata (safety audit)

/*
 * Photos from a phone carry metadata: the place they were taken (GPS), the
 * device, the time, sometimes the owner's name. None of it is needed to show
 * material, so the server never stores it: the metadata blocks below are
 * dropped on upload and everything else is copied byte for byte (no
 * re-encoding, no quality loss).
 *
 * The structure is walked to its end marker (JPEG EOI, PNG IEND, the RIFF
 * size of a WebP); bytes after it are dropped (trailers can hold metadata
 * too). A block that runs past the end of the file ends the walk there: only
 * what was understood is kept.
 */

/** APP1 (EXIF, XMP), APP13 (Photoshop / IPTC) and comments. */
const JPEG_DROP = new Set([0xe1, 0xed, 0xfe]);
/** EXIF, text chunks (author, comments, XMP in iTXt) and the edit time. */
const PNG_DROP = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME']);
const WEBP_DROP = new Set(['EXIF', 'XMP ']);
/** VP8X flags that announce the dropped chunks. */
const VP8X_EXIF = 0x08;
const VP8X_XMP = 0x04;

const u32le = (b: Uint8Array, i: number) =>
  (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0;

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function isRst(marker: number): boolean {
  return marker >= 0xd0 && marker <= 0xd7;
}

function stripJpeg(b: Uint8Array): Uint8Array {
  const out: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2;
  while (i + 1 < b.length) {
    if (b[i] !== 0xff) break;
    const marker = b[i + 1]!;
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    if (marker === 0xd9) {
      out.push(b.subarray(i, i + 2));
      break; // EOI: anything after it is dropped
    }
    if (marker === 0x01 || isRst(marker) || marker === 0xd8) {
      out.push(b.subarray(i, i + 2));
      i += 2;
      continue;
    }
    if (i + 3 >= b.length) break;
    const end = i + 2 + u16be(b, i + 2);
    if (end < i + 4 || end > b.length) break;
    if (!JPEG_DROP.has(marker)) out.push(b.subarray(i, end));
    i = end;
    if (marker === 0xda) {
      // Entropy-coded data, up to the next marker (0xFF00 is a stuffed byte,
      // 0xFFD0–D7 are restart markers inside the scan).
      let j = i;
      while (
        j + 1 < b.length &&
        !(b[j] === 0xff && b[j + 1] !== 0x00 && !isRst(b[j + 1]!))
      ) {
        j++;
      }
      if (j + 1 >= b.length) j = b.length;
      out.push(b.subarray(i, j));
      i = j;
    }
  }
  return concat(out);
}

function stripPng(b: Uint8Array): Uint8Array {
  const out: Uint8Array[] = [b.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= b.length) {
    const type = ascii(b, i + 4, 4);
    if (!/^[A-Za-z]{4}$/.test(type)) break;
    const end = i + 12 + u32be(b, i);
    if (end > b.length) break;
    if (!PNG_DROP.has(type)) out.push(b.subarray(i, end));
    i = end;
    if (type === 'IEND') break;
  }
  return concat(out);
}

function stripWebp(b: Uint8Array): Uint8Array {
  const size = u32le(b, 4);
  const limit = size >= 4 && 8 + size <= b.length ? 8 + size : b.length;
  const out: Uint8Array[] = [b.slice(0, 12)];
  let i = 12;
  while (i + 8 <= limit) {
    const fourcc = ascii(b, i, 4);
    if (!/^[\x20-\x7e]{4}$/.test(fourcc)) break;
    const length = u32le(b, i + 4);
    const end = i + 8 + length + (length % 2);
    if (i + 8 + length > limit) break;
    const chunk = b.slice(i, Math.min(end, limit));
    if (!WEBP_DROP.has(fourcc)) {
      if (fourcc === 'VP8X' && chunk.length > 8) {
        chunk[8] = chunk[8]! & ~(VP8X_EXIF | VP8X_XMP);
      }
      out.push(chunk);
    }
    i = end;
  }
  const result = concat(out);
  // RIFF size: everything after the first 8 bytes.
  new DataView(result.buffer).setUint32(4, result.length - 8, true);
  return result;
}

/**
 * The image without its metadata (EXIF, XMP, IPTC, text chunks), or null
 * when what is left can no longer be read as the same image. Pure.
 */
export function stripImageMetadata(
  bytes: Uint8Array,
  header: ImageHeader,
): Uint8Array | null {
  const stripped =
    header.contentType === 'image/jpeg'
      ? stripJpeg(bytes)
      : header.contentType === 'image/png'
        ? stripPng(bytes)
        : stripWebp(bytes);
  const again = readImageHeader(stripped);
  return again &&
    again.contentType === header.contentType &&
    again.width === header.width &&
    again.height === header.height
    ? stripped
    : null;
}
