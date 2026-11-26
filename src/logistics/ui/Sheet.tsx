/**
 * Modal sheet on the native `<dialog>`: focus trap, Escape and top layer for
 * free. Bottom sheet on phones, centred dialog from 900 px.
 *
 * React state stays the authority: Escape and backdrop only *request* a close
 * through `onClose`. If the browser closes the dialog on its own anyway (it
 * may force-close after repeated Escapes), the parent is asked again and the
 * dialog is shown again if the parent keeps it open, so it never gets stuck.
 * Focus returns to the control that opened the sheet, also when the parent
 * unmounts the sheet instead of closing it.
 */
import React, {
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {IconButton} from './Button';
import {ToastHostContext} from './Toaster';

export interface SheetProps {
  open: boolean;
  /** Called on Escape, backdrop tap or the close button. */
  onClose: () => void;
  title: React.ReactNode;
  eyebrow?: React.ReactNode;
  /** Extra header content (chips) next to the title. */
  meta?: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md';
  id?: string;
  /** Role for confirmation sheets that need an immediate answer. */
  role?: 'dialog' | 'alertdialog';
  children?: React.ReactNode;
}

function showDialog(dialog: HTMLDialogElement): void {
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

/** Returns true when a native `close` event will follow. */
function closeDialog(dialog: HTMLDialogElement): boolean {
  if (typeof dialog.close === 'function') {
    dialog.close();
    return true;
  }
  dialog.removeAttribute('open');
  return false;
}

function restoreFocus(target: HTMLElement | null): void {
  if (target && target.isConnected && target !== document.body) {
    target.focus({preventScroll: true});
  }
}

export const Sheet: React.FC<SheetProps> = ({
  open,
  onClose,
  title,
  eyebrow,
  meta,
  footer,
  size = 'md',
  id,
  role,
  children,
}) => {
  const ref = useRef<HTMLDialogElement>(null);
  const pressedOnBackdrop = useRef(false);
  const titleId = useId();
  const toastHost = useContext(ToastHostContext);
  const toastSlotRef = useRef<HTMLDivElement>(null);
  /** Control focused before the sheet opened. */
  const returnFocus = useRef<HTMLElement | null>(null);
  /** Control focused inside the sheet when Escape was pressed. */
  const focusInside = useRef<HTMLElement | null>(null);
  const openRef = useRef(open);
  const onCloseRef = useRef(onClose);
  /** Pending `close` events caused by our own `close()` calls. */
  const ownCloses = useRef(0);
  // Bumped after a native close the parent did not accept, to show it again.
  const [reshow, setReshow] = useState(0);

  useLayoutEffect(() => {
    openRef.current = open;
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      const reopening = reshow > 0 && returnFocus.current !== null;
      if (!reopening) {
        const active = document.activeElement;
        returnFocus.current = active instanceof HTMLElement ? active : null;
      }
      showDialog(dialog);
      // Children mark the control that should receive focus first.
      const inside = focusInside.current;
      if (reopening && inside?.isConnected && dialog.contains(inside)) {
        inside.focus();
      } else {
        dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
      }
    } else if (!open) {
      if (dialog.open && closeDialog(dialog)) ownCloses.current++;
      restoreFocus(returnFocus.current);
      returnFocus.current = null;
    }
  }, [open, reshow]);

  // Parents often unmount the sheet instead of passing `open={false}`; the
  // dialog then disappears without `close()`. Close it first (the rest of the
  // page is inert while it is modal) and hand focus back.
  useLayoutEffect(() => {
    const dialog = ref.current;
    const pending = ownCloses;
    const focusTarget = returnFocus;
    return () => {
      if (dialog?.open && closeDialog(dialog)) pending.current++;
      restoreFocus(focusTarget.current);
      focusTarget.current = null;
    };
  }, []);

  // While open, toasts render inside the dialog so they sit above it in the
  // top layer and are not hidden from assistive technology by the modal.
  useLayoutEffect(() => {
    const slot = toastSlotRef.current;
    if (!open || !slot || !toastHost) return;
    toastHost.setHost(slot);
    return () => toastHost.setHost(prev => (prev === slot ? null : prev));
  }, [open, toastHost]);

  return (
    <dialog
      ref={ref}
      id={id}
      role={role}
      className={`lx-sheet lx-sheet--${size}`}
      aria-labelledby={titleId}
      onCancel={e => {
        const active = document.activeElement;
        focusInside.current = active instanceof HTMLElement ? active : null;
        // Chromium makes repeated Escapes without user activation
        // non-cancelable; the dialog then closes natively and `onClose` below
        // asks the parent once. Asking here too would toggle twice.
        if (!e.cancelable) return;
        e.preventDefault();
        onClose();
      }}
      onClose={() => {
        // Our own close (open → false or unmount): nothing to sync.
        if (ownCloses.current > 0) {
          ownCloses.current--;
          return;
        }
        if (!openRef.current) return;
        // Closed natively while the parent still wants it open: ask again,
        // and show it again if the parent keeps it (unsaved changes, saving).
        onCloseRef.current();
        setReshow(n => n + 1);
      }}
      onPointerDown={e => {
        pressedOnBackdrop.current = e.target === ref.current;
      }}
      onClick={e => {
        if (pressedOnBackdrop.current && e.target === ref.current) onClose();
        pressedOnBackdrop.current = false;
      }}
    >
      {open && (
        <div className="lx-sheet__panel">
          <span className="lx-sheet__grabber" aria-hidden="true" />
          <header className="lx-sheet__head">
            <div className="lx-sheet__titles">
              {eyebrow && <p className="lx-eyebrow">{eyebrow}</p>}
              <h2 id={titleId} className="lx-sheet__title">
                {title}
              </h2>
              {meta && <div className="lx-sheet__meta">{meta}</div>}
            </div>
            <IconButton icon="close" label="Cerrar" onClick={onClose} />
          </header>
          <div className="lx-sheet__body">{children}</div>
          {footer && <footer className="lx-sheet__foot">{footer}</footer>}
        </div>
      )}
      {open && <div className="lx-sheet__toasts" ref={toastSlotRef} />}
    </dialog>
  );
};
