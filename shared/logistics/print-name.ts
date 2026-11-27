/**
 * Names for the PDFs the Gestor prints (Revisión 1, note 21).
 *
 * Browsers name a saved PDF after `document.title`, so while a document
 * prints its title becomes `SIGLAS_Tipo-de-documento[_Asunto]_YYYY-MM-DD_HH-mm`
 * in the organization's local time at the moment of printing, e.g.
 * `SCLL_Cierre-de-jornada_2026-12-02_18-30` or
 * `SCLL_Ficha-de-trabajo_Nova-Staff-Demo_2026-12-02_18-30`.
 *
 * Every part is reduced to plain ASCII letters, digits and hyphens: no
 * accents, spaces or characters Windows refuses in a file name
 * (`< > : " / \ | ? *`), and never a trailing dot or space.
 */
import {acronymFor} from './acronym.ts';
import {DEFAULT_TIMEZONE, utcToLocal} from './time.ts';

/** Document types as they read in a file name. */
export const PRINT_DOCUMENT = {
  dayClose: 'Cierre de jornada',
  workOrder: 'Ficha de trabajo',
} as const;

export type PrintDocument = keyof typeof PRINT_DOCUMENT;

/** Longest subject slug kept (company names can be long). */
export const PRINT_SUBJECT_MAX = 48;

/**
 * «Nova Staff · Demo» → «Nova-Staff-Demo», «Peñas Ñáñez» → «Penas-Nanez».
 * Empty when nothing usable is left.
 */
export function fileSlug(text: string, max = PRINT_SUBJECT_MAX): string {
  const ascii = text
    .normalize('NFKD')
    // Combining marks left by NFKD (accents, tildes, cedillas).
    .replace(/\p{M}/gu, '')
    .replace(/ß/g, 'ss')
    .replace(/[æÆ]/g, 'ae')
    .replace(/[øØ]/g, 'o');
  const slug = ascii.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (slug.length <= max) return slug;
  return slug.slice(0, max).replace(/-+$/g, '');
}

export interface PrintNameInput {
  /** The organization (its stored acronym wins over the proposal). */
  organization: {name: string; acronym?: string | null} | null;
  document: PrintDocument;
  /** Optional subject after the type: the recipient of a work order. */
  subject?: string | null;
  /** Moment of printing (epoch ms). */
  at: number;
  timeZone?: string;
}

/**
 * The title to give the page while it prints, which becomes the PDF's file
 * name. Without an acronym (no organization) the name starts with the type.
 */
export function printFileName(input: PrintNameInput): string {
  const tz = input.timeZone || DEFAULT_TIMEZONE;
  const local = utcToLocal(new Date(input.at).toISOString(), tz);
  const acronym = input.organization
    ? // «S.C.L.L.» reads as «SCLL» in a file name.
      fileSlug(acronymFor(input.organization).replace(/\./g, ''), 16)
    : '';
  const subject = input.subject ? fileSlug(input.subject) : '';
  return [
    acronym,
    fileSlug(PRINT_DOCUMENT[input.document]),
    subject,
    local.date,
    local.time.replace(':', '-'),
  ]
    .filter(Boolean)
    .join('_');
}

/**
 * The line in the printed page's margin, before the page number:
 * «Generado por Ox Eye · 2 dic 2026, 18:30». The page number and «Ox Eye
 * ayuda a decidir; no certifica.» follow in the print stylesheet.
 */
export function printFooterLead(stamp: string | null): string {
  return stamp ? `Generado por Ox Eye · ${stamp}` : 'Generado por Ox Eye';
}
