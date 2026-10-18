# Charting Aggregation & Exploration UX Specification

**Status:** Draft  
**Audience:** Product, UX, frontend, data/analytics engineering  
**Purpose:** Define a consistent, approachable charting experience for arbitrary tabular data uploaded from CSV and similar sources.

## 1. Overview

The chart builder must make common analytical aggregations available directly in the charting workflow. Users should be able to upload raw tabular data, select fields, and produce a meaningful chart without first writing SQL, creating a transformation recipe, or understanding a dataframe API.

The charting experience should combine:

- Context-aware aggregation and grouping.
- Automatic but transparent defaults.
- Temporal bucketing and numeric binning.
- Multiple grouping dimensions.
- Lightweight exploratory calculations.
- Inspection of the data behind a chart.
- A declarative chart specification that can drive rendering and, where supported, generate equivalent pandas and Polars recipes.

The product should borrow useful patterns from BI and data platforms while remaining simpler than a traditional enterprise BI authoring experience.

## 2. Goals

1. Make common aggregations discoverable and easy to configure.
2. Generate a sensible initial chart with minimal user effort.
3. Allow users to adjust grouping, time grain, and aggregation without rebuilding a chart.
4. Clearly distinguish raw-row aggregation from post-aggregation calculations and data transformations.
5. Avoid misleading results caused by null values, missing time periods, inappropriate aggregation, or chart preview limits.
6. Keep the chart configuration reproducible and exportable as a recipe where practical.
7. Support varied datasets, including messy CSV data, rather than assuming a predefined business data model.

## 3. Non-goals for the initial release

The initial release does not need to provide a full enterprise semantic layer, arbitrary SQL authoring, advanced statistical modelling, automated causal analysis, or a complete dashboard layout editor. Advanced capabilities should not delay a robust basic aggregation experience.

## 4. Core interaction model

The chart builder should be organised around three questions:

1. **What am I measuring?** Select one or more measures and how each is aggregated.
2. **How should the data be grouped?** Select an X-axis/grouping field, a time grain or numeric binning rule when applicable, and optional additional dimensions.
3. **How do I want to explore or compare the result?** Add filters, sorting, limits, breakdowns, reference calculations, or drill-down actions.

### 4.1 Suggested layout

Provide a chart preview and a compact configuration panel containing:

- **Chart type**: line, bar/column, scatter, histogram, pie/donut where appropriate, and other supported types.
- **Measure (Y-axis)**: field plus aggregation function.
- **Group by (X-axis)**: field plus temporal grain or numeric binning options where applicable.
- **Break down by**: optional second categorical dimension, generally represented by colour, stacked/grouped series, or small multiples.
- **Filters**: chart-level filters with visible active-filter indicators.
- **Quick calculations**: optional rolling, cumulative, percentage, or period-comparison calculations.
- **Advanced settings**: axis settings, null handling, interpolation, and other less commonly used controls.

Keep the main path compact. Do not expose every statistical function or rendering setting at once; use context-sensitive menus and an Advanced section.

### 4.2 Automatic starting point

When a user selects fields or opens the chart builder, propose a useful starting configuration based on column profiling and data types. Render the preview immediately when feasible. Show the selected aggregation and grouping clearly—for example, **Sum of Revenue by Month**—rather than hiding assumptions behind an automatic choice.

Automatic suggestions must be overridable and must not silently imply that a guessed relationship or derived metric is confirmed.

## 5. Aggregation and grouping capabilities

### 5.1 Aggregation functions by field type

Only show functions that are valid or meaningful for the selected field type.

| Field type | Common functions | Notes |
|---|---|---|
| Numeric | Sum, mean, median, min, max, count, distinct count, standard deviation, variance, percentiles | Make clear how nulls are treated. Count and distinct count are separate concepts. |
| Categorical/string | Row count, distinct count, percentage of rows, top categories | Numeric summary functions should not be offered unless a well-defined conversion is explicitly available. |
| Date/time | Count, earliest, latest, time bucketing, elapsed duration when meaningful | Date/time bucketing is usually a grouping operation rather than a measure aggregation. |
| Boolean | True count, false count, true percentage, missing count | State the denominator for percentages. |
| Unknown/mixed | Row count and supported operations only | Prompt users to review or correct inferred types if results appear ambiguous. |

At minimum, implement **sum, mean, median, min, max, row count, non-null count, distinct count, and percentage of total**. Standard deviation, variance and configurable percentiles can follow if needed.

