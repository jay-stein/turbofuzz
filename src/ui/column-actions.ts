import type { CleanOp } from "../data/clean-ops.js";
import type { PairOperator } from "../data/pair-checks.js";
import { describeSuggestion, suggestionShortLabel, type ColumnSuggestion } from "../data/suggestions.js";
import type { DedupeKeep } from "../data/transform-ops.js";
import type { NumberLocale } from "../parse/numbers.js";
import { COLUMN_TYPES, TYPE_LABELS, isNumericLikeType, isTemporalType, type ColumnType } from "../types.js";
import type { ColumnMeta } from "../worker/protocol.js";
import { ICONS, fromMenuItems, type ActionItem, type ActionSection } from "./action-menu.js";
import { openPrompt } from "./dialog.js";
import type { MenuItem } from "./menu.js";

/** What the column's action menu needs from the page: its state, and a callback per verb. */
export interface ColumnActionContext {
  meta: ColumnMeta;
  column: number;
  /** All columns, for "Compare with…". */
  columns: readonly ColumnMeta[];
  /** This column's current sort: 1, -1, or 0 when the table is not sorted by it. */
  sort: 1 | -1 | 0;
  /** True when the frozen columns end at this one. */
  frozen: boolean;
  displayFormat: number | null;
  displayGrouping: boolean;
  /** One-click fills for this column's empty cells (the same menu as the header's fix chip). */
  fillItems: readonly MenuItem[];
  /** Fixes for this column's outliers (the same menu as the header's fix chip). */
  outlierItems: readonly MenuItem[];
  onSort(dir: 1 | -1 | 0): void;
  onFilter(): void;
  onChart(): void;
  onHide(): void;
  onToggleFreeze(): void;
  onDisplayFormat(decimals: number | null): void;
  onDisplayGrouping(on: boolean): void;
  onNumberLocale(locale: NumberLocale): void;
  onRename(): void;
  onChangeType(type: ColumnType): void;
  /** New column at this position (column index it takes). */
  onInsert(at: number): void;
  onDelete(): void;
  onQuickClean(op: CleanOp): void;
  onOpenClean(tab: "values" | "nulls", preset?: CleanOp): void;
  onSuggestion(suggestion: ColumnSuggestion): void;
  onConvertTokens(tokens: string[]): void;
  onMerge(): void;
  onOpenTransform(preset?: { type: string; column?: number }): void;
  onDedupe(keep: DedupeKeep): void;
  onMelt(): void;
  onAllowedValues(values: string[]): void;
  onCompare(target: number, operator: PairOperator, tolerance: number): void;
  onCheckFreshness(days: number): void;
}

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
const count = (value: number): string => value.toLocaleString();

/**
 * Every operation on one column, grouped for the right-click menu: fixes for
 * what was found, view, column, clean, transform, checks, then delete. The
 * left-click inspector only reports; this is the one place to act.
 */
