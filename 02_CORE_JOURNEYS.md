# Core User Journeys

> These are proposed starting points. Confirm which journeys exist and which matter most in the actual application.

For each journey, capture a baseline before redesigning it. Record the starting state, expected steps, result, failure states and relevant screenshot/test IDs.

## J1 — Import a dataset and understand it

**User goal:** Load a CSV and understand what it contains.

**Expected outcome:**
- The user knows whether import succeeded.
- Row and column counts, column names, inferred types and basic quality signals are visible where supported.
- Import errors explain what went wrong and what to do next.
- The original data is not silently altered.

**Test states:** valid CSV, malformed CSV, empty file, duplicate headers, mixed types, large file, unsupported encoding if relevant.

## J2 — Profile data quality

**User goal:** Find the most important data issues.

**Expected outcome:**
- The user can find missing values, duplicate records, inconsistent values, type problems and supported anomaly checks.
- Summary metrics explain their denominator and scope.
- Selecting an issue reveals affected columns/records or a clear explanation when drill-down is unavailable.
- The user can distinguish a warning from a confirmed error.

**Test states:** clean data, multiple issue types, no issues, all values missing in a column, high-cardinality columns.

## J3 — Search, filter and inspect records

**User goal:** Find relevant records quickly.

**Expected outcome:**
- Search and filter controls have clear semantics.
- Active filters are visible and removable.
- Result counts and empty states are clear.
- Clearing filters restores the expected view.
- Search behaviour is consistent for relevant supported data types.

**Test states:** exact text, fuzzy search if supported, sounds-like search if supported, numeric range, date range, no matches, special characters.

## J4 — Clean and transform data

**User goal:** Correct or reshape data safely.

**Expected outcome:**
- The user understands the operation, target columns and affected rows.
- A preview or confirmation is provided for consequential changes where appropriate.
- The user can distinguish pending from applied changes.
- Errors do not silently corrupt or discard data.
- Undo/reset/recovery behaviour is clear where supported.

**Test states:** valid operation, invalid input, zero affected rows, many affected rows, chained operations, undo/reload if supported.

## J5 — Generate an analysis or visualisation

**User goal:** Get useful insight from the current dataset.

**Expected outcome:**
- The user can find appropriate analysis types.
- Required inputs and compatible column types are explained.
- The result is clearly tied to the current data and filters.
- Empty or invalid results are explained.
- Chart labels, units and aggregation semantics are understandable.

**Test states:** numeric, categorical, date-only, datetime and mixed-type data where supported; insufficient data; high-cardinality categories; missing values.

## J6 — Export data or a reproducible recipe

**User goal:** Take the result into another tool or reproduce the work.

**Expected outcome:**
- Export format and scope are clear.
- The user knows whether export includes current filters and transformations.
- Export failure is reported clearly.
- Generated code reflects the actual transformation sequence.
- Supported output targets (for example pandas and Polars) are easy to distinguish.

**Test states:** original data, transformed data, filtered data, empty result, unusual column names, date/datetime types.

## Journey scoring

For each journey, record:
- Completion: pass / partial / fail / not tested.
- Steps/clicks, if meaningful.
- Time to complete, if measured.
- Confusion or recovery points.
- Relevant issue IDs.
- Screenshot or test evidence.
- Regression tests required after changes.

Do not mark a journey as passed solely because the screen looks correct.
