import { el } from "./dom.js";

export interface MenuItem {
  label: string;
  title?: string;
  disabled?: boolean;
  action: () => void;
}

/**
 * Small anchored popover menu used by the health group, the Overview column
 * cards and the dedupe control. Keyboard: focus lands on the first enabled
 * item, ArrowUp/ArrowDown cycle, Home/End jump, Enter activates, Escape
 * closes and returns focus to the anchor, Tab closes and moves on. Pointer
 * clicks outside close it as before.
 */
export function openMenu(
  anchor: HTMLElement,
  items: readonly MenuItem[],
  className = "context-menu",
  at?: { x: number; y: number },
): void {
  const menu = el("div", { class: className, role: "menu" });
  const buttons: HTMLButtonElement[] = [];
  let closed = false;
  const close = (refocus: boolean): void => {
    if (closed) return;
    closed = true;
    menu.remove();
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("keydown", onKey);
    if (refocus && typeof anchor.focus === "function") anchor.focus();
  };
  const onPointerDown = (event: PointerEvent): void => {
    if (!menu.contains(event.target as Node)) close(false);
  };
  const enabled = (): HTMLButtonElement[] => buttons.filter((button) => !button.disabled);
  const focusStep = (direction: 1 | -1): void => {
    const list = enabled();
    if (list.length === 0) return;
    const index = list.indexOf(document.activeElement as HTMLButtonElement);
    list[(index + direction + list.length) % list.length].focus();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      focusStep(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusStep(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      enabled()[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      enabled().at(-1)?.focus();
    } else if (event.key === "Tab") {
      close(false);
    }
  };

  for (const item of items) {
    const node = el(
      "button",
      { class: "context-item", type: "button", role: "menuitem", title: item.title ?? item.label },
      [item.label],
    ) as HTMLButtonElement;
    node.disabled = item.disabled === true;
    node.addEventListener("click", () => {
      close(false);
      item.action();
    });
    buttons.push(node);
    menu.append(node);
  }

  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKey);
  document.body.append(menu);
  const rect = anchor.getBoundingClientRect();
  // A pointer position (right-click) wins over the anchor's corner.
  const left = at !== undefined ? at.x : rect.left;
  const top = at !== undefined ? at.y : rect.bottom + 4;
  menu.style.left = `${Math.max(8, Math.min(left, window.innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(top, window.innerHeight - menu.offsetHeight - 8))}px`;
  enabled()[0]?.focus();
}
