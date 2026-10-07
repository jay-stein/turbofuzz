import { el } from "./dom.js";

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

export interface ConfirmOptions {
  title: string;
  body: string;
  confirmLabel?: string;
  danger?: boolean;
}

/** Small yes/no dialog; resolves true only when the action is confirmed. */
export function openConfirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = el("div", { class: "modal-overlay" });
    const modal = el("div", { class: "modal confirm-modal" });

    const head = el("div", { class: "modal-head" });
    head.append(el("h2", {}, [options.title]));
    const closeButton = el("button", { class: "icon-btn", type: "button", title: "Close" }, ["×"]);
    head.append(closeButton);
    modal.append(head);

    modal.append(el("p", { class: "confirm-body" }, [options.body]));

    const footer = el("div", { class: "clean-footer" });
    const cancel = el("button", { class: "ghost", type: "button" }, ["Cancel"]);
    const confirm = el(
      "button",
      { class: `primary${options.danger === true ? " danger" : ""}`, type: "button" },
      [options.confirmLabel ?? "Confirm"],
    );
    footer.append(cancel, el("span", { class: "grow" }), confirm);
    modal.append(footer);

    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve(value);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") finish(false);
    };
    closeButton.addEventListener("click", () => finish(false));
    cancel.addEventListener("click", () => finish(false));
    confirm.addEventListener("click", () => finish(true));
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) finish(false);
    });
    document.addEventListener("keydown", onKey);

    overlay.append(modal);
    document.body.append(overlay);
    setupDialog(overlay, options.title);
  });
}
