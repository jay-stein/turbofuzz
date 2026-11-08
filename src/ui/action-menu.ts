import { el, svgIcon } from "./dom.js";
import type { MenuItem } from "./menu.js";

/** One entry in an action menu: a command, or a submenu when it has children. */
export interface ActionItem {
  label: string;
  /** Tooltip: what the action does. */
  hint?: string;
  /** SVG path markup on a 24×24 grid (see ICONS). */
  icon?: string;
  /** A count or short tag shown on the right (e.g. how many cells a fix touches). */
  badge?: string;
  /** Radio/check state; once any sibling sets it, the siblings leave room for a tick. */
  checked?: boolean;
  disabled?: boolean;
  danger?: boolean;
  /** Applies at once (undo from the toast or the Recipe), rather than opening a panel. */
  instant?: boolean;
  /** A non-interactive label above the siblings that follow. */
  heading?: boolean;
  run?: () => void;
  children?: ActionItem[];
}

export interface ActionSection {
  title?: string;
  items: ActionItem[];
}

export interface ActionMenuHead {
  title: string;
  subtitle?: string;
  /** Short type glyph shown as a chip, with its colour family. */
  glyph?: string;
  family?: string;
}

/** Stroke icons (24×24, drawn with currentColor). */
export const ICONS = {
  sortAsc: '<path d="M7 4v16"/><path d="M3 8l4-4 4 4"/><path d="M14 6h7"/><path d="M14 12h5"/><path d="M14 18h3"/>',
  sortDesc: '<path d="M7 4v16"/><path d="M3 16l4 4 4-4"/><path d="M14 6h3"/><path d="M14 12h5"/><path d="M14 18h7"/>',
  sortClear: '<path d="M7 4v16"/><path d="M14 9l6 6"/><path d="M20 9l-6 6"/>',
  filter: '<path d="M3 5h18l-7 8.5V19l-4 2v-7.5z"/>',
  chart: '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>',
  hide: '<path d="M3 3l18 18"/><path d="M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 9 6 9 6a17 17 0 0 1-2.6 3.2"/><path d="M6.6 6.6C4.3 8.1 3 12 3 12s4 6 9 6a8.6 8.6 0 0 0 4.4-1.2"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  freeze: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/><path d="M3 10h6"/><path d="M3 15h6"/>',
  display: '<path d="M4 7V5h16v2"/><path d="M9 19h6"/><path d="M12 5v14"/>',
  locale: '<path d="M4 9h16"/><path d="M4 15h16"/><path d="M10 3L8 21"/><path d="M16 3l-2 18"/>',
  rename: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>',
  type: '<path d="M4 7V4h16v3"/><path d="M12 4v16"/><path d="M9 20h6"/>',
  insertLeft: '<rect x="12" y="4" width="9" height="16" rx="2"/><path d="M6 9v6"/><path d="M3 12h6"/>',
  insertRight: '<rect x="3" y="4" width="9" height="16" rx="2"/><path d="M18 9v6"/><path d="M15 12h6"/>',
  trash: '<path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M5 7l1 13h12l1-13"/><path d="M9 7V4h6v3"/>',
  fix: '<path d="M15 4l5 5"/><path d="M4 20l9.5-9.5"/><path d="M17.5 2.5l4 4-3 3-4-4z"/><path d="M5 3v4"/><path d="M3 5h4"/>',
  trim: '<path d="M4 6h16"/><path d="M8 12h8"/><path d="M4 18h16"/>',
  textCase: '<path d="M3 18l4-11 4 11"/><path d="M4.5 14h5"/><path d="M15 10.5a3 3 0 1 1 0 6 3 3 0 0 1 0-6z"/><path d="M18 10v8"/>',
  convert: '<path d="M4 8h13l-3-3"/><path d="M20 16H7l3 3"/>',
  replace: '<circle cx="10" cy="10" r="6"/><path d="M14.5 14.5L20 20"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  clean: '<path d="M14 3l7 7"/><path d="M3 21l8.5-8.5"/><path d="M11 6l7 7-4 4-7-7z"/>',
  missing: '<rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3 3"/>',
  fill: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
  neighbours: '<circle cx="12" cy="12" r="2.5"/><circle cx="5" cy="6" r="1.5"/><circle cx="19" cy="7" r="1.5"/><circle cx="6" cy="18" r="1.5"/><circle cx="18" cy="18" r="1.5"/>',
  round: '<path d="M5 18h14"/><path d="M8 14V6"/><path d="M5 9l3-3 3 3"/><path d="M16 6v8"/>',
  split: '<path d="M12 4v16"/><path d="M4 8l4 4-4 4"/><path d="M20 8l-4 4 4 4"/>',
  combine: '<path d="M4 6l6 6-6 6"/><path d="M20 6l-6 6 6 6"/>',
  group: '<rect x="3" y="4" width="18" height="5" rx="1.5"/><rect x="3" y="12" width="12" height="3" rx="1"/><rect x="3" y="18" width="8" height="2" rx="1"/>',
  dedupe: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  melt: '<path d="M4 5h16"/><path d="M4 5v14"/><path d="M10 9v10"/><path d="M16 13v6"/>',
  transform: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><path d="M14 6.5h4a2 2 0 0 1 2 2V11"/><path d="M10 17.5H6a2 2 0 0 1-2-2V13"/>',
  merge: '<path d="M6 4v5a6 6 0 0 0 6 6h0a6 6 0 0 0 6-6V4"/><path d="M12 15v6"/>',
  outlier: '<circle cx="5" cy="17" r="1.5"/><circle cx="9" cy="15" r="1.5"/><circle cx="13" cy="16" r="1.5"/><circle cx="19" cy="5" r="2"/>',
  blank: '<path d="M5 12h14"/><path d="M5 5l14 14"/>',
  allowed: '<path d="M4 6h10"/><path d="M4 12h10"/><path d="M4 18h6"/><path d="M15 17l2 2 4-4"/>',
  compare: '<path d="M8 4v16"/><path d="M16 4v16"/><path d="M4 9h8"/><path d="M12 15h8"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  number: '<path d="M9 4L7 20"/><path d="M17 4l-2 16"/><path d="M4 9h16"/><path d="M3 15h16"/>',
  letters: '<path d="M3 18l4.5-12L12 18"/><path d="M4.7 14h5.6"/><path d="M15 9h4.5a2 2 0 0 1 0 4H15v5h5"/>',
  formula: '<path d="M14 4h-2a2 2 0 0 0-2 2v12a2 2 0 0 1-2 2H6"/><path d="M7 11h8"/>',
} as const;