### 5.2 Count semantics

The interface must distinguish:

- **Row count:** number of rows in each group.
- **Non-null count:** number of non-null values in the selected field.
- **Distinct count:** number of unique non-null values, unless the product explicitly documents a different convention.

Do not label all of these simply as “Count”.

### 5.3 Multiple grouping dimensions

Support combinations such as:

- Revenue by month and region.
- Consumption by hour and customer type.
- Orders by product and status.

The second grouping dimension may be shown as colour/series, stacked or grouped bars, or small multiples depending on chart type and readability. The UI must limit or warn about combinations that create an unmanageably large number of series.

### 5.4 Category limits and sorting

For charts with many categories:

- Default to a readable number of categories, initially 10 where appropriate.
- Allow the user to change the category limit or show all categories.
- Support sorting by aggregated value, category label, or chronology when relevant.
- Offer an optional **Other** bucket for excluded categories.
- Make the limit and any “Other” grouping visible, so the chart cannot be mistaken for a complete category breakdown.

The exact default limit may vary by chart type and screen size.

## 6. Temporal aggregation

### 6.1 Supported time grains

Provide context-appropriate time grains, including:

- Minute
- Hour
- Day
- Week
- Month
- Quarter
- Year

For common energy and operational time series, support interval-level grains such as 30-minute and 15-minute intervals where useful and where the data supports that resolution.

Do not show every possible grain for every dataset. Available grains should depend on the detected timestamp range, precision, and number of observations.

### 6.2 Automatic grain selection

Choose a default time grain based on the time span and the approximate number of plotted points. The default should produce a readable chart without hiding meaningful variation.

The chosen grain must be visible and easy to change. The system should not silently coarsen or discard data without indicating the selected grain.

### 6.3 Calendar options

Where applicable, provide options for:

- Week start day.
- Calendar versus financial/fiscal year.
- Calendar versus financial quarter.
- Day of week.
- Hour of day.
- Month of year.

Advanced calendar settings can be deferred, but the data model should avoid hard-coding assumptions that make future support difficult.

### 6.4 Irregular time series and missing periods

The tool must distinguish a missing observation from a value of zero.

Where appropriate, allow users to:

- Display gaps in the chart.
- Generate a continuous time axis or series of time buckets.
- Fill missing periods using an explicitly selected policy, such as zero, forward fill, or interpolation when valid.
- See a warning or indicator when periods are absent.

Do not impute missing values or missing periods silently. Clearly distinguish observed data from filled or interpolated values.

### 6.5 Time zone and daylight-saving behaviour

If timestamps include time-zone information, preserve and use it consistently. If timestamps are timezone-naive, do not invent a timezone silently; use the documented dataset/application default and make the interpretation accessible to the user. Handle daylight-saving transitions explicitly, especially for local-time hourly and sub-hourly charts.

## 7. Numeric binning and distributions

For continuous numeric fields, support binning into ranges. Useful modes include:

- Equal-width bins.
- Equal-frequency/quantile bins.
- User-defined bin width or boundaries, where feasible.

Examples include price ranges, age bands, order values, durations, demand levels, and consumption ranges.

A numeric field selected on its own should be able to produce a histogram or another appropriate distribution summary. Display readable labels and define how boundary values are assigned to bins. Avoid silently dropping out-of-range values when custom bins are used.

## 8. Chart calculations and derived measures

Chart calculations operate on aggregated chart results or across an ordered series. They must be distinguished in the interface from aggregation of raw rows and from permanent dataset transformations.

Potential calculations include:

- Rolling mean and rolling sum.
- Cumulative sum.
- Percentage of total.
- Period-over-period absolute and percentage change.
- Year-over-year comparison.
- Index to 100/base-period normalisation.
- Weighted average when a valid weight field is provided.
- Reference lines or target values.

Not all calculations need to ship initially. Each calculation must define its ordering, window, denominator, treatment of missing periods, and behaviour when the required inputs are unavailable.

### 8.1 Operation categories

Keep the following concepts separate in the UI and internal configuration:

| Operation | Example | Primary role |
|---|---|---|
| Aggregation | Sum revenue by month | Combines raw rows within groups |
| Bucketing | Group timestamps by hour | Defines group boundaries |
| Derived column | Revenue = price × quantity | Creates a value from row-level fields |
| Window calculation | 7-day rolling average | Calculates across an ordered result or row window |
| Normalisation | Index a series to 100 | Rescales values for comparison |
| Filtering | Only show 2025 | Selects which rows/groups are included |
| Resampling/materialisation | Produce one record per hour | Creates a transformed or reusable dataset |

