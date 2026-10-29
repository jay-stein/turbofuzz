import {
  describeRule,
  newRuleId,
  validateRule,
  type CompareOperator,
  type Rule,
  type RuleResult,
  type RuleSeverity,
  type RuleType,
} from "../data/rules.js";
import { el } from "./dom.js";

export interface RulesPanelState {
  accepted: readonly Rule[];
  suggested: readonly Rule[];
  results: ReadonlyMap<string, RuleResult>;
  columnNames: readonly string[];
  /** A saved rules set that matches this file's layout, offered once. */
  savedOffer: { count: number } | null;
}

export interface RulesPanelActions {
  accept(rule: Rule): void;
  acceptAll(): void;
  remove(id: string): void;
  update(rule: Rule): void;
  download(): void;
  load(text: string): void;
  applySaved(): void;
}

const TYPE_LABEL: Record<RuleType, string> = {
  notNull: "Not empty",
  unique: "Unique",
  range: "Number range",
  inList: "One of a list",
  regex: "Matches a pattern",
  length: "Text length",
  compare: "Compare with another column",
};

const SEVERITIES: readonly RuleSeverity[] = ["critical", "major", "minor"];

/** The Rules tab: accepted rules, suggestions, a small editor, and the rules file. */
export function buildRulesPanel(state: RulesPanelState, actions: RulesPanelActions): HTMLElement {
  const root = el("div", { class: "qp-rules" });

  if (state.savedOffer !== null) {
    const apply = el("button", { class: "primary small", type: "button" }, [`Apply ${state.savedOffer.count} saved ${state.savedOffer.count === 1 ? "rule" : "rules"}`]);
    apply.addEventListener("click", actions.applySaved);
    root.append(el("div", { class: "qp-rules-offer", role: "note" }, ["This file has the same columns as one you set rules for earlier. ", apply]));
  }

  root.append(
    el("p", { class: "qp-section-hint" }, [
      "Rules are your own expectations. Each accepted rule becomes a scored check and lists its failures. Rules are plain data, never code, and stay in this browser unless you download them.",
    ]),
  );

  // Accepted rules.
  const list = el("div", { class: "qp-rule-list", "aria-label": "Accepted rules" });
  if (state.accepted.length === 0) {
    list.append(el("div", { class: "qp-empty-state" }, ["No rules yet. Accept a suggestion below or add your own."]));
  }
  for (const rule of state.accepted) {
    const result = state.results.get(rule.id);
    const share = result === undefined || result.compared === 0 ? 0 : result.fail / result.compared;
    const failing = result !== undefined && result.error === null && share > rule.allowedFailure;
    const row = el("div", { class: `qp-rule ${result?.error ? "rule-error" : failing ? "rule-fail" : "rule-ok"}`, "data-rule": rule.id });
    row.append(el("span", { class: "qp-rule-text" }, [describeRule(rule)]));
    row.append(
      el("span", { class: "qp-rule-status" }, [
        result === undefined ? "checking…" : result.error !== null ? result.error : failing ? `${result.fail.toLocaleString()} fail${result.examples.length > 0 ? ` (e.g. ${result.examples.join(", ")})` : ""}` : "passes",
      ]),
    );
    const severity = el("select", { "aria-label": "Severity" }) as HTMLSelectElement;
    for (const level of SEVERITIES) severity.append(el("option", { value: level, ...(level === rule.severity ? { selected: "selected" } : {}) }, [level]));
    severity.addEventListener("change", () => actions.update({ ...rule, severity: severity.value as RuleSeverity }));
    const allowed = el("input", { type: "number", min: "0", max: "100", step: "0.1", value: String(rule.allowedFailure * 100), "aria-label": "Allowed failure percent", class: "qp-rule-allow" }) as HTMLInputElement;
    allowed.addEventListener("change", () => {
      const value = Number(allowed.value);
      if (Number.isFinite(value) && value >= 0 && value <= 100) actions.update({ ...rule, allowedFailure: value / 100 });
    });
    const remove = el("button", { class: "ghost small", type: "button" }, ["Remove"]);
    remove.addEventListener("click", () => actions.remove(rule.id));
    row.append(severity, el("label", { class: "qp-rule-allow-label" }, [allowed, " % may fail"]), remove);
    list.append(row);
  }
  root.append(el("h3", { class: "qp-section-title" }, [`Your rules ${state.accepted.length}`]), list);

  // Suggestions.
  if (state.suggested.length > 0) {
    const head = el("div", { class: "qp-strip-head" }, [el("h3", { class: "qp-section-title" }, [`Suggested ${state.suggested.length}`])]);
    const all = el("button", { class: "ghost small", type: "button" }, ["Accept all"]);
    all.addEventListener("click", actions.acceptAll);
    head.append(all);
    const suggestions = el("div", { class: "qp-rule-list", "aria-label": "Suggested rules" });
    for (const rule of state.suggested) {
      const accept = el("button", { class: "ghost small", type: "button" }, ["Accept"]);
      accept.addEventListener("click", () => actions.accept(rule));
      suggestions.append(el("div", { class: "qp-rule rule-suggested" }, [el("span", { class: "qp-rule-text" }, [describeRule(rule)]), accept]));
    }
    root.append(head, suggestions);
  }

  root.append(buildEditor(state.columnNames, actions));

  // File round trip.
  const download = el("button", { class: "ghost small", type: "button" }, ["Download rules file"]);
  download.addEventListener("click", actions.download);
  const picker = el("input", { type: "file", accept: "application/json,.json", class: "hidden", "aria-label": "Rules file" }) as HTMLInputElement;
  picker.addEventListener("change", () => {
    const file = picker.files?.[0];
    if (file === undefined) return;
    void file.text().then((text) => actions.load(text));
    picker.value = "";
  });
  const load = el("button", { class: "ghost small", type: "button" }, ["Load rules file…"]);
  load.addEventListener("click", () => picker.click());
  root.append(el("div", { class: "qp-actions" }, [download, load, picker]));
  return root;
}

