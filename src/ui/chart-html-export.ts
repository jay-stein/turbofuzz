/**
 * A chart as one interactive web page: the drawn chart, and hover details for every mark, in a
 * single .html file that opens in any browser with no internet. The hover details are the ones
 * the chart shows on screen, and the analyst chooses which lines appear and what they are called.
 */
import { setupDialog } from "./dialog.js";
import { el } from "./dom.js";
import type { HitRegion } from "./chart-hit-regions.js";

/** One kind of line in the hover box: the mark's name, or a "Label: value" line. */
export interface HoverField {
  /** "name" for the first line (what the mark is); otherwise the label before ": ". */
  key: string;
  /** What the dialog calls it, and what the line is called unless renamed. */
  label: string;
  /** An example, from the first mark that has this line. */
  example: string;
  show: boolean;
  /** Empty keeps the chart's own label. */
  rename: string;
}

export interface HoverChoices {
  fields: HoverField[];
  /** A line of the analyst's own under every hover, such as a source or a caveat. */
  note: string;
  /** The chart's facts (how values roll up, the rows it covers) under each hover. */
  details: boolean;
}

export interface ChartHtmlPayload {
  title: string;
  subtitle: string;
  width: number;
  height: number;
  /** The drawn chart, as a PNG data URL. */
  image: string;
  theme: "light" | "dark";
  /** The chart's own background, so the page and the picture are one surface. */
  background: string;
  /** Per mark: its box (for the highlight) and its hover lines, after the analyst's choices. */
  regions: { x: number; y: number; w: number; h: number; lines: string[] }[];
  /** Which mark is under each cell of the chart: run-length pairs of (mark index + 1, cells). */
  map: { cell: number; cols: number; rows: number; runs: number[] };
  details: string[];
}

/** The label of a "Label: value" line, or null when the line has none. */
function labelOf(line: string): string | null {
  const at = line.indexOf(": ");
  return at > 0 && at <= 60 ? line.slice(0, at) : null;
}

function keyOf(line: string, index: number): string {
  if (index === 0) return "name";
  return labelOf(line) ?? `line ${index + 1}`;
}

/** Every kind of hover line the chart's marks have, in the order they first appear. */
export function hoverFields(regions: readonly { lines: readonly string[] }[]): HoverField[] {
  const out = new Map<string, HoverField>();
  for (const region of regions) {
    region.lines.forEach((line, index) => {
      const key = keyOf(line, index);
      if (out.has(key)) return;
      const label = key === "name" ? "Name of the mark" : key;
      const example = key === "name" || labelOf(line) === null ? line : line.slice(key.length + 2);
      out.set(key, { key, label, example, show: true, rename: "" });
    });
  }
  return [...out.values()];
}

/** A mark's hover lines with the analyst's choices applied: hidden lines left out, labels renamed, the note added. */
export function applyHover(lines: readonly string[], choices: HoverChoices): string[] {
  const fields = new Map(choices.fields.map((field) => [field.key, field] as const));
  const out: string[] = [];
  lines.forEach((line, index) => {
    const key = keyOf(line, index);
    const field = fields.get(key);
    if (field !== undefined && !field.show) return;
    const rename = field?.rename.trim() ?? "";
    if (rename === "") out.push(line);
    else if (key === "name") out.push(`${rename}: ${line}`);
    else if (labelOf(line) === key) out.push(`${rename}: ${line.slice(key.length + 2)}`);
    else out.push(`${rename}: ${line}`);
  });
  if (choices.note.trim() !== "") out.push(choices.note.trim());
  return out;
}

/**
 * Which mark is under each cell of the chart, as run-length pairs. Marks are laid down in drawing
 * order, so a later one wins where they overlap, as hovering on screen does.
 */
