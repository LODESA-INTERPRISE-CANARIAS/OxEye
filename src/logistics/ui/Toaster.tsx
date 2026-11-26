/**
 * Live region for short confirmations and errors.
 *
 * A modal `<dialog>` sits in the browser's top layer and makes the rest of the
 * page inert, so toasts rendered outside it would be hidden behind it and not
 * announced. An open `Sheet` therefore offers itself as the host through
 * `ToastHostContext`, and the toasts are portalled into it. The outer live
 * region stays mounted (empty meanwhile) so announcements after the sheet
 * closes keep working.
 */
import React, {createContext} from 'react';
import {createPortal} from 'react-dom';
import {Icon} from './icons';

export interface ToastItem {
  id: number;
  message: string;
  tone: 'info' | 'success' | 'error';
  /** One action, e.g. «Deshacer»; running it closes the toast. */
  action?: {label: string; run: () => void};
}

/**
 * Sheets can stack (a task opened from an event): each open sheet adds its
 * slot and removes it on close, and the toasts go to the topmost one.
 */
export interface ToastHost {
  add: (slot: HTMLElement) => void;
  remove: (slot: HTMLElement) => void;
}

export const ToastHostContext = createContext<ToastHost | null>(null);

/** Hover and keyboard focus hold a toast independently. */
export type ToastHoldHandler = (
  id: number,
  reason: 'hover' | 'focus',
  held: boolean,
) => void;

const ToastList: React.FC<{
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
  onHold?: ToastHoldHandler;
}> = ({toasts, onDismiss, onHold}) =>
  toasts.map(t => (
    <div
      key={t.id}
      className={`lx-toast lx-toast--${t.tone}`}
      role={t.tone === 'error' ? 'alert' : 'status'}
      // Hover or keyboard focus keeps the toast (and its action) on screen.
      onMouseEnter={() => onHold?.(t.id, 'hover', true)}
      onMouseLeave={() => onHold?.(t.id, 'hover', false)}
      onFocus={() => onHold?.(t.id, 'focus', true)}
      onBlur={e => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          onHold?.(t.id, 'focus', false);
        }
      }}
    >
      <Icon
        name={
          t.tone === 'error' ? 'alert' : t.tone === 'success' ? 'check' : 'eye'
        }
        size={18}
      />
      <span className="lx-toast__text">{t.message}</span>
      {t.action && (
        <button
          type="button"
          className="lx-toast__action"
          onClick={() => {
            onDismiss(t.id);
            t.action!.run();
          }}
        >
          {t.action.label}
        </button>
      )}
      <button
        type="button"
        className="lx-toast__close"
        aria-label="Cerrar aviso"
        onClick={() => onDismiss(t.id)}
      >
        <Icon name="close" size={16} />
      </button>
    </div>
  ));

export const Toaster: React.FC<{
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
  onHold?: ToastHoldHandler;
  /** Element inside an open modal sheet that should show the toasts. */
  host?: HTMLElement | null;
}> = ({toasts, onDismiss, onHold, host}) => (
  <>
    <div className="lx-toaster" aria-live="polite" aria-atomic="false">
      {!host && (
        <ToastList toasts={toasts} onDismiss={onDismiss} onHold={onHold} />
      )}
    </div>
    {host &&
      createPortal(
        <div
          className="lx-toaster lx-toaster--in-sheet"
          aria-live="polite"
          aria-atomic="false"
        >
          <ToastList toasts={toasts} onDismiss={onDismiss} onHold={onHold} />
        </div>,
        host,
      )}
  </>
);
