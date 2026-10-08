export interface HelpBlock {
  kind: "p" | "list" | "note";
  text?: string;
  items?: string[];
}

export interface HelpSection {
  id: string;
  title: string;
  summary: string;
  blocks: HelpBlock[];
}

function p(text: string): HelpBlock {
  return { kind: "p", text };
}

function list(...items: string[]): HelpBlock {
  return { kind: "list", items };
}

function note(text: string): HelpBlock {
  return { kind: "note", text };
}

/**
 * In-app user guide. Authored as structured data so it is bundled with the app
 * and works fully offline (no fetches, no external docs site).
 */
export const HELP_SECTIONS: readonly HelpSection[] = [
  {
    id: "getting-started",
    title: "Getting started",
    summary: "Load a file or paste rows, then fix what the app flags.",
    blocks: [
      p(
        "Drop a file on the start screen, click to browse, or paste rows. Supported formats: CSV/TSV/PSV/TXT, JSON, Excel (.xlsx/.xls), Parquet and ZIP/GZ/BZ2 archives. Everything is parsed on your device — the file is never uploaded.",
      ),
      p(
        "After loading you land in the workspace: filters on the left, the table in the middle, and the Data QA strip on top. Fix chips appear above columns and in the left sidebar when the app spots a likely problem.",
      ),
      list(
        "Click a chip to apply its fix — every fix is reversible from the Process Log.",
        "Click a column name to sort; use the header ⋯ menu (or right-click) for per-column actions.",
        "Use Export… when you are done; the dialog states exactly which rows will be written.",
        "The header Theme control cycles Auto / Light / Dark — Auto follows your operating system.",
        "Help (this drawer) is searchable; the Chart tab shows a chart of the current result set and exports it as a PNG.",
      ),
    ],
  },
  {
    id: "import-check",
    title: "Import check",
    summary: "What the import banner and encoding notes mean.",
    blocks: [
      p("The banner after loading reports anything that changed shape on the way in:"),
      list(
        "Short rows padded with empty cells — the file had rows with fewer fields than the header.",
        "Rows with extra cells beyond the known columns — those cells were trimmed, not silently merged.",
        "windows-1252 / encoding notes — the text was decoded with a legacy encoding and accents may need review.",
      ),
      p(
        "A column with a blank header is kept as “Column N” if any row has data there. Columns that are empty in every row are offered as a one-click drop in the Data QA block.",
      ),
    ],
  },
  {
    id: "data-qa",
    title: "Data QA and profiles",
    summary: "Empties, outliers, duplicates, mergeable values and the profile cards.",
    blocks: [
      p(
        "The Data QA strip starts collapsed; expand it for the full controls and one profile card per column (histogram for numbers, top values for categories, length stats for text).",
      ),
      list(
        "N empty cells — click to show rows where that column is blank.",
        "N value outliers — outside the column's robust fence. Hover a tinted cell to see the median and expected range; the method is shown too (MAD, log-scale or quantile).",
        "N long values — much longer text than the column's 90th percentile.",
        "N mergeable — near-identical values such as Smith/Smyth; click to review and merge.",
        "constant value — every row repeats one value, so the column carries no information.",
      ),
      note(
        "Heavy-tailed numeric columns use a signed-log histogram and bounded quantile fences, so a few enormous values cannot swamp the chart or flag most of the column.",
      ),
    ],
  },
  {
    id: "fix-chips",
    title: "Fix chips (suggestions)",
    summary: "One-click fixes for sentinel values, mixed decimals, type conflicts and formulas.",
    blocks: [
      p(
        "Chips appear above a column header and in its sidebar card when the data shows a recognisable problem. Clicking one applies the fix as a logged, reversible change.",
      ),
      list(
        "treat “TBC” as missing — repeated placeholder words (TBC) or repeated-digit codes (-999, 9999) are added to the column's missing-value rules. Click again in Clean → Nulls to remove the rule.",
        "repair N mixed decimals — some cells use the other decimal convention (613,26) while the column reads 1,234.56; only those cells are rewritten, the rest are untouched.",
        "N don't parse — repeated values that do not fit the column type (high in an integer column). Click to treat the column as text so nothing is coerced or blanked.",
        "escape N formulas — cells starting with =, @, + or - that Excel would execute. The fix prefixes them with an apostrophe.",
        "convert to number / convert to date / normalize yes/no — formatted text is converted in one step.",
      ),
      note("Prefer the sidebar chips? They do exactly the same and include longer explanations on hover."),
    ],
  },
  {
    id: "clean",
    title: "Clean a column",
    summary: "Trim, case, replace, convert, repair and missing-value rules.",
    blocks: [
      p(
        "Open Clean and pick a column. Operations are queued with a live preview of the first cells and a “how many cells change” count, then applied together. Nothing is applied until you press the button, and every applied operation is reversible from the Process Log.",
      ),
      p(
        "Clean can also be opened from a column: right-click a header and choose Clean values… or Missing values… — the panel opens on that column and tab.",
      ),
      list(
        "Trim whitespace, change case (upper/lower/title), find and replace.",
        "Convert to number (choose the decimal convention) or to date (choose day-first or month-first).",
        "Repair mixed decimals — fixes only the values written in the other convention.",
        "Escape formula-like cells — for values that would execute on spreadsheet import.",
        "Apply to all columns — run the same operation list across every column.",
      ),
      p(
        "The Nulls tab controls what counts as missing per column: review the tokens already treated as empty, un-treat legitimate values (a town called NULL), or add custom sentinels such as -999.",
      ),
    ],
  },
  {
    id: "transform",
    title: "Transform the table",
    summary: "Dedupe, drop, round, group by, impute and reshape.",
    blocks: [
      p(
        "Transforms change the shape of the working set. They run against the base data captured before the first transform, so the pipeline is re-derived from scratch on every change — the Process Log shows the ordered list. Right-click any column header and choose Transform dataset… to jump straight in.",
      ),
      list(
        "Remove duplicate rows — keep first, keep last, or remove all copies.",
        "Drop or round columns.",
        "Group by a column with count/sum/min/max/mean/median measures.",
        "Fill missing values — constant, mean, median, mode, forward/backward within a group, or KNN from numeric predictors.",
        "Melt wide columns into variable/value pairs.",
      ),
      note(
        "KNN imputation works best when the predictor columns genuinely relate to the column being filled — with useful predictors a hold-out test showed roughly a 70% error reduction versus mean/median filling, but with unrelated predictors it can be slightly worse than the mean. Applying a transform bakes the changes made so far into the base data; later undos rebuild from there.",
      ),
    ],
  },
  {
    id: "search",
    title: "Search and filter",
    summary: "Text modes, value sets, ranges and live counts.",
    blocks: [
      p(
        "Every column has a filter card in the left sidebar. Facet counts and histograms update as you type, and the result count is always visible above the table.",
      ),
      list(
        "Contains / Exact / Fuzzy / Phonetic — exact for IDs, fuzzy for typos (Smith vs Smyth), phonetic for sound-alikes.",
        "Pick values — checkbox lists for categories with counts.",
        "Ranges — drag the histogram or type exact bounds; works for numbers and dates.",
        "Shuffle — show a random sample of N rows; clear the number to shuffle all.",
      ),
      p("Clicking highlighted text or using a chip filters instantly. “Clear all” resets every filter."),
    ],
  },
  {
    id: "charts",
    title: "Charts",
    summary: "Chart the current result set and export it as a PNG.",
    blocks: [
      p(
        "The Chart tab in the results bar draws the rows currently matching your filters: histograms for numeric columns, a time series for dates and bars for categories.",
      ),
      list(
        "Numeric: Start/End default to the column's full range, but when a few extreme values dwarf the rest the End is clipped to the 95th percentile with the “> Max” bar switched on (Full range restores everything). Bounds accept thousands commas and the Bins count is free.",
        "Categories: set any number of top bars (default 5) and optionally group the rest as “Other”; every bar shows its count and share above it.",
        "Colours: pick one of ten presets or type a hex code. Category bars can colour each bar separately.",
        "Title: defaults to “source — column” with the type, rows shown and distinct count underneath; type your own title to override it.",
        "Export PNG at 1280×720, 1920×1080 (default) or 2560×1440; the chart is drawn in logical coordinates so every size keeps the same 16:9 layout.",
      ),
    ],
  },
  {
    id: "process-log",
    title: "Process Log (undo)",
    summary: "Every applied change, individually reversible, plus a pandas recipe.",
    blocks: [
      p(
        "Process Log lists the changes currently applied to the working set: clean operations, missing-value rules, column type changes, deleted rows and transform steps. The number next to the button is how many entries are active.",
      ),
      list(
        "The undo icon reverses one entry; clean operations can be reordered within their column.",
        "Undo all restores the original data (except the loaded file itself).",
        "Copy pandas recipe exports the clean and transform steps as a best-effort Python script for reproducibility.",
      ),
      note(
        "Deleting rows is undoable here too. Type changes and missing-value fixes now appear in the log as well, so nothing the chips do is a dead end.",
      ),
    ],
  },
  {
    id: "export",
    title: "Export",
    summary: "Scope, null handling and Excel-safe output.",
    blocks: [
      p(
        "Export… writes a CSV built in your browser. The dialog always states the scope in numbers: all rows after the step pipeline, or only the rows matching the current filters. When filters are active it defaults to all rows so a filtered view cannot ship by accident.",
      ),
      list(
        "Blank null values — treat recognised missing markers as empty cells.",
        "Escape formula-like cells — prefix =, @ and signed expressions so Excel and Sheets import them as text (on by default).",
        "A UTF-8 BOM is included so Excel opens accented text correctly.",
        "Copy puts the filtered rows on the clipboard; the button title states the scope.",
      ),
    ],
  },
  {
    id: "privacy",
    title: "Privacy and security",
    summary: "Nothing leaves this tab — enforced by the browser.",
    blocks: [
      p(
        "Files are read with the File API and parsed in a Web Worker. There is no server API, no analytics and no URL loading.",
      ),
      list(
        "The production page sends a Content-Security-Policy with connect-src 'none', so the browser blocks any outbound request from the page.",
        "Security headers add cross-origin isolation, no-referrer and nosniff.",
        "The site is deployed as static assets — there is no backend to talk to.",
      ),
      note("If you need an audit trail, use Export… or Copy pandas recipe; both are generated locally."),
    ],
  },
];