const SUBMENU_DELAY = 140;

/** Adapts the plain menu items used elsewhere (fill and outlier menus) to submenu entries. */
export function fromMenuItems(items: readonly MenuItem[]): ActionItem[] {
  return items.map((item) =>
    item.heading === true || (item.disabled === true && item.title === undefined)
      ? { label: item.label, heading: true }
      : {
          label: item.label,
          hint: item.title,
          checked: item.checked,
          disabled: item.disabled,
          run: item.action,
        },
  );
}

interface Level {
  node: HTMLElement;
  buttons: HTMLButtonElement[];
  /** The item in the parent level that opened this one. */
  owner: HTMLButtonElement | null;
}

/**
 * A right-click menu with a heading, a search box, titled sections and
 * flyout submenus. Keyboard: ↑/↓ move, → or Enter opens a submenu, ← or
 * Escape closes it, Escape at the top closes the menu, and typing in the
 * search box lists every matching action (submenus included) as one list.
 */
export function openActionMenu(
  sections: readonly ActionSection[],
  at: { x: number; y: number },
  head?: ActionMenuHead,
  returnFocus?: HTMLElement,
): void {
  for (const stale of document.querySelectorAll(".cmenu")) stale.remove();
  // The heading and search box sit outside the list, so the menu role goes on the list itself.
  const root = el("div", { class: "context-menu cmenu", role: "dialog", "aria-label": head === undefined ? "Actions" : `Actions for “${head.title}”` });
  const levels: Level[] = [];
  let hoverTimer: number | null = null;
  let closed = false;

  const close = (refocus: boolean): void => {
    if (closed) return;
    closed = true;
    for (const level of levels) level.node.remove();
    root.remove();
    if (hoverTimer !== null) window.clearTimeout(hoverTimer);
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", onResize);
    if (refocus) returnFocus?.focus({ preventScroll: true });
  };
  const onResize = (): void => close(false);
  const onPointerDown = (event: PointerEvent): void => {
    const target = event.target as Node;
    if (root.contains(target) || levels.some((level) => level.node.contains(target))) return;
    close(false);
  };

  /** Closes the submenus deeper than `depth` (0 = keep only the root). */
  const closeFrom = (depth: number): void => {
    while (levels.length > depth + 1) {
      const level = levels.pop()!;
      level.node.remove();
      level.owner?.setAttribute("aria-expanded", "false");
      level.owner?.classList.remove("open");
    }
  };

  const runItem = (item: ActionItem): void => {
    close(false);
    item.run?.();
  };

  const buildItem = (item: ActionItem, depth: number, siblingsHaveChecks: boolean, path?: string): HTMLElement => {
    if (item.heading === true) {
      return el("div", { class: "cmenu-sublabel", role: "presentation" }, [item.label]);
    }
    const hasChildren = item.children !== undefined && item.children.length > 0;
    const button = el("button", {
      class: `context-item cmenu-item${item.danger === true ? " danger" : ""}${hasChildren ? " has-sub" : ""}`,
      type: "button",
      role: siblingsHaveChecks ? "menuitemradio" : "menuitem",
      tabindex: "-1",
    }) as HTMLButtonElement;
    if (item.hint !== undefined) button.title = item.hint;
    else if (item.instant === true) button.title = "Applies immediately — undo from the toast or the Recipe";
    if (siblingsHaveChecks) {
      button.setAttribute("aria-checked", String(item.checked === true));
      const tick = el("span", { class: "cmenu-check", "aria-hidden": "true" });
      if (item.checked === true) tick.append(svgIcon('<path d="M5 12.5l4.5 4.5L19 7.5"/>', "cmenu-svg"));
      button.append(tick);
    } else if (item.icon !== undefined) {
      const icon = el("span", { class: "cmenu-icon", "aria-hidden": "true" });
      icon.append(svgIcon(item.icon, "cmenu-svg"));
      button.append(icon);
    } else {
      button.append(el("span", { class: "cmenu-icon", "aria-hidden": "true" }));
    }
    button.append(el("span", { class: "cmenu-label" }, [item.label]));
    if (path !== undefined) button.append(el("span", { class: "cmenu-path" }, [path]));
    if (item.badge !== undefined) button.append(el("span", { class: "cmenu-badge" }, [item.badge]));
    if (hasChildren) {
      button.setAttribute("aria-haspopup", "menu");
      button.setAttribute("aria-expanded", "false");
      const chevron = el("span", { class: "cmenu-chevron", "aria-hidden": "true" });
      chevron.append(svgIcon('<path d="M9 6l6 6-6 6"/>', "cmenu-svg"));
      button.append(chevron);
    }
    button.disabled = item.disabled === true;

    const open = (focusFirst: boolean): void => {
      if (!hasChildren) return;
      if (levels[depth + 1]?.owner === button) {
        if (focusFirst) levels[depth + 1].buttons.find((b) => !b.disabled)?.focus();
        return;
      }
      closeFrom(depth);
      openLevel(item.children!, depth + 1, button, focusFirst);
    };
    button.addEventListener("click", () => {
      if (hasChildren) open(true);
      else runItem(item);
    });
    button.addEventListener("pointerenter", () => {
      if (hoverTimer !== null) window.clearTimeout(hoverTimer);
      hoverTimer = window.setTimeout(() => {
        hoverTimer = null;
        if (closed) return;
        if (hasChildren) open(false);
        else closeFrom(depth);
      }, SUBMENU_DELAY);
    });
    button.addEventListener("pointermove", () => {
      if (document.activeElement !== button && !(document.activeElement instanceof HTMLInputElement)) {
        button.focus({ preventScroll: true });
      }
    });
    return button;
  };

  const fillList = (host: HTMLElement, items: readonly ActionItem[], depth: number): HTMLButtonElement[] => {
    const checks = items.some((item) => item.checked !== undefined);
    const buttons: HTMLButtonElement[] = [];
    for (const item of items) {
      const node = buildItem(item, depth, checks && item.heading !== true);
      host.append(node);
      if (node instanceof HTMLButtonElement) buttons.push(node);
    }
    return buttons;
  };

  const openLevel = (items: readonly ActionItem[], depth: number, owner: HTMLButtonElement, focusFirst: boolean): void => {
    const node = el("div", { class: "context-menu cmenu cmenu-sub", role: "menu" });
    const buttons = fillList(node, items, depth);
    levels.push({ node, buttons, owner });
    owner.setAttribute("aria-expanded", "true");
    owner.classList.add("open");
    document.body.append(node);
    const rect = owner.getBoundingClientRect();
    const width = node.offsetWidth;
    const height = node.offsetHeight;
    const right = rect.right + 2;
    const left = right + width > window.innerWidth - 8 ? Math.max(8, rect.left - width - 2) : right;
    node.style.left = `${left}px`;
    node.style.top = `${Math.max(8, Math.min(rect.top - 5, window.innerHeight - height - 8))}px`;
    if (focusFirst) buttons.find((b) => !b.disabled)?.focus();
  };

  // Heading: the column's type chip and name, so it is clear which column the actions act on.
  if (head !== undefined) {
    const header = el("div", { class: "cmenu-head" });
    if (head.glyph !== undefined) {
      header.append(el("span", { class: "cmenu-type", "data-fam": head.family ?? "text" }, [head.glyph]));
    }
    const titles = el("div", { class: "cmenu-titles" }, [el("div", { class: "cmenu-title", title: head.title }, [head.title])]);
    if (head.subtitle !== undefined) titles.append(el("div", { class: "cmenu-subtitle" }, [head.subtitle]));
    header.append(titles);
    root.append(header);
  }
  const search = el("input", {
    class: "text-input context-search",
    type: "search",
    placeholder: "Find an action…",
    "aria-label": "Find an action",
    autocomplete: "off",
    spellcheck: "false",
  }) as HTMLInputElement;
  root.append(search);
  const body = el("div", { class: "cmenu-body", role: "menu", "aria-label": head?.title ?? "Actions" });
  root.append(body);
  const rootLevel: Level = { node: root, buttons: [], owner: null };
  levels.push(rootLevel);

  const renderSections = (): void => {
    body.replaceChildren();
    rootLevel.buttons = [];
    sections.forEach((section, index) => {
      if (section.items.length === 0) return;
      if (index > 0 && body.childElementCount > 0) body.append(el("div", { class: "cmenu-sep", role: "separator" }));
      if (section.title !== undefined) body.append(el("div", { class: "context-header cmenu-section", role: "presentation" }, [section.title]));
      rootLevel.buttons.push(...fillList(body, section.items, 0));
    });
  };

  // Every runnable action with the submenu path that leads to it, for search.
  const leaves: { item: ActionItem; path: string; text: string }[] = [];
  const collect = (items: readonly ActionItem[], trail: string[]): void => {
    for (const item of items) {
      if (item.heading === true || item.disabled === true) continue;
      if (item.children !== undefined && item.children.length > 0) collect(item.children, [...trail, item.label]);
      else leaves.push({ item, path: trail.join(" › "), text: `${trail.join(" ")} ${item.label}`.toLowerCase() });
    }
  };
  for (const section of sections) collect(section.items, []);

  const renderResults = (query: string): void => {
    closeFrom(0);
    body.replaceChildren();
    const words = query.toLowerCase().split(/\s+/).filter((word) => word !== "");
    const found = leaves.filter((leaf) => words.every((word) => leaf.text.includes(word)));
    rootLevel.buttons = [];
    if (found.length === 0) {
      body.append(el("div", { class: "cmenu-empty", role: "presentation" }, [`No action matches “${query}”`]));
      return;
    }
    for (const leaf of found.slice(0, 40)) {
      const node = buildItem(leaf.item, 0, false, leaf.path === "" ? undefined : leaf.path) as HTMLButtonElement;
      body.append(node);
      rootLevel.buttons.push(node);
    }
  };

  search.addEventListener("input", () => {
    const query = search.value.trim();
    if (query === "") renderSections();
    else renderResults(query);
  });

  const levelOf = (target: EventTarget | null): number =>
    levels.findIndex((level) => level.node.contains(target as Node));

  const step = (level: Level, direction: 1 | -1): void => {
    const list = level.buttons.filter((b) => !b.disabled);
    if (list.length === 0) return;
    const index = list.indexOf(document.activeElement as HTMLButtonElement);
    const next = index < 0 ? (direction === 1 ? 0 : list.length - 1) : (index + direction + list.length) % list.length;
    list[next].focus();
  };

  const onKey = (event: KeyboardEvent): void => {
    const depth = Math.max(0, levelOf(document.activeElement));
    const level = levels[depth];
    const inSearch = event.target === search || document.activeElement === search;
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        if (inSearch && search.value !== "") {
          search.value = "";
          renderSections();
        } else if (depth > 0) {
          const owner = level.owner;
          closeFrom(depth - 1);
          owner?.focus();
        } else close(true);
        break;
      case "ArrowDown":
      case "ArrowUp":
        event.preventDefault();
        step(level, event.key === "ArrowDown" ? 1 : -1);
        break;
      case "Home":
      case "End":
        if (inSearch) return;
        event.preventDefault();
        {
          const list = level.buttons.filter((b) => !b.disabled);
          (event.key === "Home" ? list[0] : list.at(-1))?.focus();
        }
        break;
      case "ArrowRight":
        if (inSearch) return;
        if ((document.activeElement as HTMLElement | null)?.classList.contains("has-sub") === true) {
          event.preventDefault();
          (document.activeElement as HTMLButtonElement).click();
        }
        break;
      case "ArrowLeft":
        if (inSearch || depth === 0) return;
        event.preventDefault();
        {
          const owner = level.owner;
          closeFrom(depth - 1);
          owner?.focus();
        }
        break;
      case "Enter":
        if (inSearch) {
          event.preventDefault();
          rootLevel.buttons.find((b) => !b.disabled)?.click();
        }
        break;
      case "Tab":
        close(false);
        break;
      default:
        // Typing anywhere in the menu goes to the search box.
        // The key must not also reach the page's own shortcuts.
        if (!inSearch && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && /\S/.test(event.key)) {
          event.stopPropagation();
          closeFrom(0);
          search.focus();
        }
    }
  };

  renderSections();
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", onResize);
  document.body.append(root);
  root.style.left = `${Math.max(8, Math.min(at.x, window.innerWidth - root.offsetWidth - 8))}px`;
  root.style.top = `${Math.max(8, Math.min(at.y, window.innerHeight - root.offsetHeight - 8))}px`;
  window.setTimeout(() => {
    if (!closed) search.focus({ preventScroll: true });
  }, 0);
}
