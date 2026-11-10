import { DEFAULT_RULES, type CompareRules } from "../../data/compare/types.js";
import type { KeyColumnStat, KeySuggestion } from "../../data/compare/keys.js";
import { TYPE_LABELS } from "../../types.js";
import type { CompareSetupMessage, CompareSideInfo } from "../../worker/protocol.js";
import { el, svgIcon } from "../dom.js";
import { TYPE_FAMILY, TYPE_GLYPHS } from "../type-glyphs.js";

/** How rows are matched: on these column pairs (indexes into the pairing), or on whole rows. */
export type KeyChoice = { kind: "pairs"; pairs: number[] } | { kind: "content" } | { kind: "position" };

export interface SetupState {
  /** A when it is the data already loaded (it cannot be changed here). */
  aLoaded: boolean;
  a: CompareSideInfo | null;
  b: CompareSideInfo | null;
  setup: CompareSetupMessage | null;
  manual: { a: number; b: number }[];
  /** Columns left out of the comparison, by index into each side. */
  ignore: { a: number[]; b: number[] };
  key: KeyChoice;
  rules: CompareRules;
  /** What is being read right now ("Reading orders.csv…"), or null. */
  busy: string | null;
  error: string | null;
}

export interface SetupActions {
  pickA(file: File): void;
  pickB(file: File): void;
  /** Two files dropped at once: the earlier name is A, the later B. */
  pickBoth(a: File, b: File): void;
  setManual(manual: { a: number; b: number }[]): void;
  setIgnore(ignore: { a: number[]; b: number[] }): void;
  setKey(key: KeyChoice): void;
  setRules(rules: CompareRules): void;
  run(): void;
}

import { SOURCE_FILE_TYPES as FILE_TYPES } from "../source-resolver.js";
export { FILE_TYPES };

const nf = new Intl.NumberFormat("en");

function typeChip(type: CompareSideInfo["columns"][number]["type"]): HTMLElement {
  return el("span", { class: "cmp-type", "data-fam": TYPE_FAMILY[type], title: TYPE_LABELS[type] }, [TYPE_GLYPHS[type]]);
}

function keyLabel(setup: CompareSetupMessage, pairs: readonly number[]): string {
  return pairs.map((index) => setup.a.columns[setup.pairing.pairs[index]?.a ?? -1]?.name ?? "?").join(" + ");
}

function problemText(key: KeySuggestion): string {
  const p = key.problems;
  const parts: string[] = [];
  for (const [side, empty, repeated] of [["A", p.emptyA, p.duplicateA], ["B", p.emptyB, p.duplicateB]] as const) {
    const bits = [empty > 0 ? `${nf.format(empty)} empty` : "", repeated > 0 ? `${nf.format(repeated)} repeated` : ""].filter(Boolean);
    if (bits.length > 0) parts.push(`${bits.join(" and ")} in ${side}`);
  }
  return parts.join("; ");
}

