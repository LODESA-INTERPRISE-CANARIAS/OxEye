/**
 * Browser history for the Gestor (Revisión 1, note 29): the browser's Back
 * and Forward and the phone's back gesture move between spaces, days and
 * open sheets.
 *
 * - Changing space or day pushes an entry (quick successive day changes,
 *   e.g. typing a date, are folded into one).
 * - Every open sheet is one entry on top of its space (`ui/Sheet.tsx` lists
 *   them). The entry's address names the record sheet on top, if any
 *   (`route.ts`); opening another record in place of the one on top (a
 *   person from a task) is a new entry, so Back returns to the first one;
 *   switching a card to its form, or a sheet the user does not see change,
 *   only rewrites the address.
 * - Back closes the top sheet first, exactly as Escape does: a form with
 *   unsaved changes asks «¿Descartarlos?» and the history position is put
 *   back, so nothing is lost silently. Closing a sheet with its own button
 *   steps the history back, so Back never reopens what was just closed;
 *   Forward does reopen it.
 * - Leaving the Gestor first rewinds to the Gestor's first entry, so the
 *   hub (`GameMenu.tsx`) finds the history as it left it.
 *
 * Entries carry `{lx: 1, depth, index}`: `depth` = sheets open over the
 * base, `index` = position since the Gestor's first entry.
 */
import {flushSync} from 'react-dom';
import {onSheetsChange, openSheetsNow, type OpenSheet} from '../ui/Sheet';
import {
  parseRoute,
  ROOT_HASH,
  sameAddress,
  stripSheet,
  withSheet,
  type Route,
  type SheetAddress,
} from './route';

interface Entry {
  lx: 1;
  depth: number;
  index: number;
}

function entryOf(state: unknown): Entry | null {
  const s = state as Partial<Entry> | null;
  return s &&
    s.lx === 1 &&
    typeof s.depth === 'number' &&
    typeof s.index === 'number'
    ? (s as Entry)
    : null;
}

/** Result of opening a sheet from its address. */
export type OpenResult = 'opened' | 'pending' | 'missing';

export interface HistoryNavHost {
  /** Address of the record sheet on top, as the app opened it. */
  address: () => SheetAddress | null;
  /** Shows the base of an entry reached with Back / Forward or a link. */
  showRoute: (route: Route) => void;
  /** Opens a record sheet from its address. */
  openAddress: (address: SheetAddress) => OpenResult;
  /** The address could not be opened (deleted, not visible, wrong link). */
  onMissing: () => void;
}

/** Day changes closer than this fold into one entry. */
const FOLD_MS = 800;
/** A traversal we started that the browser never reported. */
const TRAVERSAL_TIMEOUT_MS = 1500;

export class HistoryNav {
  private host: HistoryNavHost;
  private base: string;
  private index = 0;
  private pendingBase: {hash: string; push: boolean} | null = null;
  private pendingLink: SheetAddress | null = null;
  /** Relabel the entry after a Back / Forward instead of pushing or popping. */
  private adopt = false;
  private traversal: {
    done?: () => void;
    timer: number;
    /** Its `popstate` arrived. */
    landed?: boolean;
  } | null = null;
  private scheduled = false;
  private stopped = false;
  private lastFold: {at: number; space: string} | null = null;
  private lastKey = '';
  private unsubscribe: () => void = () => undefined;

  constructor(host: HistoryNavHost) {
    this.host = host;
    this.base = stripSheet(window.location.hash) || ROOT_HASH;
  }

  setHost(host: HistoryNavHost): void {
    this.host = host;
  }

  /** Starts listening; returns the route the Gestor opens on. */
  start(): Route {
    this.stopped = false;
    const route = parseRoute(window.location.hash);
    const entry = entryOf(window.history.state);
    this.index = entry?.index ?? 0;
    this.base = stripSheet(window.location.hash);
    if (!this.base.startsWith(ROOT_HASH)) this.base = ROOT_HASH;
    if (route.sheet) {
      // A shared link or a reload on a sheet: open it once it can be.
      this.pendingLink = route.sheet;
      if (!entry || entry.depth === 0) {
        // A fresh link: Back from the sheet stays on its space.
        this.write('replace', 0, this.base);
      }
    } else {
      this.write('replace', 0, this.base);
    }
    window.addEventListener('popstate', this.onLocation);
    window.addEventListener('hashchange', this.onLocation);
    this.unsubscribe = onSheetsChange(this.schedule);
    return route;
  }

