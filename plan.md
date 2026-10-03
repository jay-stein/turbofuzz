Here is the current proposal consolidated into a markdown project spec you can keep as the starting point.

# Browser-Based Fuzzy CSV Search

## 1. Concept

A **fully client-side web application** for rapidly searching and filtering datasets of up to approximately **100,000 rows**.

Users can:

- Upload a CSV
- Paste tabular data
- Select columns to search
- Perform exact, fuzzy, or phonetic ("sounds like") searches
- Apply numerical range filters simultaneously
- Apply categorical filters
- Combine all filters
- Instantly inspect matching rows

The dataset remains entirely in the user's browser. **No backend or database is required.**

The application can be hosted as a static site on **GitHub Pages**.

---

# 2. Core Design Principle

Treat the application as a small **in-browser query engine**, rather than simply a CSV viewer.

Each column gets an appropriate index based on its data type.

```text
                         DATASET
                            │
              ┌─────────────┼─────────────┐
              │             │             │
           Strings       Numbers      Categories
              │             │             │
       ┌──────┼──────┐      │        equality index
       │      │      │      │
     Exact  Fuzzy  Phonetic │
       │      │      │      │
       └──────┴──────┘      │
              │              │
              └──────┬───────┘
                     │
                QUERY ENGINE
                     │
              intersection of
              matching row IDs
                     │
                     ▼
                RESULT ROWS
```

The search engine operates primarily on **row IDs**, rather than repeatedly scanning and processing complete rows.

---

# 3. Example Query

A user might configure:

```text
Customer Name
Fuzzy: "jonson"

Suburb
Sounds like: "malvern"

Annual Usage
5,000 – 10,000

Year
2024 – 2026

Status
Active
```

Internally, each filter produces a set of matching row IDs:

```text
fuzzy("jonson")
        ↓
{ 12, 47, 193, 812, 4012, ... }

sounds_like("malvern")
        ↓
{ 12, 193, 827, 4012, ... }

usage BETWEEN 5000 AND 10000
        ↓
{ 12, 47, 193, 827, 4012, ... }

year BETWEEN 2024 AND 2026
        ↓
{ 12, 47, 193, 4012, ... }

status = "Active"
        ↓
{ 12, 47, 193, 4012, ... }

                 INTERSECTION
                       ↓

              { 12, 193, 4012 }
```

Only those rows need to be displayed.

---

# 4. Recommended Technology Stack

| Component | Technology | Purpose |
|---|---|---|
| Hosting | GitHub Pages | Free static hosting |
| Application | Vite | Development/build tooling |
| Language | TypeScript | Application and query-engine code |
| CSV parsing | Papa Parse | Fast browser CSV ingestion |
| Text search | FlexSearch | Fast indexed text and phonetic searching |
| Advanced fuzzy search | Fuse.js (optional) | More sophisticated fuzzy ranking |
| Background processing | Web Workers | Prevent UI freezing during parsing/indexing/search |
| Results table | TanStack Virtual or equivalent | Efficient rendering of large result sets |
| Persistence | IndexedDB | Optional retention of imported datasets |
| Future analytics | DuckDB-Wasm / Polars-Wasm | Optional analytical/query functionality |

---

# 5. Why Client-Side?

For a dataset of ~100k rows, there is little reason to introduce a server.

### Advantages

- No backend
- No database
- No API
- No hosting cost
- No authentication
- Works from GitHub Pages
- Data never needs to leave the user's machine
- Extremely low latency after indexing
- Easy to distribute as a single public website

The browser effectively becomes the database/search engine.

---

# 6. Data Ingestion

Support two initial input methods.

### CSV upload

```text
[ Choose CSV ]
```

or drag and drop:

```text
┌──────────────────────────────┐
│                              │
│       Drop CSV here          │
│                              │
└──────────────────────────────┘
```

### Paste table

Allow users to paste data copied from:

- Excel
- Google Sheets
- Databricks
- SQL results
- Other tabular applications

The application should detect:

- Headers
- Delimiter
- Column types
- Numeric columns
- Dates
- Boolean/categorical columns

---

# 7. Column Typing

After ingestion, infer or allow the user to specify column types.

Example:

```text
Customer Name     string
Address           string
Suburb            string
Annual Usage      number
Year              integer
Installation Date date
Status            category
Solar             boolean
```

The query engine then selects the appropriate indexing strategy.

---

# 8. Search Types

## 8.1 Exact Search

Useful for identifiers and exact values.

```text
NMI = "123456789"
```

Should be essentially an indexed lookup.

---

## 8.2 Normal Text Search

Example:

```text
melb
```

Matches values such as:

```text
Melbourne
Melbourne VIC
North Melbourne
Melbourne CBD
```

---

## 8.3 Fuzzy Search

Handles spelling errors and approximate matches.

Example:

```text
jonson
```

Could return:

