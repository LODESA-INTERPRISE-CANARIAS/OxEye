/**
 * Copy to the clipboard, with a fallback for browsers or contexts where the
 * async Clipboard API is missing (older phones, plain http on a LAN).
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission refused: try the old way below.
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    // Inside an open modal dialog, only its own subtree is interactive.
    const open = document.querySelectorAll('dialog[open]');
    const host = open[open.length - 1] ?? document.body;
    host.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Whether the Web Share API can share this text here. */
export function canShareText(text: string): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    (typeof navigator.canShare !== 'function' || navigator.canShare({text}))
  );
}