/** One side's card: the file, its size, and a way to choose or change it. */
function sideCard(
  letter: "A" | "B",
  info: CompareSideInfo | null,
  note: string,
  canPick: boolean,
  pick: (file: File) => void,
): HTMLElement {
  const empty = info === null && canPick;
  const card = el("div", { class: `cmp-side cmp-side-${letter.toLowerCase()}${empty ? " cmp-drop" : ""}` });
  const input = el("input", { type: "file", accept: FILE_TYPES, class: "hidden", "aria-label": `Choose the file for ${letter}` }) as HTMLInputElement;
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file !== undefined) pick(file);
    input.value = "";
  });
  const role = letter === "A" ? "before" : "after";
  if (empty) {
    // No file yet: the whole card is a drop target, and says so.
    const button = el("button", { class: "primary small", type: "button" }, ["Choose file…"]);
    button.addEventListener("click", () => input.click());
    card.append(
      el("span", { class: "cmp-drop-icon", "aria-hidden": "true" }, [svgIcon('<path d="M12 15V4M7 9l5-5 5 5"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>', "cmp-drop-svg")]),
      el("span", { class: "cmp-drop-title" }, [el("span", { class: "cmp-letter", "aria-hidden": "true" }, [letter]), `Drop the ${role} file here`]),
      el("span", { class: "cmp-drop-sub" }, ["CSV, TSV, JSON or Parquet"]),
      button,
      input,
    );
  }
  const body = el("div", { class: "cmp-side-body" }, [
    el("span", { class: "cmp-side-role" }, [letter === "A" ? "Before" : "After"]),
  ]);
  if (info === null) {
    body.append(el("span", { class: "cmp-side-empty" }, ["No file yet"]));
  } else {
    body.append(
      el("span", { class: "cmp-side-name", title: info.name }, [info.name]),
      el("span", { class: "cmp-side-meta" }, [`${nf.format(info.rowCount)} rows × ${info.columns.length} columns${note === "" ? "" : ` · ${note}`}`]),
    );
  }
  if (!empty) card.append(el("span", { class: "cmp-letter", "aria-hidden": "true" }, [letter]), body);
  if (canPick) {
    if (!empty) {
      const button = el("button", { class: "ghost small", type: "button" }, ["Change…"]);
      button.addEventListener("click", () => input.click());
      card.append(button, input);
    }
    card.addEventListener("dragover", (event) => {
      if (!Array.from(event.dataTransfer?.types ?? []).includes("Files")) return;
      event.preventDefault();
      card.classList.add("dragging");
    });
    card.addEventListener("dragleave", () => card.classList.remove("dragging"));
    card.addEventListener("drop", (event) => {
      const files = event.dataTransfer?.files;
      card.classList.remove("dragging");
      // Two files at once are handled by the page: one for each side.
      if (files === undefined || files.length !== 1) return;
      event.preventDefault();
      event.stopPropagation();
      pick(files[0]!);
    });
  }
  return card;
}

function section(title: string, aside?: string): HTMLElement {
  const head = el("div", { class: "cmp-section-head" }, [el("h2", { class: "cmp-section-title" }, [title])]);
  if (aside !== undefined) head.append(el("span", { class: "cmp-section-aside" }, [aside]));
  return el("section", { class: "cmp-card" }, [head]);
}

const VERDICT_LABEL: Record<KeyColumnStat["verdict"], string> = { good: "Good key", fair: "Could work", poor: "Poor key" };
const VERDICT_RANK: Record<KeyColumnStat["verdict"], number> = { good: 0, fair: 1, poor: 2 };

/** What share of a side's rows hold a value seen only once there. */
function uniqueShare(rows: number, empty: number, repeat: number): string {
  const filled = rows - empty;
  if (filled <= 0) return "—";
  const share = ((filled - repeat) / filled) * 100;
  return share >= 99.95 ? "100%" : `${share.toFixed(share >= 99 ? 1 : 0)}%`;
}

/**
 * "Another column": every paired column with what it would be like as the key,
 * best first. Each row says how unique and filled it is on each side and how
 * many of B's values A has, with a verdict and the reason, so a column can be
 * chosen knowing why it would or would not match rows well.
 */