```text
Johnson
Jonson
Johnston
Johnsen
```

Results should have a relevance score.

Example:

```text
Johnson        0.97
Jonson         0.95
Johnston       0.87
Johnsen        0.81
```

The score is a **search relevance score**, not a user-facing rating of anything substantive.

---

## 8.4 Phonetic / "Sounds Like"

Designed for names and words that sound similar.

Example:

```text
smith
```

Potential matches:

```text
Smith
Smyth
Smithe
```

This should be implemented separately from ordinary fuzzy matching.

FlexSearch is particularly interesting here because it supports phonetic encoders.

---

# 9. Numeric Filtering

Numeric columns should use native numeric representations rather than text search.

Support:

```text
> 5000

>= 5000

< 10000

<= 10000

5000 – 10000
```

Example:

```text
Annual Usage

[ 5000 ] ───────── [ 10000 ]
```

Potential future support:

- Multiple ranges
- Dates
- Relative dates
- Histograms
- Range sliders

---

# 10. Categorical Filtering

Categorical columns should support:

```text
Status
☑ Active
☐ Inactive
☐ Pending
```

and potentially:

```text
Retailer
☑ AGL
☑ Origin
☐ EnergyAustralia
☐ Other
```

Multiple selections can be treated as OR within the column and AND across columns.

Example:

```text
Retailer = AGL OR Origin

AND

Status = Active
```

---

# 11. Query Engine

The UI should construct a structured query rather than directly performing searches.

Example:

```json
{
  "customer_name": {
    "type": "fuzzy",
    "value": "jonson"
  },
  "suburb": {
    "type": "phonetic",
    "value": "malvern"
  },
  "annual_usage": {
    "type": "range",
    "min": 5000,
    "max": 10000
  },
  "year": {
    "type": "range",
    "min": 2024,
    "max": 2026
  },
  "status": {
    "type": "equals",
    "value": "Active"
  }
}
```

The query engine executes the filters and intersects their row-ID sets.

---

# 12. Web Worker Architecture

The expensive work should happen outside the browser's main UI thread.

```text
                    MAIN THREAD
                         │
                 User interaction
                         │
                         ▼
                  Query definition
                         │
                         ▼
                    WEB WORKER
                         │
          ┌──────────────┼──────────────┐
          │              │              │
       Fuzzy          Phonetic       Numeric
       index           index          filters
          │              │              │
          └──────────────┼──────────────┘
                         │
                    Row ID results
                         │
                         ▼
                    MAIN THREAD
                         │
                         ▼
                  Virtualised table
```

This prevents a large CSV or expensive fuzzy search from making the UI appear frozen.

---

# 13. Search Indexes

Conceptually:

```text
String indexes
├── customer_name → fuzzy index
├── suburb        → phonetic index
├── address       → fuzzy index
└── retailer_name → exact/fuzzy index

Numeric indexes
├── annual_usage
├── year
└── postcode

Categorical indexes
├── status
├── retailer
└── state
```

The application does **not necessarily need to index every column immediately**.

An initial implementation could index only columns selected by the user.

---

# 14. Result Rendering

Never render 100,000 HTML table rows simultaneously.

Use a virtualised table.

The browser might have:

```text
100,000 rows in memory

↓

2,347 matching rows

↓

Only ~30–100 visible DOM rows
```

As the user scrolls, rows are recycled.

This keeps the UI responsive.

---

# 15. User Interface

Initial concept:

```text
┌───────────────────────────────────────────────────────────┐
│  FuzzyFind                                                │
│                                                           │
│  Drop CSV here                    [ Choose CSV ]           │
│                                                           │
│  100,000 rows × 12 columns                                │
│                                                           │
├───────────────────────────────────────────────────────────┤
│                                                           │
│  Customer Name                                            │
│  [ Fuzzy ▼ ]       [ jonson________________________ ]     │
│                                                           │
│  Suburb                                                   │
│  [ Sounds like ▼ ] [ malvern_______________________ ]     │
│                                                           │
│  Annual Usage                                             │
│  [ 5,000 ] ───────────────────────────── [ 10,000 ]      │
│                                                           │
│  Year                                                     │
│  [ 2024 ] ────────────────────────────── [ 2026 ]         │
│                                                           │
│  Status                                                   │
│  [ ☑ Active ] [ ☐ Inactive ] [ ☐ Pending ]                │
│                                                           │
│                  237 matching rows                        │
│                                                           │
├───────────────────────────────────────────────────────────┤
│ Customer Name       Suburb       Usage       Status       │
│                                                           │
│ Johnson Energy      Malvern      7,842       Active       │
│ Jonson & Co         Malvern      6,293       Active       │
│ Smyth Electrical    Malvern      8,112       Active       │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

---

# 16. Performance Target

The target should be:

### Initial load

Potentially:

```text
CSV
  ↓
Parse
  ↓
Infer types
  ↓
