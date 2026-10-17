# Feature Inventory

> This inventory is a register, not a proposal to add every listed capability. Replace examples with verified features from the current application.

## Inventory rules

- Record every existing user-facing capability, including less prominent features.
- Record the exact current location and entry path.
- Do not infer that a feature exists from a roadmap, code symbol or previous AI suggestion; verify it.
- Update this file whenever a feature is added, renamed, relocated, replaced or removed.
- A feature that is difficult to find is not automatically a feature that should be removed.

## Inventory table

| ID | Feature | User job | Current location / entry path | Importance | Discoverability | Dependencies / limitations | Decision / notes |
|---|---|---|---|---|---|---|---|
| F-001 | CSV import | Load data | Verify | Core | Not assessed | Verify formats/limits | |
| F-002 | Dataset overview / profiling | Understand dataset | Verify | Core | Not assessed | Verify metrics | |
| F-003 | Missing-value analysis | Find gaps | Verify | Core | Not assessed | Verify null semantics | |
| F-004 | Duplicate detection | Find repeated records | Verify | Core/useful | Not assessed | Verify key options | |
| F-005 | Column type inference | Understand schema | Verify | Core | Not assessed | Distinguish date and datetime if supported | |
| F-006 | Search / filtering | Locate records | Verify | Core | Not assessed | Verify supported modes | |
| F-007 | Data cleaning / transforms | Fix data | Verify | Core | Not assessed | Verify preview/undo | |
| F-008 | Charts / visualisation | Explore data | Verify | Core | Not assessed | Verify chart types | |
| F-009 | One-click analysis/report | Find insights | Verify | Core/useful | Not assessed | Verify available reports | |
| F-010 | Export cleaned data | Reuse result | Verify | Core | Not assessed | Verify formats and scope | |
| F-011 | Code recipe generation | Reproduce work | Verify | Useful/core | Not assessed | Record supported targets, e.g. pandas/Polars | |
| F-012 | Anomaly / outlier detection | Find suspicious values | Verify | Useful | Not assessed | Explain methods and caveats | |
| F-013 | Time-series analysis | Analyse time-indexed data | Verify | Useful | Not assessed | Verify date/time handling | |

## Discoverability scale

- **D0 — Unknown:** Not tested.
- **D1 — Obvious:** A target user can reasonably find it from the relevant screen.
- **D2 — Findable:** Available through a predictable labelled path.
- **D3 — Hidden/frictional:** Requires guessing, unrelated navigation, or knowledge the user is unlikely to have.
- **D4 — Effectively inaccessible:** Entry path is broken, blocked, or not discoverable by the intended user.

Score only after inspection or a task-based test. Include evidence and test conditions.

## Lifecycle states

Use one of:
- Existing — supported and available.
- Existing but degraded — works but is harder to find or use than intended.
- Planned — not yet implemented.
- Deprecated candidate — proposed for removal but not approved.
- Removed — intentionally removed with a recorded decision and migration/replacement path if needed.

## Required change review

For every UI change, ask:
1. Which existing feature locations or paths are affected?
2. Could a user lose a familiar entry point?
3. Is a capability being duplicated or made harder to find?
4. Does the feature need a redirect, alternative path, tooltip or migration note?
5. Have the inventory and relevant regression tests been updated?