function buildEditor(columns: readonly string[], actions: RulesPanelActions): HTMLElement {
  const form = el("form", { class: "qp-rule-form", "aria-label": "Add a rule" });
  const column = el("select", { "aria-label": "Column" }) as HTMLSelectElement;
  for (const name of columns) column.append(el("option", { value: name }, [name]));
  const type = el("select", { "aria-label": "Rule type" }) as HTMLSelectElement;
  for (const [value, label] of Object.entries(TYPE_LABEL)) type.append(el("option", { value }, [label]));
  const a = el("input", { type: "text", "aria-label": "Value", placeholder: "" }) as HTMLInputElement;
  const b = el("input", { type: "text", "aria-label": "Second value", placeholder: "" }) as HTMLInputElement;
  const other = el("select", { "aria-label": "Other column" }) as HTMLSelectElement;
  for (const name of columns) other.append(el("option", { value: name }, [name]));
  const message = el("span", { class: "qp-rule-error", role: "alert" });
  const submit = el("button", { class: "ghost small", type: "submit" }, ["Add rule"]);

  const sync = (): void => {
    const kind = type.value as RuleType;
    a.classList.toggle("hidden", kind === "notNull" || kind === "unique" || kind === "compare");
    b.classList.toggle("hidden", !(kind === "range" || kind === "length"));
    other.classList.toggle("hidden", kind !== "compare");
    a.placeholder = kind === "inList" ? "a, b, c" : kind === "regex" ? "[A-Z]{2}\\d+" : "min";
    b.placeholder = "max";
  };
  type.addEventListener("change", sync);
  sync();

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const kind = type.value as RuleType;
    const number = (text: string): number | undefined => (text.trim() === "" || !Number.isFinite(Number(text)) ? undefined : Number(text));
    const rule: Rule = { id: newRuleId(), type: kind, column: column.value, severity: "major", allowedFailure: 0 };
    if (kind === "range" || kind === "length") {
      const min = number(a.value);
      const max = number(b.value);
      if (min !== undefined) rule.min = min;
      if (max !== undefined) rule.max = max;
    } else if (kind === "inList") rule.values = a.value.split(",").map((v) => v.trim()).filter(Boolean);
    else if (kind === "regex") rule.pattern = a.value;
    else if (kind === "compare") {
      rule.other = other.value;
      rule.operator = "gte" as CompareOperator;
    }
    const problem = validateRule(rule);
    message.textContent = problem ?? "";
    if (problem === null) {
      actions.accept(rule);
      a.value = "";
      b.value = "";
    }
  });
  form.append(column, type, a, b, other, submit, message);
  return el("section", { class: "qp-rule-editor" }, [el("h3", { class: "qp-section-title" }, ["Add a rule"]), form]);
}
