/**
 * Deterministic identifiers for imported legacy content (INV-001 / INV-019):
 * importing the same file twice yields the same ids, so nothing is duplicated.
 * Not used for simulation; no scenario seed involved.
 */

/** 32-bit FNV-1a hash with a configurable offset basis. */
function fnv1a(text: string, basis: number): number {
  let h = basis >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 128-bit content hash rendered as 32 hex characters. */
export function contentHash(text: string): string {
  return [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b]
    .map((basis) => fnv1a(text, basis).toString(16).padStart(8, '0'))
    .join('');
}

/** UUID-shaped deterministic id derived from a namespace and a content hash. */
export function deterministicId(namespace: string, hash: string): string {
  const h = contentHash(namespace + ':' + hash);
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    '5' + h.slice(13, 16),
    '8' + h.slice(17, 20),
    h.slice(20, 32),
  ].join('-');
}
