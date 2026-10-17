# Information Architecture Rules

> These are guardrails, not a mandate to use a particular tab layout. First document the current structure; only change it when evidence supports the change.

## Principles

1. Organise around user tasks and mental models, not internal code modules.
2. Keep the current dataset and its state understandable across workflows.
3. Prefer stable, predictable locations for recurring actions.
4. Distinguish dataset-wide tasks from column-specific and record-specific tasks.
5. Do not mix navigation, destructive actions and incidental settings without clear hierarchy.
6. Avoid multiple competing places for the same capability unless the duplication is intentional and useful.
7. Advanced features may be progressively disclosed, but their location must be predictable and labelled.
8. Preserve familiar entry points when changing navigation, or provide a clear replacement path.
9. Keep contextual actions close to the object they affect.
10. On smaller screens, prioritise core workflows and ensure secondary actions remain findable.

## Proposed task model to validate

- **Data:** import, dataset overview, schema, preview.
- **Quality:** profiling, missingness, duplicates, type problems, anomalies.
- **Explore:** search, filter, group, compare, chart.
- **Transform:** cleaning operations, derived columns, reshaping, operation history.
- **Analyse:** one-click reports, descriptive statistics, relationships, time series where supported.
- **Export:** cleaned data, summaries, code recipes such as pandas/Polars where supported.

This is a hypothesis only. Do not implement this structure without mapping the current application and validating that it reduces user effort.

## Placement decision checklist

Before adding or moving a feature:
- What user task does it support?
- Where would a target user expect to find it?
- Is it global, dataset-level, column-level or record-level?
- Does it depend on a particular selection or data type?
- Will users need it frequently?
- Is there a useful contextual entry point?
- Will the change create duplication or bury an existing capability?
- What current paths must remain available?
- What evidence will show the new placement is better?

## Navigation change acceptance criteria

A navigation change is not complete until:
- Existing features are accounted for in the feature inventory.
- Important journeys still have clear entry points.
- Labels are understandable and consistent.
- Empty, loading and error states are handled.
- Relevant old and new paths have been tested.
- Screenshots and the inventory are updated.
