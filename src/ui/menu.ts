import { el } from "./dom.js";

export interface MenuItem {
  label: string;
  title?: string;
  disabled?: boolean;
  action: () => void;
}

/**
 * Small anchored popover menu used by the health group, the Overview column
 * cards and the dedupe control. Closes on outside pointerdown, Escape or after
 * an item is chosen.
 */
export function openMenu(
  anchor: HTMLElement,
  items: readonly MenuItem[],
  className = "context-menu",
): void {
  const menu = el("div", { class: className, role: "menu" });
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    menu.remove();
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("keydown", onKey);
  };
  const onPointerDown = (event: PointerEvent): void => {
    if (!menu.contains(event.target as Node)) close();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") close();
  };

  for (const item of items) {
    const node = el(
      "button",
      { class: "context-item", type: "button", role: "menuitem", title: item.title ?? item.label },
      [item.label],
    ) as HTMLButtonElement;
    node.disabled = item.disabled === true;
    node.addEventListener("click", () => {
      close();
      item.action();
    });
    menu.append(node);
  }

  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKey);
  document.body.append(menu);
  const rect = anchor.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - menu.offsetHeight - 8)}px`;
}
