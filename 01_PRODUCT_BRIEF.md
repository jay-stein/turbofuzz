# Product Brief

> Status: Draft — validate against the real product before treating this as authoritative.

## Product in one sentence

A browser-based tool that helps people inspect, understand, clean, transform, analyse and export messy tabular data with minimal setup.

## Intended users

Confirm the actual audience. Possible user groups include:
- Analysts working with CSV exports and spreadsheets.
- Data scientists exploring unfamiliar datasets.
- Operations or business users diagnosing data-quality issues.
- Developers who want reproducible cleaning recipes.

Do not assume every user group is equally important. Select a primary user and record their top tasks.

## Core value

Help users move from an unfamiliar or messy dataset to a trustworthy understanding, useful analysis, and an exportable result.

## Product outcomes

1. Users can quickly understand the shape and quality of a dataset.
2. Users can find relevant records and diagnose data problems.
3. Users can clean or transform data without losing control of what changed.
4. Users can discover suitable analyses and visualisations.
5. Users can export results and, where supported, reproducible code.
6. Users can recover from mistakes and understand errors.

## Non-goals for UX work

- Adding features solely because competitors have them.
- Redesigning unrelated screens during a targeted fix.
- Optimising visual novelty at the expense of consistency.
- Hiding advanced capabilities without a clear discoverability path.
- Claiming usability success without observing user tasks or tests.

## Design principles

### 1. Preserve user control
Show previews for potentially destructive transformations. Make scope and consequences clear. Provide undo or recovery where feasible.

### 2. Make data state visible
Users should be able to understand which dataset, columns, filters, transformations and analysis settings are currently active.

### 3. Prefer discoverability over cleverness
Use understandable labels and predictable placement. Do not rely on unexplained icons or hidden gestures for important actions.

### 4. Progressive disclosure, not feature burial
Keep common actions prominent. Place advanced options in logical, labelled locations with clear paths back to them.

### 5. Consistency across workflows
Similar actions should look and behave similarly unless there is a user-centred reason to differ.

### 6. Evidence before redesign
Prioritise observed task failures, confusion and regression over personal taste.

### 7. Reproducibility and trust
Where applicable, make transformations inspectable, results explainable, and exports reproducible.

## Product constraints to confirm

- Supported file types and maximum dataset size:
- Browser and device support:
- Local vs server-side processing:
- Privacy/security constraints:
- Current frameworks and UI component library:
- Existing automated tests:
- Required export formats:
- Accessibility target:
- Known performance constraints:

## Product success measures

Choose a small set and establish current baselines before setting targets:
- Successful completion rate for core journeys.
- Time and number of steps to complete common tasks.
- Number of errors or recoveries per task.
- Percentage of users who can locate important existing features.
- UI regression count per release.
- Automated test pass rate for critical journeys.