export function buildHitMap(regions: readonly HitRegion[], width: number, height: number, cell = 2): ChartHtmlPayload["map"] {
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const grid = new Int32Array(cols * rows);
  regions.forEach((region, index) => {
    const c0 = Math.max(0, Math.floor(region.x / cell));
    const c1 = Math.min(cols - 1, Math.floor((region.x + region.w) / cell));
    const r0 = Math.max(0, Math.floor(region.y / cell));
    const r1 = Math.min(rows - 1, Math.floor((region.y + region.h) / cell));
    for (let r = r0; r <= r1; r++) {
      const y = r * cell + cell / 2;
      for (let c = c0; c <= c1; c++) {
        const x = c * cell + cell / 2;
        // Thin marks (a line's point, a 1px bar) still get the cell they touch.
        const inside = region.contains === undefined || region.contains(x, y) || region.w < cell || region.h < cell;
        if (inside) grid[r * cols + c] = index + 1;
      }
    }
  });
  const runs: number[] = [];
  let value = grid[0] ?? 0;
  let length = 0;
  for (const next of grid) {
    if (next === value) {
      length++;
      continue;
    }
    runs.push(value, length);
    value = next;
    length = 1;
  }
  runs.push(value, length);
  return { cell, cols, rows, runs };
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Nothing in the data can end the script block or be read as markup. */
const safeJson = (value: unknown): string => JSON.stringify(value).replace(/</g, "\\u003c");

const STYLE = `
:root { --bg: #ffffff; --text: #1f2937; --dim: #6b7280; --tip: #ffffff; --line: #d1d5db; --hl: rgba(37, 99, 235, 0.12); color-scheme: light; }
:root[data-theme="dark"] { --bg: #111827; --text: #e5e7eb; --dim: #9ca3af; --tip: #1f2937; --line: #374151; --hl: rgba(96, 165, 250, 0.16); color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; padding: 20px 16px; background: var(--bg); color: var(--text); font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
header, main, footer { max-width: 1400px; margin: 0 auto; }
h1 { margin: 0 0 2px; font-size: 18px; }
header p { margin: 0 0 12px; color: var(--dim); }
.chart { position: relative; }
.chart img { display: block; width: 100%; height: auto; }
.hl { position: absolute; pointer-events: none; background: var(--hl); border-radius: 3px; display: none; }
.tip { position: fixed; z-index: 2; pointer-events: none; display: none; max-width: 320px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--tip); box-shadow: 0 6px 20px rgba(0,0,0,.18); font-size: 13px; }
.tip b { display: block; margin-bottom: 2px; }
.tip .detail { margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--line); color: var(--dim); font-size: 12px; }
footer { margin-top: 10px; color: var(--dim); font-size: 12px; }
`;

const SCRIPT = `
(function () {
  var data = JSON.parse(document.getElementById("chart-data").textContent);
  var img = document.querySelector(".chart img");
  var tip = document.querySelector(".tip");
  var hl = document.querySelector(".hl");
  var m = data.map, grid = new Int32Array(m.cols * m.rows), at = 0;
  for (var i = 0; i < m.runs.length; i += 2) { if (m.runs[i]) grid.fill(m.runs[i], at, at + m.runs[i + 1]); at += m.runs[i + 1]; }
  var shown = -1;
  function hide() { shown = -1; tip.style.display = "none"; hl.style.display = "none"; }
  function show(event) {
    var box = img.getBoundingClientRect();
    var sx = data.width / box.width, sy = data.height / box.height;
    var c = Math.floor((event.clientX - box.left) * sx / m.cell), r = Math.floor((event.clientY - box.top) * sy / m.cell);
    var index = c >= 0 && r >= 0 && c < m.cols && r < m.rows ? grid[r * m.cols + c] - 1 : -1;
    var region = data.regions[index];
    if (!region || region.lines.length === 0) { hide(); return; }
    if (index !== shown) {
      shown = index;
      tip.textContent = "";
      var title = document.createElement("b");
      title.textContent = region.lines[0];
      tip.appendChild(title);
      for (var j = 1; j < region.lines.length; j++) { var row = document.createElement("div"); row.textContent = region.lines[j]; tip.appendChild(row); }
      if (data.details.length) { var detail = document.createElement("div"); detail.className = "detail"; detail.textContent = data.details.join(" · "); tip.appendChild(detail); }
      hl.style.left = region.x / sx + "px"; hl.style.top = region.y / sy + "px";
      hl.style.width = Math.max(4, region.w / sx) + "px"; hl.style.height = Math.max(4, region.h / sy) + "px";
      hl.style.display = "block";
    }
    tip.style.display = "block";
    var x = event.clientX + 14, y = event.clientY + 14;
    if (x + tip.offsetWidth > innerWidth - 8) x = event.clientX - tip.offsetWidth - 14;
    if (y + tip.offsetHeight > innerHeight - 8) y = event.clientY - tip.offsetHeight - 14;
    tip.style.left = Math.max(8, x) + "px"; tip.style.top = Math.max(8, y) + "px";
  }
  img.addEventListener("pointermove", show);
  img.addEventListener("pointerdown", show);
  img.addEventListener("pointerleave", hide);
  addEventListener("scroll", hide, { passive: true });
})();
`;

export function buildChartHtml(payload: ChartHtmlPayload): string {
  return `<!doctype html>
<html lang="en" data-theme="${payload.theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(payload.title)}</title>
<style>${STYLE}</style>
</head>
<body style="--bg: ${escapeHtml(payload.background)}">
<header><h1>${escapeHtml(payload.title)}</h1><p>${escapeHtml(payload.subtitle)}</p></header>
<main>
<div class="chart"><img src="${payload.image}" width="${payload.width}" height="${payload.height}" alt="${escapeHtml(payload.title)}"><div class="hl"></div></div>
<div class="tip" role="status"></div>
</main>
<footer>Hover over the chart for details. Made with TurboFuzz; works offline.</footer>
<script type="application/json" id="chart-data">${safeJson(payload)}</script>
<script>${SCRIPT}</script>
</body>
</html>
`;
}

/** What the export needs from the chart, drawn at the export size in the chosen theme. */
export interface ChartHtmlSource {
  title: string;
  subtitle: string;
  width: number;
  height: number;
  image: string;
  background: string;
  regions: HitRegion[];
  details: string[];
}

/** Remembered for the session: the choices for the next export of a chart with the same lines. */
let lastChoices: HoverChoices | null = null;

/**
 * The window before the download: which hover lines to show, what to call them, a note of the
 * analyst's own, and a live preview of one mark's hover.
 */
export function openChartHtmlDialog(source: ChartHtmlSource, theme: "light" | "dark", download: (html: string) => void): void {
  const fields = hoverFields(source.regions);
  const remembered = new Map((lastChoices?.fields ?? []).map((field) => [field.key, field] as const));
  const choices: HoverChoices = {
    fields: fields.map((field) => ({ ...field, show: remembered.get(field.key)?.show ?? true, rename: remembered.get(field.key)?.rename ?? "" })),
    note: lastChoices?.note ?? "",
    details: lastChoices?.details ?? true,
  };
  let title = source.title;

  const overlay = el("div", { class: "modal-overlay" });
  const modal = el("div", { class: "modal chart-html-modal" });
  const close = (): void => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    close();
  };
  const closeButton = el("button", { class: "icon-btn", type: "button", title: "Close (Esc)", "aria-label": "Close" }, ["×"]);
  closeButton.addEventListener("click", close);
  modal.append(el("div", { class: "modal-head" }, [el("h2", {}, ["Interactive web page"]), closeButton]));

  const body = el("div", { class: "chart-html-body" });
  const titleInput = el("input", { type: "text", value: title, "aria-label": "Page title" }) as HTMLInputElement;
  titleInput.addEventListener("input", () => {
    title = titleInput.value;
  });
  body.append(el("label", { class: "chart-html-title" }, [el("span", {}, ["Page title"]), titleInput]));

  body.append(el("h3", {}, ["Hover shows"]));
  const preview = el("div", { class: "chart-html-preview", "aria-live": "polite" });
  const sample = source.regions.find((region) => region.lines.length === Math.max(...source.regions.map((r) => r.lines.length))) ?? source.regions[0];
  const renderPreview = (): void => {
    preview.replaceChildren();
    const lines = sample === undefined ? [] : applyHover(sample.lines, choices);
    if (lines.length === 0) {
      preview.append(el("div", { class: "chart-html-preview-empty" }, ["Nothing: hovering shows no box"]));
      return;
    }
    preview.append(el("b", {}, [lines[0]!]), ...lines.slice(1).map((line) => el("div", {}, [line])));
    if (choices.details && source.details.length > 0) preview.append(el("div", { class: "chart-html-preview-detail" }, [source.details.join(" · ")]));
  };

  const list = el("div", { class: "chart-html-fields", role: "group", "aria-label": "Hover lines" });
  for (const field of choices.fields) {
    const box = el("input", { type: "checkbox", "aria-label": `Show ${field.label}` }) as HTMLInputElement;
    box.checked = field.show;
    const rename = el("input", { type: "text", placeholder: field.key === "name" ? "Label (optional)" : field.label, value: field.rename, "aria-label": `Call ${field.label}` }) as HTMLInputElement;
    box.addEventListener("change", () => {
      field.show = box.checked;
      rename.disabled = !box.checked;
      renderPreview();
    });
    rename.disabled = !field.show;
    rename.addEventListener("input", () => {
      field.rename = rename.value;
      renderPreview();
    });
    list.append(
      el("div", { class: "chart-html-field" }, [
        el("label", { class: "chart-html-field-name" }, [box, el("span", {}, [field.label])]),
        rename,
        el("span", { class: "chart-html-example", title: field.example }, [field.example]),
      ]),
    );
  }
  if (choices.fields.length === 0) list.append(el("p", { class: "chart-html-none" }, ["This chart has no hover details to choose from."]));
  body.append(el("div", { class: "chart-html-columns" }, [el("span", {}, ["Line"]), el("span", {}, ["Call it"]), el("span", {}, ["Example"])]), list);

  const note = el("input", { type: "text", value: choices.note, placeholder: "e.g. Source: sales ledger, July 2026", "aria-label": "Your own line under every hover" }) as HTMLInputElement;
  note.addEventListener("input", () => {
    choices.note = note.value;
    renderPreview();
  });
  body.append(el("label", { class: "chart-html-title" }, [el("span", {}, ["Add a line"]), note]));
  const details = el("input", { type: "checkbox" }) as HTMLInputElement;
  details.checked = choices.details;
  details.addEventListener("change", () => {
    choices.details = details.checked;
    renderPreview();
  });
  if (source.details.length > 0) {
    body.append(el("label", { class: "chart-html-check" }, [details, el("span", {}, [`Show the chart's facts too (${source.details.join(" · ")})`])]));
  }
  body.append(el("h3", {}, ["Preview"]), preview);
  renderPreview();
  modal.append(body);

  const cancel = el("button", { class: "ghost", type: "button" }, ["Cancel"]);
  cancel.addEventListener("click", close);
  const save = el("button", { class: "primary", type: "button", title: "One file with hover details that opens in any browser, with no internet" }, ["Download .html"]);
  save.addEventListener("click", () => {
    lastChoices = choices;
    download(
      buildChartHtml({
        title: title.trim() || source.title,
        subtitle: source.subtitle,
        width: source.width,
        height: source.height,
        image: source.image,
        background: source.background,
        theme,
        regions: source.regions.map((region) => ({ x: region.x, y: region.y, w: region.w, h: region.h, lines: applyHover(region.lines, choices) })),
        map: buildHitMap(source.regions, source.width, source.height),
        details: choices.details ? source.details : [],
      }),
    );
    close();
  });
  modal.append(el("div", { class: "clean-footer" }, [cancel, el("span", { class: "grow" }), save]));

  overlay.append(modal);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener("keydown", onKey);
  document.body.append(overlay);
  setupDialog(overlay, "Interactive web page");
  titleInput.focus();
}