export function columnActionSections(ctx: ColumnActionContext): ActionSection[] {
  const { meta, column } = ctx;
  const numeric = isNumericLikeType(meta.type);
  const temporal = isTemporalType(meta.type);
  const plainNumber = meta.type === "integer" || meta.type === "number";

  // Fixes for what the profile found; the section is left out when the column is clean.
  const fixes: ActionItem[] = meta.suggestions.map((suggestion) => ({
    label: capitalize(suggestionShortLabel(suggestion)),
    hint: describeSuggestion(suggestion),
    icon: ICONS.fix,
    instant: true,
    run: () => ctx.onSuggestion(suggestion),
  }));
  const tokens = meta.nullTokens.filter((token) => token.label !== "" && token.count > 0);
  if (tokens.length > 0) {
    const ranked = tokens.slice().sort((a, b) => b.count - a.count).map((token) => token.label);
    const total = tokens.reduce((sum, token) => sum + token.count, 0);
    fixes.push({
      label: "Blank placeholder text",
      hint: `Treat ${ranked.slice(0, 3).map((label) => `“${label}”`).join(", ")}${ranked.length > 3 ? ", …" : ""} as empty — undo from the Recipe`,
      icon: ICONS.blank,
      badge: count(total),
      instant: true,
      run: () => ctx.onConvertTokens(ranked),
    });
  }
  if (meta.stats.nulls > 0 && ctx.fillItems.length > 0) {
    fixes.push({ label: "Fill empty cells", icon: ICONS.fill, badge: count(meta.stats.nulls), children: fromMenuItems(ctx.fillItems) });
  }
  if (meta.anomalyCounts.values > 0 && ctx.outlierItems.length > 0) {
    fixes.push({ label: "Handle outliers", icon: ICONS.outlier, badge: count(meta.anomalyCounts.values), children: fromMenuItems(ctx.outlierItems) });
  }
  if (meta.anomalyCounts.lengths > 0) {
    fixes.push({
      label: "Review long values…",
      hint: "Open Clean on this column to review or trim overlong values",
      icon: ICONS.clean,
      badge: count(meta.anomalyCounts.lengths),
      run: () => ctx.onOpenClean("values"),
    });
  }
  if (meta.similarGroups > 0 && meta.categories !== null) {
    fixes.push({
      label: "Merge similar values…",
      hint: "Review near-identical spellings and merge them",
      icon: ICONS.merge,
      badge: count(meta.similarGroups),
      run: () => ctx.onMerge(),
    });
  }

  const view: ActionItem[] = [
    { label: "Sort ascending", icon: ICONS.sortAsc, badge: ctx.sort === 1 ? "Current" : undefined, run: () => ctx.onSort(1) },
    { label: "Sort descending", icon: ICONS.sortDesc, badge: ctx.sort === -1 ? "Current" : undefined, run: () => ctx.onSort(-1) },
  ];
  if (ctx.sort !== 0) view.push({ label: "Clear sort", hint: "Back to the file order", icon: ICONS.sortClear, run: () => ctx.onSort(0) });
  view.push(
    { label: "Filter this column", hint: "Open this column's filter in the sidebar", icon: ICONS.filter, run: () => ctx.onFilter() },
    { label: "Chart this column", hint: "Add a chart of this column", icon: ICONS.chart, run: () => ctx.onChart() },
    { label: "Hide column", hint: "Hide from the table only — the data keeps it", icon: ICONS.hide, run: () => ctx.onHide() },
    {
      label: ctx.frozen ? "Unfreeze columns" : "Freeze columns up to here",
      hint: ctx.frozen ? "Let every column scroll sideways again" : "Keep this column and the ones left of it in place when scrolling sideways",
      icon: ICONS.freeze,
      run: () => ctx.onToggleFreeze(),
    },
  );
  if (numeric && !temporal) {
    const display: ActionItem[] = [];
    if (meta.type !== "integer") {
      display.push({ label: "Decimal places", heading: true });
      for (const option of [
        { label: "Automatic", value: null },
        { label: "0 decimals", value: 0 },
        { label: "1 decimal", value: 1 },
        { label: "2 decimals", value: 2 },
        { label: "3 decimals", value: 3 },
      ] as const) {
        display.push({
          label: option.label,
          hint: "How the numbers are shown — the stored values never change",
          checked: ctx.displayFormat === option.value,
          run: () => ctx.onDisplayFormat(option.value),
        });
      }
      display.push({ label: "Separators", heading: true });
    }
    display.push({
      label: "Thousands separators",
      hint: "Show 1,234,567 — display only, the stored values never change",
      checked: ctx.displayGrouping,
      run: () => ctx.onDisplayGrouping(!ctx.displayGrouping),
    });
    view.push({ label: "Number display", icon: ICONS.display, children: display });
  }

  const columnItems: ActionItem[] = [
    { label: "Rename column…", icon: ICONS.rename, run: () => ctx.onRename() },
    {
      label: "Change type",
      icon: ICONS.type,
      badge: TYPE_LABELS[meta.type],
      children: COLUMN_TYPES.map((type) => ({
        label: TYPE_LABELS[type],
        checked: type === meta.type,
        run: () => {
          if (type !== meta.type) ctx.onChangeType(type);
        },
      })),
    },
  ];
  if (plainNumber) {
    columnItems.push({
      label: "Number format",
      icon: ICONS.locale,
      hint: "How this column's text is read: which mark is the decimal point",
      children: [
        { label: "1,234.56 — decimal point", checked: meta.numberLocale !== "comma", run: () => ctx.onNumberLocale("dot") },
        { label: "1.234,56 — decimal comma", checked: meta.numberLocale === "comma", run: () => ctx.onNumberLocale("comma") },
      ],
    });
  }
  columnItems.push(
    { label: "Insert column left…", icon: ICONS.insertLeft, run: () => ctx.onInsert(column) },
    { label: "Insert column right…", icon: ICONS.insertRight, run: () => ctx.onInsert(column + 1) },
  );

  const clean: ActionItem[] = [
    { label: "Trim whitespace", icon: ICONS.trim, instant: true, run: () => ctx.onQuickClean({ kind: "trim" }) },
    {
      label: "Change case",
      icon: ICONS.textCase,
      children: [
        { label: "UPPERCASE", instant: true, run: () => ctx.onQuickClean({ kind: "case", style: "upper" }) },
        { label: "lowercase", instant: true, run: () => ctx.onQuickClean({ kind: "case", style: "lower" }) },
        { label: "Title Case", instant: true, run: () => ctx.onQuickClean({ kind: "case", style: "title" }) },
      ],
    },
    {
      label: "Convert values",
      icon: ICONS.convert,
      children: [
        { label: "To number", instant: true, run: () => ctx.onQuickClean({ kind: "toNumber", locale: meta.numberLocale }) },
        { label: "To date", instant: true, run: () => ctx.onQuickClean({ kind: "toDate", order: meta.dateOrder }) },
        {
          label: "To date & time",
          hint: "Keeps the clock, stored as UTC — undo from the toast or the Recipe",
          instant: true,
          run: () => ctx.onQuickClean({ kind: "toDateTime", order: meta.dateOrder }),
        },
      ],
    },
    {
      label: "Keep only numbers",
      hint: "Strip everything but the number in each cell: $1,234.50 → 1234.50 (undo from the toast or the Recipe)",
      icon: ICONS.number,
      instant: true,
      run: () => ctx.onQuickClean({ kind: "keepNumbers", locale: meta.numberLocale }),
    },
    {
      label: "Keep only text",
      hint: "Strip digits and symbols, keeping the words: Unit 4B, Level 2 → Unit B Level (undo from the toast or the Recipe)",
      icon: ICONS.letters,
      instant: true,
      run: () => ctx.onQuickClean({ kind: "keepText" }),
    },
    {
      label: "Find & replace…",
      icon: ICONS.replace,
      run: () => ctx.onOpenClean("values", { kind: "replace", find: "", replacement: "", ignoreCase: false }),
    },
    {
      label: "Escape formula-like cells",
      hint: "Prefix cells that start like a formula so spreadsheets keep them as text",
      icon: ICONS.formula,
      instant: true,
      run: () => ctx.onQuickClean({ kind: "escapeFormulas" }),
    },
    { label: "Missing values…", hint: "Open Clean on this column's empty and placeholder cells", icon: ICONS.missing, run: () => ctx.onOpenClean("nulls") },
    { label: "Clean values…", hint: "Open Clean on this column: every clean step, with a preview", icon: ICONS.clean, run: () => ctx.onOpenClean("values") },
  ];

  const transform: ActionItem[] = [
    {
      label: "Fill missing values…",
      hint: "Mean, median, previous value, a constant and more, with a preview",
      icon: ICONS.fill,
      run: () => ctx.onOpenTransform({ type: "impute", column }),
    },
    {
      label: "Fill from similar rows (k nearest neighbours)…",
      icon: ICONS.neighbours,
      run: () => ctx.onOpenTransform({ type: "knn", column }),
    },
  ];
  if (numeric && !temporal) transform.push({ label: "Round…", icon: ICONS.round, run: () => ctx.onOpenTransform({ type: "round", column }) });
  transform.push({ label: "Split column…", icon: ICONS.split, run: () => ctx.onOpenTransform({ type: "splitColumn", column }) });
  if (temporal) {
    transform.push({ label: "Combine date/time columns…", icon: ICONS.combine, run: () => ctx.onOpenTransform({ type: "combineDate", column }) });
  }
  transform.push(
    { label: "Group by & aggregate…", icon: ICONS.group, run: () => ctx.onOpenTransform({ type: "groupBy", column }) },
    {
      label: "Remove duplicate rows",
      icon: ICONS.dedupe,
      children: [
        { label: "Keep the first copy", instant: true, run: () => ctx.onDedupe("first") },
        { label: "Keep the last copy", instant: true, run: () => ctx.onDedupe("last") },
        { label: "Remove every copy", instant: true, run: () => ctx.onDedupe("none") },
        { label: "More options…", run: () => ctx.onOpenTransform({ type: "dedupe" }) },
      ],
    },
    { label: "Melt: pivot longer (wide → long)…", icon: ICONS.melt, run: () => ctx.onMelt() },
    { label: "Transform dataset…", icon: ICONS.transform, run: () => ctx.onOpenTransform() },
  );

  const checks: ActionItem[] = [];
  if (meta.categories !== null) {
    checks.push({
      label: "Allowed values…",
      hint: "Flag values outside a list you give (filters to them)",
      icon: ICONS.allowed,
      run: () => void promptAllowedValues(ctx),
    });
  }
  const comparable = ["integer", "number", "date", "datetime"];
  const others = ctx.columns
    .map((entry, index) => ({ entry, index }))
    .filter((candidate) => candidate.index !== column && comparable.includes(candidate.entry.type));
  if (comparable.includes(meta.type) && others.length > 0) {
    checks.push({
      label: "Compare with",
      hint: "Flag rows that break a rule against another column",
      icon: ICONS.compare,
      children: others.map(({ entry, index }) => ({
        label: entry.name,
        children: [
          { label: "≥  at least", run: () => ctx.onCompare(index, "gte", 0) },
          { label: ">  more than", run: () => ctx.onCompare(index, "gt", 0) },
          { label: "=  equal", run: () => ctx.onCompare(index, "eq", 0) },
          { label: "≈  within a tolerance…", run: () => void promptTolerance(ctx, index, entry.name) },
        ],
      })),
    });
  }
  if ((meta.type === "date" || meta.type === "datetime") && meta.stats.max !== null) {
    checks.push({
      label: "Check freshness…",
      hint: "Score timeliness: how old may the newest value be?",
      icon: ICONS.clock,
      run: () => void promptFreshness(ctx),
    });
  }

  return [
    { title: "Fix", items: fixes },
    { title: "View", items: view },
    { title: "Column", items: columnItems },
    { title: "Clean", items: clean },
    { title: "Transform", items: transform },
    { title: "Check", items: checks },
    { items: [{ label: "Delete column…", hint: "Remove this column — tracked in the Recipe and undoable", icon: ICONS.trash, danger: true, run: () => ctx.onDelete() }] },
  ];
}

