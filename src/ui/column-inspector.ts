import type { CleanOp } from "../data/clean-ops.js";
import type { ColumnSuggestion } from "../data/suggestions.js";
import type { ColumnMeta } from "../worker/protocol.js";
import { el } from "./dom.js";

export interface ColumnInspectorCallbacks {
  onSort(dir: 1 | -1): void;
  onFilter(): void;
  onChart(): void;
  onQuickClean(op: CleanOp): void;
  onOpenClean(tab: "values" | "nulls"): void;
  onOpenTransform(preset?: { type: string; column?: number }): void;
  onSuggestion(suggestion: ColumnSuggestion): void;
  onMerge(): void;
  onRename(): void;
  onDelete(): void;
  /** null = Auto (raw values); otherwise fixed decimal places. */
  onDisplayFormat(decimals: number | null): void;
  displayFormat: number | null;
}

function statLine(label: string, value: string | null): HTMLElement | null {
  if (value === null) return null;
  const row = el("div", { class: "inspector-stat" });
  row.append(
    el("span", { class: "inspector-stat-label" }, [label]),
    el("span", { class: "inspector-stat-value" }, [value]),
  );
  return row;
}

function section(title: string): HTMLElement {
  return el("div", { class: "inspector-section" }, [
    el("div", { class: "inspector-section-title" }, [title]),
  ]);
}

function action(
  label: string,
  title: string,
  run: () => void,
  className = "inspector-action",
): HTMLButtonElement {
  const button = el("button", { class: className, type: "button", title }, [
    label,
  ]) as HTMLButtonElement;
  button.addEventListener("click", () => run());
  return button;
}

/**
 * Column inspector: click a header to see the profile, the issues and the
 * verbs in context (sort, filter, chart, trim, case, convert, split, round,
 * fill missing, format, merge, rename, delete). Structural ops open the
 * Transform panel with this column preselected; parameter-free cleans apply
 * immediately with Undo in the Recipe.
 */
