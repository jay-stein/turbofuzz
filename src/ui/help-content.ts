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
        "Drop a file on the start screen, click to browse, or paste rows. Supported formats: CSV/TSV/PSV/TXT, JSON, Excel (.xlsx/.xls), Parquet and ZIP/GZ/BZ2 archives. Everything is parsed on your device — the file is never uploaded. Files estimated above about 8 million cells ask how to proceed first: take the first 100,000 rows as a sample, load everything anyway, or cancel — and if a file still exhausts browser memory the worker restarts cleanly with an explanation instead of hanging the tab.",
      ),
      p(
        "After loading you land in the workspace: filters on the left, the table in the middle, and the Data QA strip on top. Fix chips appear above columns and in the left sidebar when the app spots a likely problem.",
      ),
      list(
        "Click a chip to apply its fix — every fix is reversible from the Recipe.",
        "Columns carry a logical type — Text, Category, Integer, Number, Date, Date & time, Time of day, Duration, Boolean, ID — inferred from the values and changeable from the header dropdown. Date stays a calendar date; a timestamp keeps its time-of-day (and any zone offset); ambiguous clock text such as 09:30 stays text until you choose an interpretation.",
        "Click a column name to inspect it — profile, issues and one-click fixes (sort, filter, chart, trim, case, convert, split, round, fill missing, remove duplicates, display format). Right-click a header for the full grouped Column / Clean / Transform menu. Parameter-free cleans (Trim, UPPERCASE, lowercase, Title Case, Convert to number/date, formula escaping) apply instantly with an Undo toast; configurable operations open their panel with that column (and operation) already selected. Drag the divider on a header's right edge to resize it (double-click the divider to reset).",
        "Use Export… when you are done; the dialog states exactly which rows will be written, with an optional first-N subset.",
        "The header Theme control cycles Auto / Light / Dark — Auto follows your operating system.",
        "Help (this drawer) is searchable; the Chart tab shows a chart of the current result set and exports it as a PNG.",
      ),
    ],
  },
  {
    id: "commands",
    title: "Command bar",
    summary: "“Enter a command” (Ctrl/⌘+K) reaches navigation, cleaning, transforms and outputs.",
    blocks: [
      p(
        "Open “Enter a command” in the toolbar or press Ctrl/⌘+K. Start typing to filter suggestions, use the arrow keys to choose, and Enter to run. Data-changing commands ask for confirmation and land in Recipe.",
      ),
      list(
        "Navigation — overview, table, views, reports, quality, chart, help.",
        "Columns — rename notes memo · type amount number · drop notes · dropempty · merge region · headercase snake.",
        "Clean — upper/lower/title/trim (or “all”), number, date, datetime, repair, replace notes \"old\" with \"new\", escape.",
        "Transform — round amount 2 · fill amount median · knn amount 5 · split notes on , · splitregex notes on \\d+ · group region sum amount · dedupe last · melt keep region, year · combine dates · winsorize amount 1 · flag amount.",
        "Filter and sort — filter region active · filter amount 10..20 · sort amount desc · clear filters.",
        "Output — chart region · chart · export · recipe · stats.",
        "Workspace — shuffle · copy · tiles · theme dark/light/auto · help.",
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
        "The Data QA strip starts expanded (it remembers if you collapse it) with the full controls and one profile card per column (histogram for numbers, top values for categories, length stats for text).",
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
    id: "data-quality",
    title: "Data Quality page",
    summary: "The QA dashboard: score, dimensions, what to fix first, checks and the column matrix.",
    blocks: [
      p(
        "The Data Quality page (the DQ tile in the topbar, the “quality” palette command, or the tab between Overview and Table) scores the whole dataset — not the filtered rows — across six dimensions: Completeness, Validity, Uniqueness, Consistency, Timeliness and Accuracy.",
      ),
      list(
        "The ring shows the overall score: a weighted mean of the applicable dimensions. Bands: ≥ 90 good, ≥ 75 fair, below needs work.",
        "Dimension cards show each score, its weight and how many checks fail. Click one to filter the checks list; click again to clear.",
        "What to fix first ranks failing checks by the points they would add back (+x.x pts), so the biggest win is always at the top.",
        "Checks lists every check with exact pass · fail · n-a counts; a ● dot colours its pass rate. “Show failing” filters the table to those rows (undo via the toast).",
        "Column × dimension is the heat matrix — click a cell to filter that column's failures.",
        "Weights & bands opens the settings: change how much each dimension moves the score and where the band thresholds sit. Saved in this browser.",
      ),
      note(
        "Accuracy stays n/a offline (no reference data) and advisory findings (outliers, near-duplicates) never move the score. Copy report and Download JSON export the full breakdown; consistency and timeliness score once you run Compare-with, keydup or a freshness check.",
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
        "Open Clean and pick a column. The Apply button always states what one click will commit — “Apply Trim whitespace” or “Apply 3 operations” — and the configured operation is included even if you never staged it. Use “Add another” to stage a multi-step list first. The preview shows the first cells, a “how many cells change” count and — for number/date conversions — how many non-empty cells still can’t be parsed. Every applied operation is reversible from the Recipe.",
      ),
      p(
        "Clean can also be opened from a column: right-click a header and choose Clean values… or Missing values… — the panel opens on that column and tab. Simple cleans (Trim, case, convert number/date, formula escaping) skip the panel and apply from the same menu with an Undo toast.",
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
    summary: "Dedupe, drop, round, group by, impute, combine dates and reshape.",
    blocks: [
      p(
        "Transforms change the shape of the working set. They run against the base data captured before the first transform, so the pipeline is re-derived from scratch on every change - the Recipe shows the ordered list. Right-click any column header and choose Transform dataset. to jump straight in. The Apply button commits the step configured in the builder together with the list, so you rarely need to stage first; “Add another” stages a longer pipeline. Every staged step gets its own impact note with before → after samples: filled cells and the strategy, identical rows removed, rows that could not be combined, flagged outliers.",
      ),
      list(
        "Remove duplicate rows - keep first, keep last, or remove all copies.",
        "Drop or round columns.",
        "Group by a column with count/sum/min/max/mean/median measures.",
        "Fill missing values - constant, mean, median, mode, forward/backward within a group, or KNN from numeric predictors.",
        "Melt wide columns into variable/value pairs.",
        "Combine date/time columns - tick any set of columns (year, month, day, hour, minute, second, AM/PM, UTC offset, full date, full datetime, time, unix epoch) and give each a role. Auto-detect reads the column name and values, including US (MM/DD) vs day-first dates, 12-hour clocks, compact 1430 times, month names and embedded offsets. Columns named Year, Month and Day (any case) are ticked for you — hour + minute are added when both exist, so the usual case is one click. Offsets found in the data always win and the result is a sortable ISO column.",
        "Split a column - pandas-style str.split(expand=True): split one column into new columns (prefix_1, prefix_2, …) on a text delimiter (comma, semicolon, pipe, any characters) or a simple regular expression. Regex mode uses the pattern's capture groups; without groups it splits on every match. Parts are trimmed, empty parts are dropped by default, the original can be removed, and the number of new columns follows the largest cell (limit 50).",
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
        "Shuffle — show every row in a random order (no sampling).",
      ),
      p("Clicking highlighted text or using a chip filters instantly. “Clear all” resets every filter."),
    ],
  },
  {
    id: "charts",
    title: "Charts",
    summary: "Plot the current result set as one or more charts, animate over time and export PNG, GIF or MP4.",
    blocks: [
      p(
        "The Chart tab in the results bar plots the rows currently matching your filters: histograms for numeric columns, a time series for dates, bars and treemaps for categories, scatter/density/bubble for two numeric columns, and terms for text.",
      ),
      list(
        "Multiple charts: “+ Add chart” opens the chart gallery (grouped by question, with live previews); the icon rail on the left adds any chart type in one click. Picking a type opens a small “Add a … chart” dialog so the columns can be checked before the card lands — the new card is scrolled into view, outlined briefly and announced in the status line, so a stray click can never add an invisible duplicate. The rail can collapse to icons only, and each card has its own type, columns and settings; the layout picker fits 1–4 per row and is remembered between sessions. The expand icon (“Wide”) on any card makes it span the full row — useful for time series or dense heatmaps — and the ⋯ menu has the same toggle.",
        "Bubble: pick X and Y numeric columns and the plane is divided into a grid (Grid = cells per axis, default 40). Each cell with rows becomes a circle (seaborn-style): “Size” is what the circle represents — Count of rows by default, or any numeric column; when a column is chosen, “Reduce” says how the rows in the same area combine (Sum / Mean / Min / Max, e.g. total distance or mean trip duration), and “Mapping” says how values become radius — Area proportional (honest default), Radius proportional, or Log for extreme ranges. A legend at the bottom lists every group when “Group” is used.",
        "Scatter: pick X and Y (numeric or date) and optionally a Colour column (numeric ramp or category palette) and a Size column (numeric). Above 20,000 matching pairs the card switches to a density grid automatically; “Render: Points / Density” overrides that choice. The Pearson r of the plotted pair is annotated in the corner.",
        "Density: an exact 2D histogram of every matching row, drawn with a “Style” control — Heat (exact), Contours (smoothed bands and iso-lines, seaborn-style) or Heat + lines. Both axes follow the same p1–p99 clipping as the other charts.",
        "Box plot: a numeric Value column grouped by a category column. Boxes show q1–median–q3 with 1.5×IQR whiskers and sampled outlier dots; the median value and group size are labelled on each box, and Top groups / “Group rest as Other” work like the bar chart.",
        "Heatmap: two category columns cross-tabulated as a count grid, with “Top per axis” and an Other bucket keeping it readable.",
        "Correlation: pick two or more numeric columns in the list to get a Pearson matrix (pairwise-complete observations). Blue is positive, red negative, and dashed-out cells have too few pairs to measure.",
        "Group: on lines, histograms and bubbles, “Group” splits the chart by a category column — one line or curve per value (histograms), one overlaid bubble set per value (bubbles). Legend entries toggle each group on and off.",
        "Animate over time: bar, bubble, histogram, treemap and density charts can step through a date column. The 🎥 Animate button opens a visible setup row (which date column, and the frame length: hour → year, defaulted from the data's span). A playback bar appears under the chart: play/pause, frame scrubbing, a speed picker (0.5× through 2× plus a Custom multiplier) and loop. Frames are aggregated in the worker in one pass; the date labels each frame.",
        "Export animation: the 🎥 Export button offers Animated GIF (.gif, loops anywhere online) or Video (.mp4, H.264/VP9 via WebCodecs — plays in Windows Media Player, Films & TV, PowerPoint and VLC). Both encode exactly one loop at the current speed. Note: some desktop viewers (e.g. Windows Photos) show animated GIFs as a still first frame; use MP4 there.",
        "Axes: count axes use round ticks (0, 20,000, 40,000 …) instead of the raw maximum, and value axes drop insignificant digits (50k, 1.5M). Axis titles default to the column names — override them and add a unit such as kWh in Settings; long titles truncate with a hover tooltip. Temporal ticks adapt to the span (clock times intraday, dates at day scale, month buckets over years), tick density follows the card width, and timestamp columns read with source offsets are labelled “shown in UTC”.",
        "Focus: the frame icon expands a card into an overlay for a closer look; Escape or × returns it to the grid with every setting intact.",
        "Zoom and pan: charts with a continuous axis zoom with the mouse wheel (anchored at the pointer) and pan by dragging; double-click or the Reset view chip returns to the full range. Lines and histograms zoom their X range through the bins, bars show a movable window over the sorted categories (wheel shows more/fewer, drag moves the window), and scatter/density/map cards zoom their data viewport. Marks clip to the plot area, not the axes.",
        "Map: pick Longitude and Latitude columns (spelling variants like Lattitude are detected). Show switches between one dot per row and a Heat grid. Colour colours the dots (numeric ramp or category palette), Size scales them by a numeric column; in Heat mode the Measure and Reduce controls aggregate every row per cell (e.g. sum(price)) and Grid sets the resolution. Shift+drag draws a filter rectangle over an area.",
        "Colour map: Pastel1 is the default; ColorBrewer and the seaborn palettes are included (deep, muted, pastel, bright, dark, colorblind, rocket, mako, flare, crest, vlag, icefire). Reverse flips the map in one click. Load JSON opens a palette file: an array of hex colours or an object with colors/palette/stops, e.g. [\"#2563eb\",\"#f97316\"] — #abc and #aabbcc both work, two or more colours. The custom palette is saved with the card.",
        "Legends toggle series by click or keyboard (each entry is a button with a pressed state); empty charts explain what to pick instead of rendering blank axes.",
        "Numeric: Start/End default to the column's full range, but when a few extreme values dwarf the rest the End is clipped to the 95th percentile with the “> Max” bar switched on (Full range restores everything). Bounds accept thousands commas and the Bins count is free. “KDE curve” overlays a smooth density line and the median is marked with a dashed line.",
        "Categories: set any number of top bars (default 5) and optionally group the rest as “Other”; every bar shows its count and share above it.",
        "Colours: choose a ColourBrewer/matplotlib colour map (qualitative, sequential, diverging, or a custom hex list) — the default Pastel1 applies to multi-series charts immediately; single-series charts use the palette's first colour until you pick a swatch or type a hex code.",
        "Title: defaults to “source — column” with the type, rows shown and distinct count underneath; type your own title to override it.",
        "Export PNG per card at 1280×720, 1920×1080 (default) or 2560×1440; charts are drawn in logical coordinates so every size keeps the same 16:9 layout.",
      ),
    ],
  },
  {
    id: "process-log",
    title: "Recipe (undo)",
    summary: "Every applied change, individually reversible, plus a pandas or Polars recipe.",
    blocks: [
      p(
        "Recipe lists the changes currently applied to the working set: clean operations, missing-value rules, column type changes, deleted rows and transform steps. The number next to the button counts actions, with batches collapsed.",
      ),
      list(
        "Batches from one action are condensed — for example a clean applied to 20 columns, or the steps from one Transform commit. Click + on a batch to expand its sub-steps, or use the batch's undo icon to reverse the whole batch in one click.",
        "The undo icon reverses one entry; clean operations can be reordered within their column.",
        "Undo all restores the original data (except the loaded file itself).",
        "Copy recipe exports the clean, missing-value, type and transform steps as a pandas or Polars Python script for reproducibility. The drawer shows how many steps export as executable code; steps that need manual translation (KNN, outlier flags, data-dependent fences) are listed in the script header and in the warning comments — never silently omitted.",
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
        "Rows to include — all rows (default) or a first-N subset (default 1,000) taken in the current display order.",
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
      note("If you need an audit trail, use Export… or Copy recipe; both are generated locally."),
    ],
  },
];
