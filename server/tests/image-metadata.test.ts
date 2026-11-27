/**
 * Safety audit: uploaded photos lose their metadata (EXIF with GPS, XMP,
 * IPTC, PNG text chunks, WebP EXIF/XMP and trailers after the end marker)
 * and keep everything else byte for byte. Synthetic images with fictitious
 * metadata only.
 */
import {beforeAll, describe, expect, it} from 'vitest';
import {readImageHeader, stripImageMetadata} from '../src/media/image.ts';
import {createHarness, json} from './helpers.ts';
import type {Harness} from './helpers.ts';
import type {MediaInfo, Resource} from '../../shared/logistics/contracts.ts';

const enc = (s: string) => [...new TextEncoder().encode(s)];
const u16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const u32 = (n: number) => [
  (n >>> 24) & 0xff,
  (n >> 16) & 0xff,
  (n >> 8) & 0xff,
  n & 0xff,
];
const u32le = (n: number) => [...u32(n)].reverse();
const u24le = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff];
const text = (b: Uint8Array) => Buffer.from(b).toString('latin1');

/** One JPEG segment: marker and payload with its length. */
const segment = (marker: number, payload: number[]) => [
  0xff,
  marker,
  ...u16(payload.length + 2),
  ...payload,
];

const JFIF = segment(0xe0, [...enc('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const SOF0 = (w: number, h: number) =>
  segment(0xc0, [8, ...u16(h), ...u16(w), 1, 1, 0x11, 0]);
const SOS = segment(0xda, [1, 1, 0, 0, 0x3f, 0]);
/** Entropy-coded data with a stuffed 0xFF00 and a restart marker. */
const SCAN = [0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56];

function jpegWithExif(w: number, h: number): Uint8Array {
  return new Uint8Array([
    0xff,
    0xd8,
    ...JFIF,
    ...segment(0xe1, [...enc('Exif\0\0'), ...enc('GPS 28.4853N 16.3159W')]),
    ...segment(0xe1, [...enc('http://ns.adobe.com/xap/1.0/\0<x:Autor>')]),
    ...segment(0xed, [...enc('Photoshop 3.0\0IPTC Autor Prueba')]),
    ...segment(0xfe, enc('Camara Prueba')),
    ...SOF0(w, h),
    ...SOS,
    ...SCAN,
    0xff,
    0xd9,
    ...enc('TRAILER GPS'),
  ]);
}

function jpegClean(w: number, h: number): Uint8Array {
  return new Uint8Array([
    0xff,
    0xd8,
    ...JFIF,
    ...SOF0(w, h),
    ...SOS,
    ...SCAN,
    0xff,
    0xd9,
  ]);
}

const chunk = (type: string, data: number[]) => [
  ...u32(data.length),
  ...enc(type),
  ...data,
  0,
  0,
  0,
  0,
];
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IHDR = (w: number, h: number) =>
  chunk('IHDR', [...u32(w), ...u32(h), 8, 2, 0, 0, 0]);

function pngWithText(w: number, h: number): Uint8Array {
  return new Uint8Array([
    ...PNG_SIG,
    ...IHDR(w, h),
    ...chunk('tEXt', enc('Author\0Persona Prueba')),
    ...chunk('eXIf', enc('MM\0*GPS')),
    ...chunk('iTXt', enc('XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta/>')),
    ...chunk('zTXt', enc('Comment\0\0xx')),
    ...chunk('tIME', [7, 234, 12, 2, 9, 0, 0]),
    ...chunk('IDAT', [1, 2, 3, 4]),
    ...chunk('IEND', []),
    ...enc('TRAILER'),
  ]);
}

const riffChunk = (fourcc: string, data: number[]) => [
  ...enc(fourcc),
  ...u32le(data.length),
  ...data,
  ...(data.length % 2 ? [0] : []),
];

function webpWithExif(w: number, h: number): Uint8Array {
  const body = [
    ...enc('WEBP'),
    // VP8X: flags EXIF (0x08) | XMP (0x04) | alpha (0x10).
    ...riffChunk('VP8X', [0x1c, 0, 0, 0, ...u24le(w - 1), ...u24le(h - 1)]),
    ...riffChunk('VP8L', [0x2f, 1, 2, 3, 4]),
    ...riffChunk('EXIF', enc('MM\0*GPS 28.48N')),
    ...riffChunk('XMP ', enc('<x:xmpmeta>Autor</x:xmpmeta>')),
  ];
  return new Uint8Array([...enc('RIFF'), ...u32le(body.length), ...body]);
}

describe('stripping image metadata', () => {
  it('JPEG: drops APP1 (EXIF, XMP), APP13, comments and trailers; keeps the rest byte for byte', () => {
    const input = jpegWithExif(800, 600);
    const header = readImageHeader(input)!;
    const out = stripImageMetadata(input, header)!;
    expect(out).toEqual(jpegClean(800, 600));
    for (const leaked of [
      'Exif',
      'GPS',
      'xap',
      'Photoshop',
      'Autor',
      'Camara',
    ]) {
      expect(text(out)).not.toContain(leaked);
    }
    expect(readImageHeader(out)).toEqual(header);
    // Nothing to drop: unchanged.
    const clean = jpegClean(800, 600);
    expect(stripImageMetadata(clean, readImageHeader(clean)!)).toEqual(clean);
  });

  it('PNG: drops eXIf, tEXt, iTXt, zTXt, tIME and bytes after IEND', () => {
    const input = pngWithText(1600, 1200);
    const header = readImageHeader(input)!;
    const out = stripImageMetadata(input, header)!;
    expect(out).toEqual(
      new Uint8Array([
        ...PNG_SIG,
        ...IHDR(1600, 1200),
        ...chunk('IDAT', [1, 2, 3, 4]),
        ...chunk('IEND', []),
      ]),
    );
    expect(text(out)).not.toMatch(/Persona|GPS|xmp|Comment|TRAILER/);
  });

  it('WebP: drops EXIF and XMP, clears their VP8X flags and fixes the RIFF size', () => {
    const input = webpWithExif(1200, 1600);
    const header = readImageHeader(input)!;
    const out = stripImageMetadata(input, header)!;
    expect(text(out)).not.toMatch(/EXIF|XMP|GPS|Autor/);
    expect(out[20]).toBe(0x10); // alpha kept, EXIF/XMP flags cleared
    expect(new DataView(out.buffer).getUint32(4, true)).toBe(out.length - 8);
    expect(readImageHeader(out)).toEqual(header);
    expect(text(out)).toContain('VP8L');
  });

  it('an image whose structure breaks before its frame is not stored', () => {
    // SOF behind a segment that claims to run past the end of the file.
    const broken = new Uint8Array([
      0xff,
      0xd8,
      0xff,
      0xe1,
      0x10,
      0x00,
      ...enc('Exif'),
      ...SOF0(10, 10),
    ]);
    // The header reader skips by the declared length and finds no frame.
    expect(readImageHeader(broken)).toBeNull();
    const ok = jpegClean(10, 10);
    const lying = {contentType: 'image/jpeg' as const, width: 10, height: 10};
    // A structure that ends before the frame cannot be the same image.
    expect(
      stripImageMetadata(
        new Uint8Array([...ok.subarray(0, 2), 0x00, 0x00, ...ok.subarray(2)]),
        lying,
      ),
    ).toBeNull();
  });
});

describe('uploading a photo with EXIF', () => {
  let h: Harness;
  let elvis: string;
  let resource: Resource;

  beforeAll(async () => {
    h = await createHarness();
    elvis = (await h.login('Elvis')).token;
    const res = await h.request('POST', '/resources', {
      token: elvis,
      body: {organizationId: h.org.id, name: 'Carpa Prueba Foto'},
    });
    resource = await json<Resource>(res);
  });

  it('stores and serves the photo without its metadata, with the stripped size', async () => {
    const input = jpegWithExif(800, 600);
    const res = await h.request('POST', '/media', {
      token: elvis,
      body: {
        organizationId: h.org.id,
        ownerType: 'resource',
        ownerId: resource.id,
        contentType: 'image/jpeg',
        width: 800,
        height: 600,
        data: Buffer.from(input).toString('base64'),
      },
    });
    expect(res.status).toBe(201);
    const info = await json<MediaInfo>(res);
    const clean = jpegClean(800, 600);
    expect(info.bytes).toBe(clean.length);
    const served = await h.request('GET', `/media/${info.id}`, {token: elvis});
    const bytes = new Uint8Array(await served.arrayBuffer());
    expect(bytes).toEqual(clean);
    expect(text(bytes)).not.toContain('GPS');
    const [row] = await h.db.query<{n: number}>(
      `SELECT count(*)::int AS n FROM media
        WHERE position('GPS'::bytea IN data) > 0`,
    );
    expect(row?.n).toBe(0);
  });
});
