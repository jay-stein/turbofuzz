/**
 * The front page's livelier half: file-type icons under the drop area, a small
 * messy table that tidies itself on a loop ("Watch it tidy"), and a search box
 * that types misspelt football clubs until the person takes over ("Typos
 * welcome"). The search runs the table's own fuzzy index, so what it shows is
 * what the Table view's search does. Colour comes from the column-type palette.
 */

import { el } from "./dom.js";
import { buildStackGuide } from "./front-page.js";
import { FuzzyIndex } from "../search/fuzzy-index.js";
import { jaroWinkler } from "../search/jaro-winkler.js";
import { tokenize } from "../search/normalize.js";

const SVG_NS = "http://www.w3.org/2000/svg";

const reducedMotion = (): boolean => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** An element that is on screen: off-page or hidden demos stop spending timers. */
const showing = (node: HTMLElement): boolean => node.isConnected && node.offsetParent !== null && document.visibilityState !== "hidden";

const DOC_OUTLINE = '<path class="ft-page" d="M6 1.5h15l8 8V36a2.5 2.5 0 0 1-2.5 2.5h-20A2.5 2.5 0 0 1 4 36V4a2.5 2.5 0 0 1 2-2.5z"/><path class="ft-fold" d="M21 1.5v8h8"/>';
const FILE_TYPES: { kind: string; label: string; title: string; glyph: string }[] = [
  { kind: "csv", label: "CSV", title: "CSV, TSV and other delimited text", glyph: '<path class="ft-glyph-line" d="M9 9h12M9 12.5h12M9 16h8"/>' },
  { kind: "xlsx", label: "XLSX", title: "Excel workbooks (.xlsx, .xls)", glyph: '<path class="ft-glyph-line" d="M9 8h12M9 12h12M9 16h12M15 6v12"/>' },
  { kind: "json", label: "JSON", title: "JSON", glyph: '<text class="ft-glyph-text" x="15" y="16" text-anchor="middle">{ }</text>' },
  { kind: "parquet", label: "PARQ", title: "Parquet", glyph: '<path class="ft-glyph-fill" d="M9 7h3v10H9zM14 10h3v7h-3zM19 12h3v5h-3z"/>' },
  { kind: "zip", label: "ZIP", title: "Zipped or compressed (.zip, .gz, .bz2)", glyph: '<path class="ft-glyph-fill" d="M14 3h2v2h-2zM12 5h2v2h-2zM14 7h2v2h-2zM12 9h2v2h-2zM14 11h2v2h-2zM12 13h2v2h-2z"/>' },
];

/** The row of file icons the drop area takes (and a clipboard for pasted rows). */
export function buildFileTypeIcons(): HTMLElement {
  const row = el("div", { class: "ft-row", role: "img", "aria-label": "Opens CSV, Excel, JSON, Parquet and zipped files, or pasted rows" });
  const icon = (kind: string, title: string, body: string): SVGElement => {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", `ft-icon ft-${kind}`);
    svg.setAttribute("viewBox", "0 0 32 40");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = `<title>${title}</title>${body}`;
    return svg;
  };
  for (const type of FILE_TYPES) {
    const label = `<rect class="ft-band" x="1" y="20" width="25" height="11" rx="2.5"/><text class="ft-label${type.label.length > 3 ? " long" : ""}" x="13.5" y="28.2" text-anchor="middle">${type.label}</text>`;
    row.append(icon(type.kind, type.title, DOC_OUTLINE + type.glyph + label));
  }
  row.append(icon("paste", "Pasted rows", '<rect class="ft-page" x="5" y="5" width="22" height="33" rx="3"/><rect class="ft-page" x="10.5" y="2" width="11" height="6" rx="2"/><path class="ft-glyph-line" d="M10 15h12M10 20h12M10 25h8"/>'));
  return row;
}

// ---------- Watch it tidy ----------

type Kind = "text" | "num" | "date";
interface Cell { value: string; kind: Kind; state?: "fresh" | "flag" | "gone"; note?: string }

const FIXES: { text: string; flag: boolean }[] = [
  { text: "Trimmed stray spaces and fixed capitals", flag: false },
  { text: "Read 1,234.5O as the number 1,234.50", flag: false },
  { text: "Flagged 9999 as a stand-in for missing", flag: true },
  { text: "Found two rows that are the same sale", flag: false },
  { text: "Caught a date that cannot exist (month 13)", flag: true },
];