  stop(): void {
    this.stopped = true;
    window.removeEventListener('popstate', this.onLocation);
    window.removeEventListener('hashchange', this.onLocation);
    this.unsubscribe();
    if (this.traversal) window.clearTimeout(this.traversal.timer);
    this.traversal = null;
  }

  /**
   * The app moved to another space or day. `fold` folds quick successive
   * changes of the same kind into one entry.
   */
  go(hash: string, {push = true, fold = false} = {}): void {
    if (hash === this.base && !this.pendingBase) return;
    let doPush = push;
    if (push && fold) {
      // Monotonic: a wall clock may jump (or be fixed in tests).
      const now = performance.now();
      const space = hash.split('/').slice(0, 2).join('/');
      if (
        this.lastFold &&
        this.lastFold.space === space &&
        now - this.lastFold.at < FOLD_MS
      ) {
        doPush = false;
      }
      this.lastFold = {at: now, space};
    } else if (push) {
      this.lastFold = null;
    }
    this.base = hash;
    this.pendingBase = {
      hash,
      push: doPush || !!this.pendingBase?.push,
    };
    this.schedule();
  }

  /**
   * One step back inside the Gestor, as the browser's Back would. False
   * when the Gestor has no earlier entry (opened from a link).
   */
  back(): boolean {
    if (this.index <= 0 || this.traversal) return false;
    window.history.back();
    return true;
  }

  /** Tries the pending link again (records loaded, signed in). */
  resolveLink(): void {
    const link = this.pendingLink;
    if (!link || this.stopped) return;
    const result = this.host.openAddress(link);
    if (result === 'pending') return;
    this.pendingLink = null;
    if (result === 'missing') {
      this.host.onMissing();
      this.adopt = true;
    }
    this.schedule();
  }

  /**
   * Leaves the Gestor: back to its first entry, then `onClose` (the hub
   * pops or clears that one itself).
   */
  exit(onClose: () => void): void {
    if (this.index <= 0 || !window.location.hash.startsWith(ROOT_HASH)) {
      this.stop();
      onClose();
      return;
    }
    const steps = this.index;
    this.index = 0;
    this.traverse(-steps, () => {
      this.stop();
      onClose();
    });
  }

  // ------------------------------------------------------------ internals

  private url(hash: string): string {
    return `${window.location.pathname}${window.location.search}${hash}`;
  }

  private key(): string {
    const e = entryOf(window.history.state);
    return `${window.location.hash}|${e?.index ?? '-'}|${e?.depth ?? '-'}`;
  }

  private write(mode: 'push' | 'replace', depth: number, hash: string): void {
    if (mode === 'push') this.index += 1;
    const state: Entry = {lx: 1, depth, index: this.index};
    if (mode === 'push') window.history.pushState(state, '', this.url(hash));
    else window.history.replaceState(state, '', this.url(hash));
    this.lastKey = this.key();
  }

  private traverse(delta: number, done?: () => void): void {
    const timer = window.setTimeout(
      () => this.endTraversal(),
      TRAVERSAL_TIMEOUT_MS,
    );
    this.traversal = {done, timer};
    window.history.go(delta);
  }

  /**
   * Our own `history.go` arrived. It is finished after its `hashchange` (or
   * shortly after `popstate` when the address did not change), so the hub's
   * own `hashchange` listener has seen it before `done` runs.
   */
  private endTraversal(): void {
    const t = this.traversal;
    if (!t) return;
    this.traversal = null;
    window.clearTimeout(t.timer);
    this.lastKey = this.key();
    window.setTimeout(() => {
      if (t.done) t.done();
      else this.schedule();
    }, 0);
  }

  private schedule = (): void => {
    if (this.scheduled || this.stopped) return;
    this.scheduled = true;
    window.setTimeout(() => {
      this.scheduled = false;
      this.reconcile();
    }, 0);
  };

  /** The address the current entry should have. */
  private target(sheets: number): string {
    return sheets > 0 ? withSheet(this.base, this.host.address()) : this.base;
  }