Build indexes
```

This may take a noticeable amount of time for a large CSV.

Show progress:

```text
Loading...
████████████████░░░░ 78%

Indexing Customer Name...
```

### Subsequent searching

Aim for effectively instantaneous interaction:

```text
Type character
      ↓
query
      ↓
index lookup
      ↓
intersection
      ↓
render
```

The goal is **tens-of-milliseconds-class interaction where practical**, rather than promising a specific latency across all hardware and datasets.

---

# 17. Privacy Model

One of the strongest features of the architecture:

> **The CSV never needs to be uploaded.**

Everything happens locally:

```text
User's computer

CSV
 │
 ▼
Browser
 │
 ├── parser
 ├── indexes
 ├── query engine
 └── results
```

GitHub Pages only serves the application itself.

This makes the tool potentially useful for sensitive business datasets without requiring a data-upload service.

---

# 18. Persistence — Optional Phase 2

Use IndexedDB to optionally retain datasets locally.

For example:

```text
Recent datasets

• Customers.csv
  100,284 rows
  Imported 2 hours ago

• Meter data.csv
  87,391 rows
  Imported yesterday
```

The actual data remains in the browser's local storage rather than being uploaded to a server.

---

# 19. Possible Phase 2 Features

Once the search engine works, the project could expand into a lightweight browser data workbench.

Potential features:

### Data profiling

```text
Rows                 100,284
Columns                   17
Missing values          2.3%
Duplicate rows          1,241
```

### Column statistics

```text
Annual Usage

min       0
median    4,821
mean      5,293
max       91,284
```

### Deduplication

```text
Find similar customer names
```

This could combine:

- exact matching
- fuzzy matching
- phonetic matching

### Data transformation

Eventually:

```text
Filter
Sort
Group
Aggregate
Join
Deduplicate
Calculate columns
```

At that point, **DuckDB-Wasm or Polars-Wasm** becomes more attractive.

---

# 20. Initial Scope — Keep It Small

The first version should deliberately avoid becoming a general-purpose data platform.

### MVP

- [x] CSV upload
- [x] Paste tabular data
- [x] Automatic column type detection
- [x] Exact search
- [x] Fuzzy search
- [x] Sounds-like search
- [x] Numeric ranges
- [x] Categorical filters
- [x] Multiple simultaneous filters
- [x] Virtualised results
- [x] Web Worker
- [x] 100k-row target
- [x] GitHub Pages deployment
- [x] No backend

### Later

- [ ] IndexedDB persistence
- [ ] Data profiling
- [ ] Deduplication
- [ ] Advanced transformations
- [ ] DuckDB-Wasm / Polars-Wasm
- [ ] Export filtered results
- [ ] Saved searches
- [ ] Multiple datasets

---

# 21. Recommended Development Order

### Stage 1 — Basic data ingestion

Build:

```text
CSV → Papa Parse → typed dataset → table
```

Target:

> 100k rows can be loaded without the browser becoming unusable.

### Stage 2 — Virtualised table

Add efficient rendering.

### Stage 3 — Exact filtering

Implement:

```text
equals
contains
numeric range
categorical selection
```

### Stage 4 — Fuzzy search

Add FlexSearch/Fuse and benchmark against 10k / 50k / 100k rows.

### Stage 5 — Phonetic search

Add the "sounds like" index.

### Stage 6 — Query engine

Combine filters:

```text
fuzzy
AND
phonetic
AND
numeric range
AND
categorical
```

### Stage 7 — Web Worker

Move parsing/indexing/searching off the main thread.

### Stage 8 — Polish

Add:

- progress indicators
- search highlighting
- result counts
- column selection
- filter controls
- keyboard shortcuts
- export

### Stage 9 — GitHub Pages

Build and deploy the static application.

---

# 22. Key Architectural Decision

The central idea is:

> **Don't build a website that searches a CSV. Build a tiny search/query engine that happens to run inside a website.**

That distinction gives the project room to grow.

The initial product can be:

```text
             CSV
              ↓
       ┌──────────────┐
       │ Browser      │
       │              │
       │ Search       │
       │ + Filters    │
       │ + Indexes    │
       │ + Query      │
       └──────┬───────┘
              ↓
          Results
```

while eventually becoming:

```text
             DATASET
                ↓
       ┌─────────────────┐
       │ Browser Data    │
       │ Engine          │
       │                 │
       │ Search          │
       │ Filter          │
       │ Fuzzy match     │
       │ Phonetic match  │
       │ Sort            │
       │ Aggregate       │
       │ Transform       │
       │ Deduplicate     │
       └─────────────────┘
```

The important constraint remains: **100k-ish rows, local-first, extremely fast interaction, zero required backend.**

This is a solid basis for turning it into a real GitHub project. The next useful design step would be a **technical architecture/spec for the actual TypeScript classes, data structures, indexes and Web Worker message protocol** before writing code.