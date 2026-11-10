/** Small DOM helpers shared by adapters. No site-specific selectors here. */

export const text = (root: ParentNode, sel: string): string | undefined =>
  root.querySelector(sel)?.textContent?.trim() || undefined;

/** "$1,234.50" -> 1234.5. Returns undefined when no price-like number is present. */
export function parsePrice(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const m = raw.replace(/\s/g, '').match(/(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/);
  if (!m) return undefined;
  return Number(m[1]!.replace(/,/g, '')) + (m[2] ? Number(`0.${m[2].padEnd(2, '0')}`) : 0);
}

/**
 * Put text into a textarea/input or contenteditable WITHOUT submitting it. Uses the native
 * value setter + an `input` event so framework-controlled inputs (React) see the change.
 * Never dispatches Enter, never clicks send.
 */
export function fillComposeBox(el: Element, value: string): boolean {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.focus();
    return true;
  }
  if (el instanceof HTMLElement && el.isContentEditable) {
    el.focus();
    // execCommand keeps editor frameworks (Lexical/Draft.js) in sync; fall back to textContent.
    const sel = el.ownerDocument.getSelection();
    if (sel) {
      const range = el.ownerDocument.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    const ok =
      typeof el.ownerDocument.execCommand === 'function' &&
      el.ownerDocument.execCommand('insertText', false, value);
    if (!ok) {
      el.textContent = value;
      el.dispatchEvent(
        new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }),
      );
    }
    return true;
  }
  return false;
}

/** Debounced MutationObserver on `target`. Returns an unsubscribe function. */
export function observe(target: Node, cb: () => void, delayMs = 300): () => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  const mo = new MutationObserver(() => {
    clearTimeout(t);
    t = setTimeout(cb, delayMs);
  });
  mo.observe(target, { childList: true, subtree: true, characterData: true });
  return () => {
    clearTimeout(t);
    mo.disconnect();
  };
}
