import { setupDialog } from "./dialog.js";
import { el } from "./dom.js";
import { HELP_SECTIONS, type HelpSection } from "./help-content.js";

function blockText(section: HelpSection): string {
  const parts = [section.title, section.summary];
  for (const block of section.blocks) {
    if (block.text !== undefined) parts.push(block.text);
    if (block.items !== undefined) parts.push(...block.items);
  }
  return parts.join(" ").toLowerCase();
}

function renderSection(section: HelpSection): HTMLElement {
  const wrap = el("section", { class: "help-section", id: `help-${section.id}` });
  wrap.append(
    el("h3", {}, [section.title]),
    el("p", { class: "help-summary" }, [section.summary]),
  );
  for (const block of section.blocks) {
    if (block.kind === "p") {
      wrap.append(el("p", { class: "help-p" }, [block.text ?? ""]));
    } else if (block.kind === "list") {
      const list = el("ul", { class: "help-list" });
      for (const item of block.items ?? []) list.append(el("li", {}, [item]));
      wrap.append(list);
    } else {
      wrap.append(el("div", { class: "help-note" }, [block.text ?? ""]));
    }
  }
  return wrap;
}

/**
 * In-app user guide: a searchable right-hand drawer bundled with the app
 * (works offline). `initialSectionId` deep-links to one topic.
 */
export function openHelpDrawer(initialSectionId?: string): void {
  const overlay = el("div", { class: "modal-overlay drawer-overlay" });
  const modal = el("div", { class: "modal clean-modal drawer help-drawer" });

  const head = el("div", { class: "modal-head" });
  head.append(el("h2", {}, ["User guide"]));
  const closeButton = el("button", { class: "icon-btn", type: "button", title: "Close" }, ["×"]);
  head.append(closeButton);
  modal.append(head);

  const search = el("input", {
    class: "text-input help-search",
    type: "search",
    placeholder: "Search the guide…",
    spellcheck: "false",
    "aria-label": "Search the user guide",
  }) as HTMLInputElement;
  const count = el("div", { class: "help-count" });
  const list = el("div", { class: "help-sections" });
  modal.append(search, count, list);

  const render = (query: string): void => {
    const needle = query.trim().toLowerCase();
    list.replaceChildren();
    const matches = HELP_SECTIONS.filter(
      (section) => needle === "" || blockText(section).includes(needle),
    );
    for (const section of matches) list.append(renderSection(section));
    count.textContent =
      matches.length === HELP_SECTIONS.length
        ? `${HELP_SECTIONS.length} topics`
        : `${matches.length} of ${HELP_SECTIONS.length} topics`;
    if (matches.length === 0) {
      list.append(el("div", { class: "help-empty" }, ["No topics match that search."]));
    }
  };
  search.addEventListener("input", () => render(search.value));
  render("");

  function close(): void {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  }
  function onKey(event: KeyboardEvent): void {
    if (event.key === "Escape") close();
  }
  closeButton.addEventListener("click", close);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener("keydown", onKey);

  overlay.append(modal);
  document.body.append(overlay);
  setupDialog(overlay, "User guide");

  if (initialSectionId !== undefined) {
    const target = list.querySelector<HTMLElement>(`#help-${initialSectionId}`);
    if (target !== null) {
      target.scrollIntoView?.({ block: "start" });
      target.classList.add("flash");
      window.setTimeout(() => target.classList.remove("flash"), 1600);
    }
  }
}