async function promptAllowedValues(ctx: ColumnActionContext): Promise<void> {
  const input = await openPrompt({
    title: `Allowed values for “${ctx.meta.name}”`,
    label: "Comma-separated allowed values",
    placeholder: ctx.meta.categories?.labels.slice(0, 3).join(", ") ?? "",
    confirmLabel: "Check",
  });
  if (input === null) return;
  const values = input.split(",").map((part) => part.trim()).filter((part) => part !== "");
  if (values.length > 0) ctx.onAllowedValues(values);
}

async function promptTolerance(ctx: ColumnActionContext, target: number, targetName: string): Promise<void> {
  const input = await openPrompt({
    title: `Tolerance for “${ctx.meta.name}” ≈ “${targetName}”`,
    label: "Maximum allowed difference",
    placeholder: "0.01",
    confirmLabel: "Check",
  });
  if (input === null) return;
  const tolerance = Number(input.trim());
  if (Number.isFinite(tolerance) && tolerance >= 0) ctx.onCompare(target, "approx", tolerance);
}

async function promptFreshness(ctx: ColumnActionContext): Promise<void> {
  const input = await openPrompt({
    title: `Freshness for “${ctx.meta.name}”`,
    label: "Maximum acceptable age in days",
    value: "30",
    confirmLabel: "Check",
  });
  if (input === null) return;
  const days = Number(input.trim());
  if (Number.isFinite(days) && days > 0) ctx.onCheckFreshness(days);
}