function keyColumnList(setup: CompareSetupMessage, stats: readonly KeyColumnStat[], chosen: number | null, choose: (pair: number) => void): HTMLElement {
  const sorted = [...stats].sort((x, y) => VERDICT_RANK[x.verdict] - VERDICT_RANK[y.verdict] || y.shared / Math.max(1, y.filled) - x.shared / Math.max(1, x.filled) || x.pair - y.pair);
  const table = el("table", { class: "cmp-keycols" });
  table.append(
    el("thead", {}, [
      el("tr", {}, [
        el("th", { scope: "col" }, ["Column"]),
        el("th", { scope: "col", class: "num", title: "Share of filled rows whose value appears only once on that side" }, ["Unique A · B"]),
        el("th", { scope: "col", class: "num", title: "Rows with no value, which can't be matched" }, ["Empty"]),
        el("th", { scope: "col", class: "num", title: "Share of B's values that A has too" }, ["B in A"]),
        el("th", { scope: "col" }, ["As a key"]),
      ]),
    ]),
  );
  const body = el("tbody");
  for (const stat of sorted) {
    const pair = setup.pairing.pairs[stat.pair];
    if (pair === undefined) continue;
    const nameA = setup.a.columns[pair.a]?.name ?? "?";
    const nameB = setup.b.columns[pair.b]?.name ?? "?";
    const selected = chosen === stat.pair;
    const pick = el("button", { type: "button", class: "cmp-keycol-pick", "aria-pressed": String(selected), title: `Match rows on ${nameA}` }, [
      selected ? el("span", { class: "cmp-keycol-tick", "aria-hidden": "true" }, ["✓ "]) : "",
      nameA,
      nameA === nameB ? "" : el("span", { class: "cmp-keycol-alias" }, [` ↔ ${nameB}`]),
    ]);
    pick.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      choose(stat.pair);
    });
    const empty = stat.emptyA + stat.emptyB;
    body.append(
      el("tr", { class: `cmp-keycol${selected ? " selected" : ""}`, "data-verdict": stat.verdict }, [
        el("td", {}, [pick]),
        el("td", { class: "num" }, [`${uniqueShare(stat.rowsA, stat.emptyA, stat.repeatA)} · ${uniqueShare(stat.rowsB, stat.emptyB, stat.repeatB)}`]),
        el("td", { class: "num" }, [empty === 0 ? "none" : nf.format(empty)]),
        el("td", { class: "num" }, [stat.filled === 0 ? "—" : `${Math.round((stat.shared / stat.filled) * 100)}%`]),
        el("td", { class: "cmp-keycol-why" }, [el("span", { class: `cmp-verdict ${stat.verdict}` }, [VERDICT_LABEL[stat.verdict]]), el("span", { class: "cmp-keycol-reason" }, [stat.reason])]),
      ]),
    );
  }
  table.append(body);
  const wrap = el("div", { class: "cmp-keycols-wrap" }, [table]);
  wrap.addEventListener("click", (event) => event.stopPropagation());
  const sampled = stats.some((stat) => stat.sampled);
  return el("div", { class: "cmp-keycols-box" }, [
    wrap,
    sampled ? el("p", { class: "cmp-keycol-note" }, [`Worked out on the first ${nf.format(Math.max(...stats.map((stat) => Math.max(stat.rowsA, stat.rowsB))))} rows of each side.`]) : "",
  ]);
}

