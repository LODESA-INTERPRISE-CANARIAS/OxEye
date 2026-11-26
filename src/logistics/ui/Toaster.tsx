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

const ToastList: React.FC<{
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}> = ({toasts, onDismiss}) =>
  toasts.map(t => (
    <div
      key={t.id}
      className={`lx-toast lx-toast--${t.tone}`}
      role={t.tone === 'error' ? 'alert' : 'status'}
    >
      <Icon
        name={
          t.tone === 'error' ? 'alert' : t.tone === 'success' ? 'check' : 'eye'
        }
        size={18}
      />
      <span className="lx-toast__text">{t.message}</span>
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
  /** Element inside an open modal sheet that should show the toasts. */
  host?: HTMLElement | null;
}> = ({toasts, onDismiss, host}) => (
  <>
    <div className="lx-toaster" aria-live="polite" aria-atomic="false">
      {!host && <ToastList toasts={toasts} onDismiss={onDismiss} />}
    </div>
    {host &&
      createPortal(
        <div
          className="lx-toaster lx-toaster--in-sheet"
          aria-live="polite"
          aria-atomic="false"
        >
          <ToastList toasts={toasts} onDismiss={onDismiss} />
        </div>,
        host,
      )}
  </>
);
