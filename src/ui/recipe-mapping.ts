import { el } from "./dom.js";
import { setupDialog } from "./dialog.js";

export interface RecipeMappingRequest {
  /** Saved base-column names that could not be matched by name. */
  names: readonly string[];
  /** Current column names to choose from. */
  columns: readonly string[];
}

/**
 * Mapping step shown when a saved recipe's base columns do not match the file
 * being loaded: each missing name gets a picker (or Skip). Resolves with the
 * chosen mapping, or null when the user cancels and prefers to replay without
 * the transforms.
 */
export function openRecipeMapping(
  request: RecipeMappingRequest,
): Promise<Map<string, number | null> | null> {
  return new Promise((resolve) => {
    const overlay = el("div", { class: "modal-overlay" });
    const modal = el("div", { class: "modal recipe-mapping-modal" });

    const head = el("div", { class: "modal-head" });
    head.append(el("h2", {}, ["Map the recipe to this file"]));
    const closeButton = el("button", { class: "icon-btn", type: "button", title: "Close" }, ["×"]);
    head.append(closeButton);
    modal.append(head);

    modal.append(
      el("p", { class: "confirm-body" }, [
        "This recipe was saved against different column names. Map each saved column to a column in this file to replay its transforms; columns left as Skip drop the steps that depend on them.",
      ]),
    );

    const selects = new Map<string, HTMLSelectElement>();
    const list = el("div", { class: "recipe-map-list" });
    request.names.forEach((name) => {
      const row = el("div", { class: "recipe-map-row" });
      row.append(el("span", { class: "recipe-map-name", title: name }, [name]));
      const select = el("select", {
        class: "chart-picker chart-picker-small",
        "aria-label": `Map ${name}`,
      }) as HTMLSelectElement;
      const skip = el("option", { value: "" }, ["Skip"]) as HTMLOptionElement;
      select.append(skip);
      request.columns.forEach((columnName, index) => {
        select.append(el("option", { value: String(index) }, [columnName]) as HTMLOptionElement);
      });
      selects.set(name, select);
      row.append(select);
      list.append(row);
    });
    modal.append(list);

    const footer = el("div", { class: "clean-footer" });
    const cancel = el("button", { class: "ghost", type: "button" }, ["Replay without transforms"]);
    const confirm = el("button", { class: "primary", type: "button" }, ["Replay with mapping"]);
    footer.append(cancel, el("span", { class: "grow" }), confirm);
    modal.append(footer);

    let settled = false;
    const finish = (value: Map<string, number | null> | null): void => {
      if (settled) return;
      settled = true;
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve(value);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") finish(null);
    };
    closeButton.addEventListener("click", () => finish(null));
    cancel.addEventListener("click", () => finish(null));
    confirm.addEventListener("click", () => {
      const mapping = new Map<string, number | null>();
      for (const [name, select] of selects) {
        const value = Number(select.value);
        mapping.set(name, select.value === "" || !Number.isFinite(value) ? null : value);
      }
      finish(mapping);
    });
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) finish(null);
    });
    document.addEventListener("keydown", onKey);

    overlay.append(modal);
    document.body.append(overlay);
    setupDialog(overlay, "Map the recipe to this file");
  });
}
