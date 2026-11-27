/**
 * Saved PDFs get a name that says what they are (Revisión 1, note 21).
 *
 * Browsers name a PDF after `document.title`. While a printable document is
 * on screen (the day close, a work order) it registers here; when the page
 * prints (its button or Ctrl+P), the document registered last, i.e. the one
 * whose print root wins in the print stylesheet, gives the title
 * (`printFileName`, at that moment) and the stamp of the page footer. The
 * previous title comes back on `afterprint`; as fallbacks, when the
 * document leaves the screen or after `RESTORE_AFTER_MS` (some mobile
 * browsers never send `afterprint`).
 */
import {useEffect, useRef} from 'react';
import {printFooterLead} from '../../../shared/logistics/print-name.ts';

export interface PrintJob {
  /** File name for this print, computed at the moment of printing. */
  fileName: () => string;
  /** «2 dic 2026, 18:30» for the footer line «Generado por OxEye · …». */
  stamp: () => string;
}

/** CSS custom property read by the `@page` footers (orders.css, closing.css). */
export const PRINT_FOOT_PROPERTY = '--lx-print-foot';

const RESTORE_AFTER_MS = 60_000;

type JobRef = {current: PrintJob};

const jobs: JobRef[] = [];
let printing: {
  job: JobRef;
  previous: string;
  title: string;
  timer: number;
} | null = null;

/** A CSS string token for `content`. */
function cssString(text: string): string {
  return `"${text.replace(/[\\"]/g, '\\$&').replace(/[\r\n]+/g, ' ')}"`;
}

function begin(): void {
  if (printing) return;
  const entry = jobs[jobs.length - 1];
  if (!entry) return;
  const job = entry.current;
  const title = job.fileName();
  printing = {
    job: entry,
    previous: document.title,
    title,
    timer: window.setTimeout(finish, RESTORE_AFTER_MS),
  };
  document.title = title;
  document.documentElement.style.setProperty(
    PRINT_FOOT_PROPERTY,
    cssString(printFooterLead(job.stamp())),
  );
}

function finish(): void {
  if (!printing) return;
  window.clearTimeout(printing.timer);
  // Someone else may have renamed the page meanwhile: leave theirs alone.
  if (document.title === printing.title) document.title = printing.previous;
  document.documentElement.style.removeProperty(PRINT_FOOT_PROPERTY);
  printing = null;
}

/**
 * Prints now with this document's name. Also used by the buttons, because
 * some browsers do not send `beforeprint` for `window.print()`.
 */
export function printWithName(): void {
  begin();
  window.print();
}

/** Registers a printable document for as long as the component is mounted. */
export function usePrintTitle(job: PrintJob): void {
  const ref = useRef(job);
  useEffect(() => {
    ref.current = job;
  });
  useEffect(() => {
    const entry = ref;
    if (jobs.length === 0) {
      window.addEventListener('beforeprint', begin);
      window.addEventListener('afterprint', finish);
    }
    jobs.push(entry);
    return () => {
      const i = jobs.indexOf(entry);
      if (i >= 0) jobs.splice(i, 1);
      if (printing?.job === entry) finish();
      if (jobs.length === 0) {
        window.removeEventListener('beforeprint', begin);
        window.removeEventListener('afterprint', finish);
        finish();
      }
    };
  }, []);
}