The user should not need to understand these distinctions to create a basic chart, but advanced options and recipe output should preserve them accurately.

## 9. Smart chart suggestions

Use field profiling and combinations of column types to suggest chart configurations.

| Detected fields or pattern | Suggested starting point |
|---|---|
| Date/time + numeric | Line chart; choose a sensible time grain and suitable aggregation |
| Category + numeric | Sorted bar chart; select sum or mean based on context and show the choice |
| Category + numeric + date/time | Time series with optional category breakdown |
| Two numeric fields | Scatter plot |
| One numeric field | Histogram and distribution summary |
| One categorical field | Frequency bar chart |
| Start date/time + end date/time | Duration distribution or timeline, when valid |
| Latitude + longitude | Map, if map visualisation is supported |
| Boolean/status field | Count by status and optionally percentage of rows |

Suggestions must be grounded in detected field types and profile statistics. They must not silently create speculative business metrics. For example, `price × quantity` may be suggested as a derived measure when appropriate, but should not be assumed to represent revenue without user confirmation.

## 10. Exploration and drill-down

Make charts interactive enough to support lightweight analysis, not just presentation.

Potential interactions include:

- Select a chart point or bar to inspect its value and contributing records.
- Drill from a coarser time grain to a finer grain, such as year → quarter → month → day.
- Break down a selected period/category by another field.
- Filter the dataset or chart to the selected point/group.
- Open the underlying rows contributing to an aggregated value.
- Compare the selected group with another period or category.
- Duplicate a chart to try an alternative configuration.
- Undo recent configuration changes and reset to the default chart.

When showing underlying records, indicate the active filters and grouping criteria that produced the chart value. Do not imply that a chart selection filters the whole dataset unless that behaviour is explicit.

## 11. Data quality, correctness, and transparency

### 11.1 Nulls and invalid values

- Define and consistently apply null handling for every aggregation.
- Surface missing-value counts when they materially affect a selected measure or grouping.
- Distinguish nulls, empty strings, invalid parsed values, and zero values where the ingestion layer supports doing so.
- Avoid presenting incomplete totals as unquestionably complete.
- Ensure category values such as empty strings and explicit “Unknown” labels are not conflated without a defined policy.

### 11.2 Full-data semantics

Aggregation must use the complete eligible dataset, not only the rows loaded for a visual preview. If computation is intentionally approximate or based on a sample, the interface must disclose that fact.

### 11.3 Sorting and ordering

- Time axes must use chronological ordering, not lexicographical label ordering.
- Numeric bin labels must sort by their numeric boundaries.
- Category sorting should be deterministic.
- Window calculations must use a well-defined ordering and tie-breaking policy where needed.

### 11.4 Units and additive measures

The tool should preserve available units and avoid implying that all measures can be summed meaningfully. For example, interval energy can often be summed across intervals, while instantaneous power is not equivalent to energy and may need an average or duration-weighted calculation. Where the application cannot infer semantic units reliably, offer valid operations but make the selected aggregation explicit.

### 11.5 Performance and large datasets

The charting experience should remain responsive for datasets of approximately 100,000 rows as a target initial use case, subject to the application's current architecture. Avoid recomputing expensive profiling and aggregation work unnecessarily. Debounce interactive configuration changes where appropriate, cancel stale computations, and provide loading or error states for longer-running operations.

## 12. Declarative chart configuration and recipe generation

Represent chart intent in a declarative configuration rather than embedding aggregation logic solely in visual components. The same configuration should drive chart rendering and, where feasible, pandas and Polars recipe generation.

The configuration should be capable of representing at least:

- Source dataset/reference.
- Chart type.
- X/grouping fields.
- Measure field(s).
- Aggregation function for each measure.
- Temporal grain or numeric bin definition.
- Additional grouping dimensions.
- Filters.
- Category limit, “Other” behaviour, and sorting.
- Null and missing-period policies where configurable.
- Post-aggregation calculations.
- Display options required to reproduce the chart meaningfully.

### 12.1 Recipe consistency

- Rendering and generated code must use equivalent aggregation definitions.
- Pandas and Polars outputs should produce equivalent results for supported operations, including documented null and time-bucketing semantics.
- Unsupported operations must be identified explicitly; do not silently generate code with different meaning.
- Recipe output should be readable and editable, with the key steps in a logical order.
- Aggregation should be expressed using idiomatic operations for each target library, rather than forcing both through an artificial common syntax.