/** The demo table after `step` fixes (0 = as dropped, 5 = all done). */
function tidyRows(step: number): Cell[][] {
  const at = (n: number): boolean => step >= n;
  const now = (n: number): "fresh" | undefined => (step === n ? "fresh" : undefined);
  const rows: Cell[][] = [
    [
      { value: at(1) ? "Ann Lee" : " ann lee ", kind: "text", state: now(1) },
      { value: at(1) ? "New York" : "new york ", kind: "text", state: now(1) },
      { value: at(2) ? "1,234.50" : "1,234.5O", kind: "num", state: now(2) },
      { value: "2024-04-03", kind: "date" },
    ],
  ];
  if (step < 5) {
    const gone = step === 4 ? "gone" : undefined;
    rows.push([
      { value: "Ann  Lee", kind: "text", state: gone },
      { value: "New York", kind: "text", state: gone },
      { value: "1,234.50", kind: "num", state: gone },
      { value: "2024-04-03", kind: "date", state: gone },
    ]);
  }
  rows.push(
    [
      { value: at(1) ? "Bo Wu" : "BO WU", kind: "text", state: now(1) },
      { value: at(1) ? "San Jose" : "san jose", kind: "text", state: now(1) },
      at(3) ? { value: "—", kind: "num", state: "flag", note: "missing" } : { value: "9999", kind: "num" },
      at(5) ? { value: "2024-13-01", kind: "date", state: "flag", note: "no month 13" } : { value: "2024-13-01", kind: "date" },
    ],
    [
      { value: "Cy Diaz", kind: "text" },
      { value: "Austin", kind: "text" },
      { value: "88.00", kind: "num" },
      { value: "2024-02-11", kind: "date" },
    ],
  );
  return rows;
}

/** "Watch it tidy": one fix per beat, a pause on the finished table, then round again. */
export function buildTidyDemo(): HTMLElement {
  const count = el("span", { class: "tidy-count" });
  const grid = el("div", { class: "tidy-grid", role: "table", "aria-label": "A small messy table being tidied" });
  const list = el("ol", { class: "tidy-steps" });
  const card = el("section", { class: "tidy-card", "aria-labelledby": "tidy-title" }, [
    el("div", { class: "tidy-head" }, [el("h2", { id: "tidy-title" }, ["Watch it tidy"]), el("span", { class: "tidy-file" }, ["sales_export.csv"]), el("span", { class: "grow" }), count]),
    grid,
    list,
  ]);
  const heads: [string, Kind, string][] = [["customer", "text", "text"], ["city", "text", "text"], ["amount", "num", "number"], ["date", "date", "date"]];
  const draw = (step: number): void => {
    const shown = Math.min(step, FIXES.length);
    grid.replaceChildren(
      el("div", { class: "tidy-row tidy-row-head", role: "row" }, heads.map(([name, kind, label]) =>
        el("span", { class: "tidy-th", role: "columnheader" }, [el("span", { class: "tidy-th-name" }, [name]), el("span", { class: `tidy-type ty-${kind}` }, [label])]))),
      ...tidyRows(shown).map((row) =>
        el("div", { class: "tidy-row", role: "row" }, row.map((cell) =>
          el("span", { class: `tidy-cell k-${cell.kind}${cell.state === undefined ? "" : ` ${cell.state}`}`, role: "cell" }, [
            cell.value,
            ...(cell.note === undefined ? [] : [el("span", { class: "tidy-note" }, [cell.note])]),
          ])))),
    );
    list.replaceChildren(...FIXES.map((fix, i) => {
      const done = shown >= i + 1;
      return el("li", { class: `${done ? "done" : ""}${shown === i + 1 ? " current" : ""}${fix.flag ? " flag" : ""}`.trim() }, [el("span", { class: "tidy-dot", "aria-hidden": "true" }), fix.text]);
    }));
    count.textContent = `${shown} fix${shown === 1 ? "" : "es"}`;
  };
  // Reduced motion: the finished table, still.
  if (reducedMotion()) {
    draw(FIXES.length);
    return card;
  }
  let step = 0;
  draw(0);
  const beat = (): void => {
    if (showing(card)) {
      step = (step + 1) % (FIXES.length + 3);
      draw(step);
    }
    window.setTimeout(beat, 1700);
  };
  window.setTimeout(beat, 1700);
  return card;
}

// ---------- Typos welcome ----------

/** Champions League clubs spelt the different ways they turn up in real spreadsheets. */
const CLUBS = [
  "Real Madrid CF", "Real Madrid C.F.", "FC Barcelona", "Barça", "FC Bayern München", "Bayern Munich",
  "Manchester City", "Man. City FC", "Paris Saint-Germain", "Internazionale Milano", "Inter Milan", "AC Milan",
  "Juventus FC", "Borussia Dortmund", "B. Dortmund", "Atlético de Madrid", "Atletico Madrid", "Liverpool FC",
  "Arsenal FC", "SL Benfica", "FC Porto", "Bayer 04 Leverkusen", "AFC Ajax", "PSV Eindhoven", "Celtic FC", "Tottenham Hotspur",
];

/** What the box types by itself until someone clicks in. Each finds every spelling of its club. */
const DEMO_QUERIES = ["bayern munchen", "atletico madird", "dortmnd", "man city", "real madird", "liverpol", "juventis"];

const SHOWN = 5;

/**
 * How close a club is to the query: for each typed word, its best Jaro-Winkler
 * score against the club's words, averaged. Only for ordering and the bars; the
 * index decides what matches.
 */
function closeness(queryTokens: string[], clubTokens: string[]): number {
  if (queryTokens.length === 0 || clubTokens.length === 0) return 0;
  let total = 0;
  for (const q of queryTokens) {
    let best = 0;
    for (const t of clubTokens) best = Math.max(best, t.length > q.length && t.startsWith(q) ? 1 : jaroWinkler(q, t));
    total += best;
  }
  return total / queryTokens.length;
}

