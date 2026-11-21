import { el } from "./dom.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/** The Excel mark: a green workbook tile with a white X. */
export function excelLogo(): SVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 48 48");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "cmp-excel-logo");
  const shape = (tag: string, attrs: Record<string, string>): void => {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    svg.append(node);
  };
  shape("rect", { x: "10", y: "6", width: "34", height: "36", rx: "4", fill: "#fff", opacity: "0.95" });
  shape("path", { d: "M26 14h14v6H26zM26 22h14v6H26zM26 30h14v6H26z", fill: "#21a366", opacity: "0.55" });
  shape("rect", { x: "3", y: "11", width: "26", height: "26", rx: "4", fill: "#107c41" });
  shape("path", { d: "M10 17.5h4.2l3.3 5.4 3.3-5.4H25l-5.5 8.2 5.7 8.8h-4.2l-3.5-5.9-3.5 5.9H9.8l5.7-8.8z", fill: "#fff" });
  return svg;
}

/**
 * The big call to action at the foot of a report: one click builds the workbook. `run` resolves with a note to show, or "".
 * `busy`: a build started elsewhere (or before the page redrew) is still running, so the box starts disabled.
 * `note`: the last build's result, kept by a page that redraws.
 */
export function excelBox(options: { title: string; sub: string; run: () => Promise<string>; extra?: HTMLElement; busy?: boolean; note?: string }): HTMLElement {
  const { run } = options;
  const note = el("span", { class: "cmp-excel-note", role: "status" }, [options.note ?? ""]);
  const button = el("button", { type: "button", class: "cmp-excel", title: "Build the Excel report and save it" }, [
    excelLogo(),
    el("span", { class: "cmp-excel-text" }, [
      el("span", { class: "cmp-excel-title" }, [options.title]),
      el("span", { class: "cmp-excel-sub" }, [options.sub]),
    ]),
    el("span", { class: "cmp-excel-go", "aria-hidden": "true" }, ["Download ↓"]),
  ]);
  if (options.busy === true) {
    button.disabled = true;
    note.textContent = "Building the workbook…";
  }
  button.addEventListener("click", () => {
    if (button.disabled) return;
    button.disabled = true;
    note.textContent = "Building the workbook…";
    void run()
      .then((text) => {
        note.textContent = text === "" ? "Saved. Check your downloads." : text;
      })
      .catch((error: unknown) => {
        note.textContent = error instanceof Error ? error.message : "Export failed.";
      })
      .finally(() => {
        button.disabled = false;
      });
  });
  return el("section", { class: "cmp-excel-box", "aria-label": "Excel report" }, options.extra === undefined ? [button, note] : [button, options.extra, note]);
}
