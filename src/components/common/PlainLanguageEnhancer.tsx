import React, {useEffect} from 'react';
import {
  PLAIN_LANGUAGE_FIELDS,
  PLAIN_LANGUAGE_WORD_HELP,
} from '../../data/plain-language-fields';

/**
 * Enhances `<label>` and `<legend>` elements across the workspace with plain-language
 * headings and contextual `?` explanation tooltips.
 */
export const PlainLanguageEnhancer: React.FC = () => {
  useEffect(() => {
    let popup = document.getElementById(
      'field-explanation'
    ) as HTMLDivElement | null;
    if (!popup) {
      popup = document.createElement('div');
      popup.className = 'explain-popup';
      popup.id = 'field-explanation';
      popup.setAttribute('popover', 'manual');
      popup.setAttribute('role', 'tooltip');
      popup.hidden = true;
      document.body.append(popup);
    }

    let anchor: HTMLElement | null = null;
    let pinned = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let opening: ReturnType<typeof setTimeout> | undefined;

    function hide(): void {
      if (timer) clearTimeout(timer);
      if (opening) clearTimeout(opening);
      document
        .querySelectorAll('.help-loading')
        .forEach((b) => b.classList.remove('help-loading'));
      try {
        popup?.hidePopover?.();
      } catch {
        // Ignore if popover not open
      }
      if (popup) popup.hidden = true;
      if (anchor) anchor.removeAttribute('aria-describedby');
      anchor = null;
      pinned = false;
    }

    function show(button: HTMLElement, pin = false): void {
      if (timer) clearTimeout(timer);
      if (opening) clearTimeout(opening);
      button.classList.remove('help-loading');
      if (!popup) return;
      anchor = button;
      pinned = pin;
      popup.textContent = button.dataset.explanation || '';
      popup.hidden = false;
      button.setAttribute('aria-describedby', popup.id);
      if (popup.showPopover) {
        try {
          popup.showPopover();
        } catch {
          // Ignore if already open
        }
      }
      const r = button.getBoundingClientRect();
      popup.style.left =
        Math.max(12, Math.min(window.innerWidth - 340, r.left - 12)) + 'px';
      popup.style.top = '0px';
      const height = popup.getBoundingClientRect().height;
      popup.style.top =
        (r.bottom + height + 12 < window.innerHeight
          ? r.bottom + 8
          : Math.max(12, r.top - height - 8)) + 'px';
    }

    function schedule(button: HTMLElement): void {
      if (pinned) return;
      if (opening) clearTimeout(opening);
      button.classList.add('help-loading');
      opening = setTimeout(() => show(button), 1000);
    }

    function cancel(button: HTMLElement): void {
      if (opening) clearTimeout(opening);
      button.classList.remove('help-loading');
      if (!pinned) timer = setTimeout(hide, 180);
    }

    function enhance(): void {
      for (const label of document.querySelectorAll<HTMLElement>(
        'label,legend'
      )) {
        if (label.closest('.game-menu')) continue;
        if (label.dataset.explained) continue;
        const control = label.querySelector<
          HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
        >('input,select,textarea');
        const key = control?.name || control?.id || '';
        const heading = [...label.childNodes].find(
          (n) => n.nodeType === 3 && n.textContent?.trim()
        );
        const old = heading?.textContent?.trim() || '';
        const entry =
          PLAIN_LANGUAGE_FIELDS[key] || PLAIN_LANGUAGE_WORD_HELP[old];
        if (!entry) continue;
        label.dataset.explained = 'true';
        if (heading) heading.textContent = entry[0] + ' ';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'explain-button';
        button.textContent = '?';
        button.setAttribute('aria-label', 'Más información sobre ' + entry[0]);
        button.dataset.explanation = entry[1];
        label.insertBefore(button, control || null);
        button.onmouseenter = () => schedule(button);
        button.onmouseleave = () => cancel(button);
        button.onfocus = () => schedule(button);
        button.onblur = hide;
        button.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (anchor === button && pinned) hide();
          else show(button, true);
        };
        const headingSpan = document.createElement('span');
        headingSpan.className = 'help-heading';
        if (heading) {
          heading.before(headingSpan);
          headingSpan.append(heading);
        }
        headingSpan.onmouseenter = () => schedule(button);
        headingSpan.onmouseleave = () => cancel(button);
        if (control) {
          control.addEventListener('pointerdown', hide);
          control.addEventListener('focus', hide);
        }
      }
    }

    popup.onmouseenter = () => {
      if (timer) clearTimeout(timer);
    };
    popup.onmouseleave = () => {
      if (!pinned) hide();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (
        anchor &&
        target &&
        !anchor.contains(target) &&
        !popup?.contains(target)
      ) {
        hide();
      }
    };
    const onScroll = () => {
      if (anchor) hide();
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('scroll', onScroll, true);

    const observer = new MutationObserver(() => {
      enhance();
      if (anchor && !anchor.isConnected) hide();
    });
    observer.observe(document.body, {childList: true, subtree: true});
    enhance();

    return () => {
      observer.disconnect();
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, []);

  return null;
};