  /** Brings the history in line with what is open. */
  private reconcile(): void {
    if (this.stopped || this.traversal || this.pendingLink) return;
    if (!window.location.hash.startsWith(ROOT_HASH)) return;
    const entry = entryOf(window.history.state);
    const depth = entry?.depth ?? 0;
    const n = openSheetsNow().length;

    if (this.adopt) {
      this.adopt = false;
      this.pendingBase = null;
      if (depth !== n || window.location.hash !== this.target(n)) {
        this.write('replace', n, this.target(n));
      }
      return;
    }

    if (this.pendingBase) {
      // Sheets closed on the way (the account menu's «Cierre de jornada»):
      // drop their entries first, then add the new space on top.
      if (depth > n) {
        this.index -= depth - n;
        this.traverse(n - depth);
        return;
      }
      const {push} = this.pendingBase;
      this.pendingBase = null;
      this.write(push ? 'push' : 'replace', n, this.target(n));
      return;
    }

    if (n > depth) {
      for (let d = depth + 1; d <= n; d++) {
        this.write('push', d, this.target(n));
      }
    } else if (n < depth) {
      this.index -= depth - n;
      this.traverse(n - depth);
    } else {
      const wanted = this.target(n);
      if (window.location.hash === wanted) return;
      const shown = parseRoute(window.location.hash).sheet;
      const now = this.host.address();
      // Another record in place of the one on top: Back returns to it.
      const another = n > 0 && !!shown && !!now && !sameAddress(shown, now);
      this.write(another ? 'push' : 'replace', n, wanted);
    }
  }

  /**
   * Asks the sheets above `depth` to close, top first, as Escape would.
   * False when one stays open (unsaved changes, saving) or another sheet
   * comes up in its place (a card under a closed form).
   */
  private closeDownTo(depth: number): boolean {
    const before = new Set<OpenSheet>(openSheetsNow());
    for (;;) {
      const open = openSheetsNow();
      if (open.length <= depth) return true;
      const top = open[open.length - 1];
      if (!before.has(top)) return false;
      flushSync(() => top.requestClose());
      if (openSheetsNow().includes(top)) return false;
    }
  }

  /**
   * Puts back the entry the user tried to leave, after the one they landed
   * on (`landedIndex`), with what is still open.
   */
  private restore(landedIndex: number): void {
    const n = openSheetsNow().length;
    this.index = landedIndex;
    this.write('push', n, this.target(n));
  }

  private onLocation = (event: Event): void => {
    if (this.stopped) return;
    if (this.traversal) {
      const t = this.traversal;
      if (
        event.type === 'hashchange' &&
        t.landed &&
        !t.done &&
        !entryOf(window.history.state)
      ) {
        // Our step already landed (same address, so no `hashchange` of its
        // own) and a link was set meanwhile: the step is over, and the link
        // is handled like any other, below.
        window.clearTimeout(t.timer);
        this.traversal = null;
      } else {
        if (event.type === 'hashchange') {
          this.endTraversal();
        } else {
          // `popstate` comes first; wait a moment for a `hashchange`.
          if (entryOf(window.history.state)) t.landed = true;
          window.clearTimeout(t.timer);
          t.timer = window.setTimeout(() => this.endTraversal(), 80);
        }
        return;
      }
    }
    // Leaving for the hub: `GameMenu` closes the Gestor.
    if (!window.location.hash.startsWith(ROOT_HASH)) return;
    // Back / Forward fire `popstate` and then `hashchange`: handle once.
    const key = this.key();
    if (key === this.lastKey) return;
    this.lastKey = key;

    const route = parseRoute(window.location.hash);
    const entry = entryOf(window.history.state);
    const before = this.index;

    if (!entry) {
      // A link typed or pasted while the Gestor is open: a new entry.
      this.index = before + 1;
      if (!this.closeDownTo(0)) {
        this.write(
          'replace',
          openSheetsNow().length,
          this.target(openSheetsNow().length),
        );
        return;
      }
      this.base = stripSheet(window.location.hash);
      this.write('replace', 0, this.base);
      this.host.showRoute(route);
      if (route.sheet) {
        this.pendingLink = route.sheet;
        this.resolveLink();
      }
      return;
    }

    this.index = entry.index;
    if (!this.closeDownTo(entry.depth)) {
      this.restore(entry.index);
      return;
    }
    // Same depth, another record: back from a person to the task it came from.
    const top = openSheetsNow().length;
    if (
      route.sheet &&
      entry.depth > 0 &&
      top === entry.depth &&
      !sameAddress(this.host.address(), route.sheet)
    ) {
      if (!this.closeDownTo(entry.depth - 1)) {
        this.restore(entry.index);
        return;
      }
    }
    this.base = stripSheet(window.location.hash);
    this.pendingBase = null;
    this.host.showRoute(route);
    if (route.sheet && openSheetsNow().length < entry.depth) {
      // Forward (or Back) onto a sheet that is closed: open it again, now,
      // so the entry is relabelled with it open.
      this.pendingLink = route.sheet;
      flushSync(() => this.resolveLink());
    }
    this.adopt = true;
    this.schedule();
  };
}