/** "Match rows on": the suggested keys, any other paired column, or whole rows. */
function keySection(state: SetupState, setup: CompareSetupMessage, actions: SetupActions): HTMLElement {
  const box = section("Match rows on");
  box.id = "cmp-match-rows";
  const list = el("div", { class: "cmp-keys", role: "radiogroup", "aria-label": "Match rows on" });
  const current = state.key;
  const same = (pairs: readonly number[]): boolean =>
    current.kind === "pairs" && current.pairs.length === pairs.length && current.pairs.every((p, i) => p === pairs[i]);
  const option = (checked: boolean, title: string, detail: string, aside: string, choose: () => void, extra?: HTMLElement): HTMLElement => {
    const radio = el("input", { type: "radio", name: "cmp-key" }) as HTMLInputElement;
    radio.checked = checked;
    radio.addEventListener("change", choose);
    const text = el("span", { class: "cmp-key-text" }, [el("span", { class: "cmp-key-title" }, [title])]);
    if (detail !== "") text.append(el("span", { class: "cmp-key-detail" }, [detail]));
    if (extra !== undefined) text.append(extra);
    return el("label", { class: `cmp-key${checked ? " checked" : ""}` }, [radio, text, el("span", { class: "cmp-key-aside" }, [aside])]);
  };
  setup.keys.slice(0, 3).forEach((key, index) => {
    const problems = problemText(key);
    const title = keyLabel(setup, key.pairs);
    const row = option(
      same(key.pairs),
      title,
      `${key.pairs.length > 1 ? "Together unique" : "Unique"} in both. ${nf.format(key.shared)} of the ${nf.format(key.filled)} keys in B are also in A.${problems === "" ? "" : ` Not counted: ${problems}.`}`,
      `${(key.overlap * 100).toFixed(1)}% shared`,
      () => actions.setKey({ kind: "pairs", pairs: key.pairs }),
    );
    if (index === 0) row.querySelector(".cmp-key-title")?.append(el("span", { class: "cmp-pill" }, ["Suggested"]));
    list.append(row);
  });
  // Any other paired column, chosen by hand.
  const suggested = new Set(setup.keys.slice(0, 3).map((key) => key.pairs.join(",")));
  const custom = current.kind === "pairs" && !suggested.has(current.pairs.join(","));
  const select = el("select", { class: "cmp-select", "aria-label": "Key column" }) as HTMLSelectElement;
  select.append(el("option", { value: "" }, ["Choose a column…"]) as HTMLOptionElement);
  setup.pairing.pairs.forEach((pair, index) => {
    select.append(el("option", { value: String(index) }, [setup.a.columns[pair.a]?.name ?? "?"]) as HTMLOptionElement);
  });
  if (custom && current.kind === "pairs" && current.pairs.length === 1) select.value = String(current.pairs[0]);
  select.addEventListener("change", () => {
    if (select.value !== "") actions.setKey({ kind: "pairs", pairs: [Number(select.value)] });
  });
  select.addEventListener("click", (event) => event.stopPropagation());
  // With the columns judged, they are listed with why each would or would not work; otherwise a plain list.
  const stats = setup.keyStats ?? [];
  // The table ticks the key column whichever way it was chosen (a suggestion or by hand).
  const chosenPair = current.kind === "pairs" && current.pairs.length === 1 ? current.pairs[0]! : null;
  const firstGood = [...stats].sort((x, y) => VERDICT_RANK[x.verdict] - VERDICT_RANK[y.verdict])[0];
  list.append(
    option(custom, "Another column", stats.length > 0 ? "Its values should be unique and filled on both sides, and B's values should be in A. Each column is judged below: pick one there." : "Its values should be unique and filled on both sides.", "", () => {
      if (stats.length > 0) {
        if (!custom && firstGood !== undefined) actions.setKey({ kind: "pairs", pairs: [firstGood.pair] });
      } else if (select.value !== "") actions.setKey({ kind: "pairs", pairs: [Number(select.value)] });
      else select.focus();
    }, stats.length > 0 ? undefined : select),
  );
  // The judged columns sit under the option, outside its label, so each is its own button.
  if (stats.length > 0) list.append(keyColumnList(setup, stats, chosenPair, (pair) => actions.setKey({ kind: "pairs", pairs: [pair] })));
  list.append(
    option(
      current.kind === "position",
      "Match rows on position",
      "Row 1 of A meets row 1 of B, and so on. For files with the same shape and order, where only values change.",
      `${nf.format(setup.a.rowCount)} and ${nf.format(setup.b.rowCount)} rows`,
      () => actions.setKey({ kind: "position" }),
    ),
    option(
      current.kind === "content",
      "No key: match whole rows",
      "Rows pair up only when every paired cell agrees, so a change shows as a row removed and a row added.",
      "",
      () => actions.setKey({ kind: "content" }),
    ),
  );
  if (setup.keys.length === 0) {
    box.append(el("p", { class: "cmp-note warn" }, ["No column is filled and unique on both sides, so no key is suggested. Choose one, or match whole rows."]));
  }
  box.append(list);
  return box;
}

