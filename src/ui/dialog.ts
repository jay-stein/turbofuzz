/**
 * Minimal modal semantics for the drawer panels: dialog role, accessible
 * name, initial focus, a Tab focus trap and focus restoration on close.
 * Panels keep their own Escape/overlay-click handling.
 */
export function setupDialog(overlay: HTMLElement, label: string): void {
  const dialog = overlay.querySelector<HTMLElement>(".modal");
  if (dialog === null) return;
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", label);
  dialog.tabIndex = -1;

  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const focusable = (): HTMLElement[] =>
    Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => !element.hasAttribute("disabled") && !element.hidden);

  window.setTimeout(() => {
    const first = focusable()[0];
    (first ?? dialog).focus();
  }, 0);

  overlay.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const items = focusable();
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  const observer = new MutationObserver(() => {
    if (overlay.isConnected) return;
    observer.disconnect();
    previous?.focus();
  });
  observer.observe(document.body, { childList: true });
}