/** "Typos welcome": a live fuzzy search over club names, with a demo that types until the person does. */
export function buildTypoDemo(): HTMLElement {
  const index = new FuzzyIndex();
  index.build(CLUBS);
  const clubTokens = CLUBS.map((name) => tokenize(name));

  const input = el("input", {
    id: "typo-demo-q", class: "typo-input", type: "text", autocomplete: "off", spellcheck: "false",
    placeholder: "start typing a club…", "aria-describedby": "typo-demo-meta",
  }) as HTMLInputElement;
  const badge = el("span", { class: "typo-badge", "aria-hidden": "true" }, ["demo typing"]);
  const prompt = el("span", { class: "typo-prompt-text" }, ["Your turn: click here and type a club, typos and all"]);
  const meta = el("span", { id: "typo-demo-meta", class: "typo-meta", "aria-live": "polite" });
  const results = el("ul", { class: "typo-results", "aria-label": "Clubs that match" });
  const section = el("section", { class: "typo-card demo", "aria-labelledby": "typo-demo-title" }, [
    el("div", { class: "typo-side" }, [
      el("div", { class: "typo-title-row" }, [el("h2", { id: "typo-demo-title" }, ["Typos welcome"]), el("span", { class: "typo-lede" }, ["Search finds what you meant, not just what you typed."])]),
      el("label", { class: "typo-prompt", for: "typo-demo-q" }, [el("span", { class: "typo-pulse", "aria-hidden": "true" }), prompt]),
      el("span", { class: "typo-field" }, [input, badge]),
      meta,
    ]),
    results,
  ]);

  const render = (): void => {
    const query = input.value;
    const started = performance.now();
    const queryTokens = tokenize(query);
    const matched = new Set<number>();
    if (queryTokens.length > 0) index.search(query).rowBits.forEachRow((row) => matched.add(row));
    const ranked = CLUBS.map((name, row) => ({ name, row, hit: matched.has(row), score: closeness(queryTokens, clubTokens[row]!) }))
      .sort((a, b) => Number(b.hit) - Number(a.hit) || b.score - a.score)
      .slice(0, SHOWN);
    const ms = performance.now() - started;
    results.replaceChildren(...ranked.map((club) => {
      const bar = el("span", { class: "typo-bar-fill" });
      // Only a match gets a bar: a long grey bar on a club that did not match reads as "nearly".
      bar.style.width = `${club.hit ? Math.round(club.score * 100) : 0}%`;
      return el("li", { class: club.hit ? "hit" : "" }, [
        el("span", { class: "typo-name" }, [club.name]),
        el("span", { class: "typo-bar" }, [bar]),
        el("span", { class: "typo-verdict" }, [club.hit ? "match" : ""]),
      ]);
    }));
    meta.textContent = queryTokens.length === 0
      ? `${CLUBS.length} club names, spelt every which way`
      : `${matched.size} of ${CLUBS.length} names match · ${ms < 0.1 ? "<0.1" : ms.toFixed(1)} ms · the same search as the Table view`;
  };

  // Ghost typing: type a misspelt club, hold, erase, next, until the person takes over.
  let demo = !reducedMotion();
  let timer = 0;
  const typeDemo = (word: number, length: number, direction: 1 | -1): void => {
    if (!demo) return;
    if (!showing(section)) {
      timer = window.setTimeout(() => typeDemo(word, length, direction), 800);
      return;
    }
    const target = DEMO_QUERIES[word % DEMO_QUERIES.length]!;
    input.value = target.slice(0, length);
    render();
    if (direction === 1 && length >= target.length) timer = window.setTimeout(() => typeDemo(word, length, -1), 1900);
    else if (direction === -1 && length <= 0) timer = window.setTimeout(() => typeDemo(word + 1, 1, 1), 350);
    else timer = window.setTimeout(() => typeDemo(word, length + direction, direction), direction === 1 ? 95 : 35);
  };
  const takeOver = (): void => {
    if (!demo) return;
    demo = false;
    window.clearTimeout(timer);
    input.value = "";
    section.classList.remove("demo");
    badge.textContent = "live";
    prompt.textContent = "Keep going: misspell it, drop the accents, abbreviate";
    render();
  };
  input.addEventListener("focus", takeOver);
  input.addEventListener("input", render);
  if (demo) typeDemo(0, 1, 1);
  else {
    section.classList.remove("demo");
    badge.textContent = "live";
    input.value = DEMO_QUERIES[0]!;
    render();
  }
  return section;
}

/**
 * The front page laid out: the card with the drop area beside the tidy demo, the typo
 * search under both, then how several files stack (one-table mode only, see the CSS).
 */
export function buildFrontHero(card: HTMLElement): HTMLElement {
  return el("div", { class: "front-hero" }, [el("div", { class: "front-hero-top" }, [card, buildTidyDemo()]), buildTypoDemo(), el("div", { class: "front-stack-card" }, [buildStackGuide()])]);
}
