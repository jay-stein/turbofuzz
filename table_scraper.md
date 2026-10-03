# Specification: Advanced Data Grid & Table Extractor

## 1. Objective

To autonomously identify, isolate, score, and extract the single most data-rich tabular dataset from a given webpage. The system must successfully parse native HTML tables, CSS/Div-based grids, and Shadow DOM components, while actively bypassing structural layouts, trivial data, and hidden junk DOM elements.

## 2. Candidate Identification & Traversal

The scraper must build a comprehensive list of all potential tabular structures, regardless of the underlying front-end framework.

### 2.1. DOM Traversal Strategy

* **Deep Querying:** The scraper will not rely solely on `document.querySelectorAll`. It must implement a recursive traversal function to pierce **Shadow DOM boundaries** (accessing `element.shadowRoot`) to find web components.
* **Iframe Resolution:** The scraper will evaluate same-origin iframes by accessing `iframe.contentDocument` and applying the same traversal logic. Cross-origin iframes will be ignored due to browser security policies unless operating as a privileged browser extension.

### 2.2. Valid Selectors

Elements matching any of the following criteria will be added to the candidate list:

* `<table`> (Standard HTML tables)
* `[role="table"]` (ARIA tables)
* `[role="grid"]` (ARIA grids, often used by React/Angular data grid libraries)
* `[role="treegrid"]` (Hierarchical data grids)

### 2.3. Exclusion Criteria

Remove candidates that match any of the following:

* Possess `role="presentation"` or `role="none"`.
* Contain fewer than 2 distinct columns or 3 distinct rows.
* Are completely invisible in the viewport (computed style `display: none`, `visibility: hidden`, or bounding box area of 0).

## 3. Pre-Processing & Stitching

Modern web design frequently splits tables to maintain sticky headers. Before scoring, the scraper must evaluate the candidate list for split structures.

* **Proximity Check:** If two candidates are adjacent in the DOM hierarchy or share identical column structures (exact same number of columns and matched column widths via `getBoundingClientRect()`).
* **Header/Body Complementarity:** If Candidate A contains predominantly headers (`<th>` or `role="columnheader"`) and Candidate B contains data rows, stitch them into a single virtual candidate for scoring and extraction.

## 4. Enhanced Scoring Logic (Data Richness Score - DRS)

Each unified candidate receives a Data Richness Score to determine the primary target.

### 4.1. True Area Calculation

Determine the true dimensions of the dataset, accounting for virtualized lists.

* **Rows:** Check for `aria-rowcount`. If present and valid, use this integer. Otherwise, count the physical row elements (`<tr>` or `[role="row"]`).
* **Columns:** Check for `aria-colcount`. If present, use this integer. Otherwise, determine the maximum number of cells (`<td>`, `<th>`, `[role="cell"]`, `[role="gridcell"]`) in any single row.
* *Score Component:* `(Rows * Columns) * 0.4`

### 4.2. Visible Text Volume

To prevent inflated scores from hidden SVGs, massive inline scripts, or stringified JSON payloads, calculate the visible text payload.

* Iterate through all cells.
* Extract text using `innerText` (which respects CSS visibility) rather than `textContent` (which captures hidden DOM nodes).
* Strip out whitespace. Count the remaining characters.
* *Score Component:* `Visible Character Count * 0.3`

### 4.3. Cell Density & Structure Ratio

Evaluate how populated and structured the table is.

* **Density:** Calculate the percentage of cells that contain at least one visible alphanumeric character.
* **Structure:** Heavily weight candidates that utilize explicit header definitions (`<th>` or `role="columnheader"`).
* *Score Component:* `(Density Percentage * 100) + (Header Presence Bonus: 50 points)`

### 4.4. Selection

Sort all candidates by their final DRS descending. The candidate at index `0` is the target dataset.

## 5. Extraction Protocol

Once the target is identified, the scraper reconstructs the grid into a standardized JSON or CSV format.

### 5.1. Header Resolution

1. Target the first row, `<thead>`, or elements with `role="columnheader"`.
2. Extract the `innerText` of each cell.
3. If headers are absent or purely numerical, generate generic headers (e.g., `Column_1`, `Column_2`).

### 5.2. Row Iteration & Data Cleaning

1. Iterate through all data rows (`<tr>` or `[role="row"]`).
2. Extract the `innerText` of each cell (`<td>` or `[role="gridcell"]`).
3. Normalize whitespace (replace multiple spaces/newlines with a single space).
4. **Span Resolution:** If a cell has `colspan` or `rowspan` attributes, duplicate the cell's extracted text into the adjacent virtual columns/rows to ensure the final output is a perfectly symmetrical grid (preventing offset data in CSVs).

### 5.3. Handling Virtualized Datasets (Extraction Phase)

If the target grid utilized `aria-rowcount` indicating more rows than are physically present in the DOM, the scraper will execute an automated scroll routine:

1. Identify the scrollable container (usually the immediate parent `<div>` with `overflow-y: auto`).
2. Programmatically scroll the container by its client height.
3. Observe DOM mutations to capture new rows as they are injected, storing them in a `Set` based on a unique row identifier or exact text match to prevent duplication.
4. Terminate scrolling when the bottom of the container is reached or no new rows are injected after a 2-second timeout.