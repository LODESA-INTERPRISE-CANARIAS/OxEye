/**
 * Acronyms for organizations, venues and warehouses (Revisión 1).
 *
 * A collapsed calendar column shows «A.M.» for «Almacén Municipal»; a saved
 * PDF starts with «SCLL» for «Ayuntamiento de San Cristóbal de La Laguna».
 * The proposal is only a starting point: a stored acronym always wins.
 */

/** Longest acronym accepted (letters, digits and dots). */
export const ACRONYM_MAX = 12;

/** Lower-case words that never give a letter («de», «la» written in lower case…). */
const LINKING_WORDS = new Set([
  'a',
  'al',
  'con',
  'de',
  'del',
  'e',
  'el',
  'en',
  'la',
  'las',
  'los',
  'o',
  'para',
  'por',
  'u',
  'y',
]);

/**
 * Words naming the kind of body rather than the body itself. Dropped only at
 * the start of an organization name, and only when something is left.
 */
const BODY_WORDS = new Set([
  'ayuntamiento',
  'ayto',
  'cabildo',
  'gobierno',
  'concejalía',
  'concejalia',
  'consejería',
  'consejeria',
  'excmo',
  'excmo.',
  'ilustre',
]);

/** First letter of a word, upper case, ignoring leading punctuation. */
function initial(word: string): string {
  const m = word.match(/[\p{L}\p{N}]/u);
  return m ? m[0].toLocaleUpperCase('es') : '';
}

function words(name: string): string[] {
  return name
    .normalize('NFC')
    .split(/[\s\-–—/·,()]+/u)
    .map(w => w.trim())
    .filter(Boolean);
}

/**
 * Proposes an acronym from a name.
 * - Organizations (`dotted: false`): «Ayuntamiento de San Cristóbal de La
 *   Laguna» → «SCLL». Body words at the start are dropped; capitalised
 *   articles inside a proper name («La Laguna») count.
 * - Places (`dotted: true`): «Almacén Municipal» → «A.M.», «Plaza del
 *   Adelantado» → «P.A.».
 * A single word gives its first three letters («Recinto» → «REC» / «Rec.»).
 * Returns null for an empty name.
 */
export function proposeAcronym(
  name: string,
  {dotted = false}: {dotted?: boolean} = {},
): string | null {
  let ws = words(name);
  if (!ws.length) return null;
  if (!dotted) {
    let i = 0;
    while (i < ws.length - 1 && BODY_WORDS.has(ws[i].toLocaleLowerCase('es'))) {
      i++;
    }
    ws = ws.slice(i);
  }
  const meaningful = ws.filter(
    (w, i) =>
      // A lower-case linking word never counts; a capitalised one counts
      // unless it opens the name («La Laguna» counts, «la plaza» does not).
      !(LINKING_WORDS.has(w) && w === w.toLocaleLowerCase('es')) ||
      (i === 0 && ws.length === 1),
  );
  const parts = meaningful.length ? meaningful : ws;
  if (parts.length === 1) {
    const letters = [...parts[0]].filter(c => /[\p{L}\p{N}]/u.test(c));
    const head = letters.slice(0, 3).join('');
    if (!head) return null;
    return dotted
      ? `${head[0].toLocaleUpperCase('es')}${head.slice(1).toLocaleLowerCase('es')}.`
      : head.toLocaleUpperCase('es');
  }
  const letters = parts.map(initial).filter(Boolean).slice(0, ACRONYM_MAX);
  if (!letters.length) return null;
  if (!dotted) return letters.join('');
  return letters
    .slice(0, Math.floor(ACRONYM_MAX / 2))
    .map(l => `${l}.`)
    .join('');
}

/** The acronym to show: the stored one when set, otherwise a proposal. */
export function acronymFor(
  record: {name: string; acronym?: string | null},
  opts: {dotted?: boolean} = {},
): string {
  const stored = record.acronym?.trim();
  if (stored) return stored;
  return proposeAcronym(record.name, opts) ?? '';
}

/** Validation shared by the server and the forms: null when valid. */
export function acronymProblem(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (v.length > ACRONYM_MAX) {
    return `Como mucho ${ACRONYM_MAX} caracteres.`;
  }
  if (!/^[\p{L}\p{N}.]+$/u.test(v)) {
    return 'Solo letras, números y puntos, sin espacios.';
  }
  return null;
}