## 13. Suggested implementation phases

### Phase 1 — Core aggregation UX

- Measure and grouping field selection.
- Context-aware aggregation menu.
- Row count, non-null count, distinct count, sum, mean, median, min and max.
- Temporal bucketing for common grains.
- Basic category grouping and an optional second dimension.
- Sorting, category limits, and optional “Other” grouping.
- Clear null handling and missing-data indicators.
- Correct aggregation over the full dataset.
- Sensible chart suggestions and visible defaults.

### Phase 2 — Exploratory analysis

- Drill-down and inspection of contributing rows.
- Numeric histograms and configurable binning.
- Percentage of total and cumulative calculations.
- Rolling averages and period-over-period comparisons.
- Better category breakdowns and chart duplication/reset/undo.
- Improved missing-period controls and time-series profiles.

### Phase 3 — Advanced analytics and portability

- Weighted averages, percentiles and further statistical functions.
- Financial calendars and custom fiscal periods.
- Explicit imputation options and advanced resampling.
- Reference lines and anomaly overlays.
- Reusable chart configurations.
- Equivalent pandas and Polars recipe generation for supported features.

## 14. Acceptance criteria

The initial implementation is acceptable when all of the following are true:

1. A user can upload a dataset containing a date/time field, category field, and numeric field, and create an aggregated chart without writing code.
2. The user can select a numeric measure and choose a supported aggregation function from a context-appropriate menu.
3. The user can group data by a category and by a supported time grain.
4. The selected aggregation and time grain are clearly visible in the UI.
5. The user can add a second grouping dimension when supported by the chart type.
6. The chart uses all eligible rows or clearly discloses if a sample/approximation is being used.
7. Row count, non-null count, and distinct count are presented as distinct operations.
8. Null values and absent time periods are not silently treated as zero.
9. Time axes are chronologically ordered, and category/bin sorting behaves predictably.
10. High-cardinality charts remain readable through category limits and sorting, with any “Other” bucket clearly identified.
11. Changing the aggregation or grouping updates the chart without requiring a new data transformation.
12. The underlying chart configuration can be inspected or represented in a reproducible declarative form.
13. If recipe generation is implemented, supported chart configurations produce semantically equivalent pandas and Polars code, or clearly identify unsupported cases.
14. Empty data, invalid types, all-null measure columns, and failed computations produce understandable empty/error states rather than misleading charts.

## 15. Edge cases to test

- Date values represented as strings in multiple formats.
- Date-only values versus timestamps.
- Duplicate timestamps and irregular sampling intervals.
- Time zones and daylight-saving transitions.
- Missing days/months and groups with no observations.
- Numeric columns containing nulls, empty strings, invalid strings, and mixed types.
- Negative values and zero values.
- High-cardinality categorical fields.
- Categories with equal aggregate values.
- Very long category labels.
- All-null or constant columns.
- Distinct counts with nulls and mixed representations.
- A dataset whose profiling sample differs from the full dataset.
- Numeric bins with values on bin boundaries and outside user-defined ranges.
- A selected chart aggregation that is not meaningful for the domain's units.
- A large chart configuration that produces too many series or too many points.

## 16. Product principles

1. **Smart defaults, visible assumptions.** Suggest the likely useful option, but show users what was selected.
2. **Simple first, advanced when needed.** Keep the main charting path approachable without limiting advanced exploration.
3. **Correctness before decoration.** Accurate grouping, null behaviour, ordering and full-data semantics matter more than adding many chart types.
4. **One definition, multiple outputs.** Chart rendering and recipe generation should share a declarative representation.
5. **Exploration without destructive edits.** Chart calculations should not alter source data unless the user explicitly chooses a transformation.
6. **Progressive disclosure.** Expose controls when relevant to the field type, chart type or current task.

## 17. Success measures

Possible product metrics include:

- Time from file upload to first meaningful chart.
- Percentage of chart sessions completed without code or a separate transformation recipe.
- Rate of users changing an automatically selected aggregation or time grain.
- Percentage of charts that use a second grouping dimension or a chart calculation.
- Error rates and latency for chart updates on representative dataset sizes.
- User-reported confidence that the chart accurately reflects the data.

Use these measures to assess whether the tool is both faster and more trustworthy than a manual chart-building workflow.