export function openColumnInspector(
  anchor: HTMLElement,
  meta: ColumnMeta,
  column: number,
  callbacks: ColumnInspectorCallbacks,
): void {
  const panel = el("div", { class: "column-inspector", role: "dialog" });
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    panel.remove();
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", close);
    anchor.classList.remove("inspecting");
  };
  const onPointerDown = (event: PointerEvent): void => {
    if (!panel.contains(event.target as Node) && !anchor.contains(event.target as Node)) {
      close();
    }
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") close();
  };

  // Head: name, type, rename.
  const head = el("div", { class: "inspector-head" });
  head.append(
    el("span", { class: "inspector-name", title: meta.name }, [meta.name]),
    el("span", { class: "inspector-type" }, [meta.type]),
  );
  head.append(
    action("Rename…", "Rename this column", () => {
      close();
      callbacks.onRename();
    }, "link inspector-link"),
  );
  panel.append(head);

  // Profile.
  const profile = section("Profile");
  const numeric =
    meta.type === "integer" || meta.type === "number" || meta.type === "date";
  const formatNumber = (value: number): string =>
    value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  const stats: (HTMLElement | null)[] = [
    statLine("Empty", meta.stats.nulls > 0 ? meta.stats.nulls.toLocaleString() : "0"),
    statLine("Distinct", meta.stats.distinct.toLocaleString()),
  ];
  if (numeric && meta.stats.min !== null && meta.stats.max !== null) {
    stats.push(
      statLine("Min", formatNumber(meta.stats.min)),
      statLine("Max", formatNumber(meta.stats.max)),
      statLine("Mean", meta.stats.mean === null ? null : formatNumber(meta.stats.mean)),
      statLine(
        "Median",
        meta.valueFence === null || meta.type === "date"
          ? null
          : formatNumber(meta.valueFence.center),
      ),
    );
  } else if (meta.stats.avgLength !== null) {
    stats.push(
      statLine("Length avg", meta.stats.avgLength.toFixed(1)),
      statLine("Length max", meta.stats.maxLength === null ? null : String(meta.stats.maxLength)),
    );
    if (meta.stats.topValues.length > 0) {
      stats.push(
        statLine(
          "Top values",
          meta.stats.topValues
            .slice(0, 3)
            .map((entry) => `${entry.label} (${entry.count.toLocaleString()})`)
            .join(", "),
        ),
      );
    }
  }
  for (const row of stats) if (row !== null) profile.append(row);
  panel.append(profile);

  // Issues: suggestions, placeholder text, anomalies, similar values.
  const issues = section("Issues");
  let issueCount = 0;
  for (const suggestion of meta.suggestions) {
    issues.append(
      action(
        `${suggestionLabel(suggestion)}`,
        "Apply this fix — undo is offered in the Recipe",
        () => {
          close();
          callbacks.onSuggestion(suggestion);
        },
        "inspector-issue",
      ),
    );
    issueCount++;
  }
  const tokens = meta.nullTokens.filter((token) => token.label !== "" && token.count > 0);
  if (tokens.length > 0) {
    issues.append(
      action(
        `${tokens.reduce((sum, token) => sum + token.count, 0).toLocaleString()} placeholder cells`,
        `Values like ${tokens
          .slice(0, 3)
          .map((token) => `“${token.label}”`)
          .join(", ")} are missing but stored as text`,
        () => {
          close();
          callbacks.onOpenClean("nulls");
        },
        "inspector-issue warn",
      ),
    );
    issueCount++;
  }
  if (meta.anomalyCounts.values > 0) {
    issues.append(
      action(
        `${meta.anomalyCounts.values.toLocaleString()} value outliers`,
        "Show the rows outside this column's robust fence",
        () => {
          close();
          callbacks.onFilter();
        },
        "inspector-issue warn",
      ),
    );
    issueCount++;
  }
  if (meta.anomalyCounts.lengths > 0) {
    issues.append(
      action(
        `${meta.anomalyCounts.lengths.toLocaleString()} overlong values`,
        "Show the rows with unusually long text",
        () => {
          close();
          callbacks.onFilter();
        },
        "inspector-issue warn",
      ),
    );
    issueCount++;
  }
  if (meta.similarGroups > 0) {
    issues.append(
      action(
        `${meta.similarGroups.toLocaleString()} similar pair${meta.similarGroups === 1 ? "" : "s"}`,
        "Review and merge near-identical values",
        () => {
          close();
          callbacks.onMerge();
        },
        "inspector-issue",
      ),
    );
    issueCount++;
  }
  if (issueCount === 0) {
    issues.append(el("div", { class: "inspector-none" }, ["✓ No issues found in this column."]));
  } else {
    issues.append(
      action("Review missing values…", "Open the missing-value review", () => {
        close();
        callbacks.onOpenClean("nulls");
      }, "link inspector-link"),
    );
  }
  panel.append(issues);

  // Navigate.
  const navigate = section("Go to");
  navigate.append(
    action("Sort ascending", "Sort the table by this column", () => {
      close();
      callbacks.onSort(1);
    }),
    action("Sort descending", "Sort the table by this column", () => {
      close();
      callbacks.onSort(-1);
    }),
    action("Filter", "Open this column in the filters sidebar", () => {
      close();
      callbacks.onFilter();
    }),
    action("Chart", "Add a chart of this column", () => {
      close();
      callbacks.onChart();
    }),
  );
  panel.append(navigate);

  // Clean verbs in context (parameter-free ones apply immediately).
  const clean = section("Clean");
  clean.append(
    action("Trim", "Trim whitespace (applies immediately)", () => {
      close();
      callbacks.onQuickClean({ kind: "trim" });
    }),
    action("UPPERCASE", "Apply immediately", () => {
      close();
      callbacks.onQuickClean({ kind: "case", style: "upper" });
    }),
    action("lowercase", "Apply immediately", () => {
      close();
      callbacks.onQuickClean({ kind: "case", style: "lower" });
    }),
    action("Title Case", "Apply immediately", () => {
      close();
      callbacks.onQuickClean({ kind: "case", style: "title" });
    }),
    action("Convert to number", "Apply immediately", () => {
      close();
      callbacks.onQuickClean({ kind: "toNumber", locale: meta.numberLocale });
    }),
    action("Convert to date", "Apply immediately", () => {
      close();
      callbacks.onQuickClean({ kind: "toDate", order: meta.dateOrder });
    }),
    action("Escape formulas", "Prefix formula-like cells so spreadsheets keep them as text", () => {
      close();
      callbacks.onQuickClean({ kind: "escapeFormulas" });
    }),
    action("Split…", "Open the Transform panel with this column preselected", () => {
      close();
      callbacks.onOpenTransform({ type: "splitColumn", column });
    }),
    action("Round…", "Open the Transform panel with this column preselected", () => {
      close();
      callbacks.onOpenTransform({ type: "round", column });
    }),
    action("Fill missing…", "Open the Transform panel with this column preselected", () => {
      close();
      callbacks.onOpenTransform({ type: "impute", column });
    }),
    action("Group by…", "Aggregate rows by this column", () => {
      close();
      callbacks.onOpenTransform({ type: "groupBy", column });
    }),
    action("All clean options…", "Open the Clean panel on this column", () => {
      close();
      callbacks.onOpenClean("values");
    }),
  );
  panel.append(clean);

  // Display format (numeric columns): fixed decimals for reading.
  if (numeric && meta.type !== "date") {
    const display = section("Display");
    const options: readonly { label: string; value: number | null }[] = [
      { label: "Auto", value: null },
      { label: "0 dp", value: 0 },
      { label: "1 dp", value: 1 },
      { label: "2 dp", value: 2 },
    ];
    for (const option of options) {
      const active = callbacks.displayFormat === option.value;
      display.append(
        action(
          `${active ? "● " : ""}${option.label}`,
          "How numbers in this column are displayed (values are not changed)",
          () => {
            close();
            callbacks.onDisplayFormat(option.value);
          },
        ),
      );
    }
    panel.append(display);
  }

  const danger = section("Danger zone");
  danger.append(
    action(
      "Delete column…",
      "Remove this column — tracked in the Recipe and undoable",
      () => {
        close();
        callbacks.onDelete();
      },
      "inspector-action danger",
    ),
  );
  panel.append(danger);

  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKey);
  window.addEventListener("resize", close);
  document.body.append(panel);
  anchor.classList.add("inspecting");
  const rect = anchor.getBoundingClientRect();
  panel.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - panel.offsetWidth - 8))}px`;
  panel.style.top = `${Math.max(
    8,
    Math.min(rect.bottom + 6, window.innerHeight - panel.offsetHeight - 8),
  )}px`;
}

/** Short chip text for one suggestion (mirrors the header chip wording). */
function suggestionLabel(suggestion: ColumnSuggestion): string {
  switch (suggestion.kind) {
    case "sentinel":
      return `treat “${suggestion.value}” as missing (${suggestion.count.toLocaleString()})`;
    case "mixedNumber":
      return `repair ${suggestion.count.toLocaleString()} mixed decimals`;
    case "typeConflict":
      return `treat as text (${suggestion.count.toLocaleString()} don't parse)`;
    case "formula":
      return `escape ${suggestion.count.toLocaleString()} formula-like cells`;
    case "number":
      return "convert formatted numbers";
    case "date":
      return "convert text to dates";
    case "boolean":
      return "normalise boolean values";
  }
}