/** "Columns": each column with a tick for whether it is compared, renames made by hand, and the columns only one side has. */
function columnSection(state: SetupState, setup: CompareSetupMessage, actions: SetupActions): HTMLElement {
  const { pairing } = setup;
  const manualCount = pairing.pairs.filter((pair) => pair.manual).length;
  const box = section(
    "Columns",
    `${pairing.pairs.length - manualCount} paired by name${manualCount > 0 ? ` · ${manualCount} by hand` : ""}${pairing.onlyA.length > 0 ? ` · ${pairing.onlyA.length} only in A` : ""}${pairing.onlyB.length > 0 ? ` · ${pairing.onlyB.length} only in B` : ""}${pairing.ignored.length > 0 ? ` · ${pairing.ignored.length} not compared` : ""}`,
  );
  const keyPairs = new Set(state.key.kind === "pairs" ? state.key.pairs : []);
  const table = el("table", { class: "cmp-columns" });
  table.append(
    el("thead", {}, [
      el("tr", {}, [
        el("th", { scope: "col" }, ["Compare"]),
        el("th", { scope: "col" }, ["In A"]),
        el("th", { scope: "col" }, [el("span", { class: "sr-only" }, ["Pairs with"])]),
        el("th", { scope: "col" }, ["In B"]),
        el("th", { scope: "col" }, ["Note"]),
      ]),
    ]),
  );
  const body = el("tbody");
  const cell = (info: CompareSideInfo, index: number): HTMLElement => {
    const column = info.columns[index]!;
    return el("td", {}, [el("span", { class: "cmp-col" }, [typeChip(column.type), el("span", { class: "cmp-col-name" }, [column.name])])]);
  };
  const dash = (): HTMLElement => el("td", { class: "cmp-dim" }, ["—"]);
  const arrow = (text: string): HTMLElement => el("td", { class: "cmp-arrow", "aria-hidden": "true" }, [text]);
  /** The tick that says whether a column is compared; unticking leaves it out (both sides of a pair), ticking brings it back. */
  const compareBox = (a: number, b: number, name: string, on: boolean): HTMLElement => {
    const input = el("input", { type: "checkbox", "aria-label": `Compare ${name}` }) as HTMLInputElement;
    input.checked = on;
    input.addEventListener("change", () => {
      const without = (list: number[], index: number): number[] => list.filter((i) => i !== index);
      actions.setIgnore(
        input.checked
          ? { a: without(state.ignore.a, a), b: without(state.ignore.b, b) }
          : { a: a < 0 ? state.ignore.a : [...state.ignore.a, a], b: b < 0 ? state.ignore.b : [...state.ignore.b, b] },
      );
    });
    return el("td", { class: "cmp-tick" }, [input]);
  };
  const nameOf = (a: number, b: number): string => (a >= 0 ? setup.a.columns[a]!.name : setup.b.columns[b]!.name);

  // Paired columns, with the ones left out kept in place (dimmed, unticked) so they can be ticked again.
  type PairRow = { a: number; b: number; pair: number } | { a: number; b: number; pair: -1 };
  const paired: PairRow[] = [
    ...pairing.pairs.map((pair, index) => ({ a: pair.a, b: pair.b, pair: index })),
    ...pairing.ignored.filter((entry) => entry.a >= 0 && entry.b >= 0).map((entry) => ({ a: entry.a, b: entry.b, pair: -1 as const })),
  ].sort((x, y) => x.a - y.a);
  for (const row of paired) {
    const a = setup.a.columns[row.a]!;
    const b = setup.b.columns[row.b]!;
    if (row.pair < 0) {
      body.append(
        el("tr", { class: "cmp-off" }, [
          compareBox(row.a, row.b, a.name, false),
          cell(setup.a, row.a),
          arrow("↔"),
          cell(setup.b, row.b),
          el("td", { class: "cmp-col-note" }, ["Not compared"]),
        ]),
      );
      continue;
    }
    const pair = pairing.pairs[row.pair]!;
    const notes: string[] = [];
    let tone = "";
    if (keyPairs.has(row.pair)) {
      notes.push("Key");
      tone = "key";
    }
    if (pair.manual) notes.push("Paired by hand");
    else if (a.name !== b.name) notes.push("Name differs only in case or spacing");
    if (a.type !== b.type) {
      notes.push(`Type: ${TYPE_LABELS[a.type]} → ${TYPE_LABELS[b.type]}`);
      if (tone === "") tone = "warn";
    }
    const note = el("td", { class: `cmp-col-note ${tone}` }, [notes.join(" · ")]);
    if (pair.manual) {
      const unpair = el("button", { class: "link", type: "button" }, ["Unpair"]);
      unpair.addEventListener("click", () => actions.setManual(state.manual.filter((m) => m.a !== pair.a || m.b !== pair.b)));
      note.append(" ", unpair);
    }
    body.append(el("tr", {}, [compareBox(pair.a, pair.b, a.name, true), cell(setup.a, pair.a), arrow("↔"), cell(setup.b, pair.b), note]));
  }

  // Columns only A has, then only B has.
  const onlyA = [...pairing.onlyA.map((index) => ({ index, on: true })), ...pairing.ignored.filter((entry) => entry.a >= 0 && entry.b < 0).map((entry) => ({ index: entry.a, on: false }))].sort((x, y) => x.index - y.index);
  for (const { index, on } of onlyA) {
    const pick = el("select", { class: "cmp-select", "aria-label": `Pair ${setup.a.columns[index]!.name} with a column of B` }) as HTMLSelectElement;
    pick.append(el("option", { value: "" }, ["Pair with…"]) as HTMLOptionElement);
    for (const other of pairing.onlyB) pick.append(el("option", { value: String(other) }, [setup.b.columns[other]!.name]) as HTMLOptionElement);
    pick.disabled = pairing.onlyB.length === 0;
    pick.addEventListener("change", () => {
      if (pick.value !== "") actions.setManual([...state.manual, { a: index, b: Number(pick.value) }]);
    });
    body.append(
      el("tr", { class: on ? "only-a" : "only-a cmp-off" }, [
        compareBox(index, -1, nameOf(index, -1), on),
        cell(setup.a, index),
        arrow(""),
        on ? el("td", {}, [pick]) : dash(),
        el("td", { class: on ? "cmp-col-note gone" : "cmp-col-note" }, [on ? "Only in A" : "Only in A · not compared"]),
      ]),
    );
  }
  const onlyB = [...pairing.onlyB.map((index) => ({ index, on: true })), ...pairing.ignored.filter((entry) => entry.a < 0 && entry.b >= 0).map((entry) => ({ index: entry.b, on: false }))].sort((x, y) => x.index - y.index);
  for (const { index, on } of onlyB) {
    body.append(
      el("tr", { class: on ? "only-b" : "only-b cmp-off" }, [
        compareBox(-1, index, nameOf(-1, index), on),
        dash(),
        arrow(""),
        cell(setup.b, index),
        el("td", { class: on ? "cmp-col-note added" : "cmp-col-note" }, [on ? "Only in B" : "Only in B · not compared"]),
      ]),
    );
  }
  table.append(body);
  box.append(el("div", { class: "cmp-table-wrap" }, [table]));
  return box;
}

/** "Values count as equal when": number tolerance, case, spaces, empty cells. */
function rulesSection(state: SetupState, actions: SetupActions): HTMLElement {
  const box = section("Values count as equal when");
  const rules = state.rules;
  const number = (label: string, value: number, scale: number, apply: (n: number) => CompareRules): HTMLElement => {
    const input = el("input", { class: "text-input cmp-number", type: "text", inputmode: "decimal", value: String(value * scale), spellcheck: "false" }) as HTMLInputElement;
    input.addEventListener("change", () => {
      const parsed = Number(input.value.trim() === "" ? "0" : input.value.trim());
      if (Number.isFinite(parsed) && parsed >= 0) actions.setRules(apply(parsed / scale));
      else input.value = String(value * scale);
    });
    return el("label", { class: "cmp-field" }, [el("span", {}, [label]), input]);
  };
  const check = (label: string, on: boolean, apply: (v: boolean) => CompareRules): HTMLElement => {
    const input = el("input", { type: "checkbox" }) as HTMLInputElement;
    input.checked = on;
    input.addEventListener("change", () => actions.setRules(apply(input.checked)));
    return el("label", { class: "cmp-check" }, [input, label]);
  };
  box.append(
    el("div", { class: "cmp-fields" }, [
      number("Numbers within ±", rules.numberAbs, 1, (n) => ({ ...rules, numberAbs: n })),
      number("or within (%)", rules.numberRel, 100, (n) => ({ ...rules, numberRel: n })),
    ]),
    check("Ignore upper / lower case", rules.ignoreCase, (v) => ({ ...rules, ignoreCase: v })),
    check("Ignore extra spaces", rules.trimSpaces, (v) => ({ ...rules, trimSpaces: v })),
    check("An empty cell equals an empty cell", rules.emptyEqualsEmpty, (v) => ({ ...rules, emptyEqualsEmpty: v })),
    el("p", { class: "cmp-note" }, [
      "Dates and times must match exactly. A column that holds numbers on one side and text on the other compares as text.",
    ]),
  );
  if (JSON.stringify(rules) !== JSON.stringify(DEFAULT_RULES)) {
    const reset = el("button", { class: "link", type: "button" }, ["Back to the defaults"]);
    reset.addEventListener("click", () => actions.setRules(DEFAULT_RULES));
    box.append(reset);
  }
  return box;
}

/** The setup screen: both sides, how rows and columns line up, and when values count as equal. */
export function renderSetup(host: HTMLElement, state: SetupState, actions: SetupActions): void {
  const page = el("div", { class: "cmp-page" });
  const ready = state.a !== null && state.b !== null;
  page.append(
    el("div", { class: "cmp-intro" }, [
      el("h1", {}, ["Compare two datasets"]),
      el("p", {}, [
        ready
          ? "Check how rows and columns line up, then compare. You can come back here at any time."
          : state.aLoaded
            ? "Drop the file to compare with your data below, or choose it."
            : "Drop the before file on the left and the after file on the right, or drop both at once.",
      ]),
    ]),
  );
  // Files dropped anywhere on the page: two fill both sides, one fills the side still empty.
  page.addEventListener("dragover", (event) => {
    if (Array.from(event.dataTransfer?.types ?? []).includes("Files")) event.preventDefault();
  });
  page.addEventListener("drop", (event) => {
    const files = [...(event.dataTransfer?.files ?? [])];
    if (files.length === 0) return;
    event.preventDefault();
    if (files.length >= 2 && !state.aLoaded) {
      const [first, second] = files.slice(0, 2).sort((x, y) => x.name.localeCompare(y.name, undefined, { numeric: true }));
      actions.pickBoth(first!, second!);
    } else if (state.a === null && !state.aLoaded) actions.pickA(files[0]!);
    else actions.pickB(files[files.length - 1]!);
  });
  page.append(
    el("div", { class: "cmp-sides" }, [
      sideCard("A", state.a, state.aLoaded ? "the loaded data, as it is now" : "", !state.aLoaded, actions.pickA),
      sideCard("B", state.b, "", true, actions.pickB),
    ]),
  );
  if (state.busy !== null) {
    page.append(el("div", { class: "cmp-busy", role: "status" }, [el("span", { class: "load-spinner", "aria-hidden": "true" }), state.busy]));
  }
  if (state.error !== null) page.append(el("p", { class: "cmp-error", role: "alert" }, [state.error]));

  const setup = state.setup;
  if (setup !== null && state.a !== null && state.b !== null) {
    // How rows match, then the button that runs it; column details and value rules refine it.
    const go = el("button", { class: "primary cmp-go", type: "button" }, ["Compare"]);
    go.disabled = state.busy !== null;
    go.addEventListener("click", () => actions.run());
    const keyText = state.key.kind === "content" ? "whole rows" : state.key.kind === "position" ? "row position" : `key ${keyLabel(setup, state.key.pairs)}`;
    const goRow = el("section", { class: "cmp-go-row", "aria-label": "Ready to compare" }, [
      go,
      el("div", { class: "cmp-ready-facts" }, [
        el("span", {}, [`${nf.format(setup.a.rowCount)} rows in A · ${nf.format(setup.b.rowCount)} in B`]),
        el("span", {}, [`Matching on ${keyText} · ${setup.pairing.pairs.length} column pair${setup.pairing.pairs.length === 1 ? "" : "s"}`]),
      ]),
    ]);
    const main = el("div", { class: "cmp-main" }, [keySection(state, setup, actions), goRow, columnSection(state, setup, actions)]);
    page.append(el("div", { class: "cmp-columns-layout" }, [main, el("aside", { class: "cmp-aside" }, [rulesSection(state, actions)])]));
  }
  host.replaceChildren(page);
}
