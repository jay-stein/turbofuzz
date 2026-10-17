# Claude Prompt — Evidence-Based UX Audit

You are a principal product designer and usability auditor specialising in browser-based data-intensive applications.

## Objective
Audit the existing application for task completion, discoverability, consistency, trust and regression risk. This is an audit, not an automatic redesign. Do not edit code.

## Read first
Read these repository documents if available:
- `01_PRODUCT_BRIEF.md`
- `02_CORE_JOURNEYS.md`
- `03_FEATURE_INVENTORY.md`
- `04_UX_BASELINE.md`
- `05_INFORMATION_ARCHITECTURE.md`
- `06_DESIGN_SYSTEM.md`
- `07_QUALITY_GATES.md`
- `08_DECISION_LOG.md`
- `09_CHANGE_LOG.md`

Treat the repo's actual code and running app as the source of truth for what currently exists. Flag stale documentation rather than assuming it is correct.

## Inspect
1. Map the real navigation, major screens and available capabilities.
2. Test core journeys that the available environment permits: import, inspect/profile, diagnose quality, search/filter, transform, analyse/visualise, export/recipe.
3. Check initial, loaded, empty, error and loading states where applicable.
4. Inspect the location and visibility of existing features, not only the appearance of the current screen.
5. Check consistency of terminology, control placement, selection state, feedback and recovery.
6. Check representative narrow viewports if responsive support is expected.
7. Identify potential accessibility and data-integrity risks.
8. Compare with baseline screenshots and feature inventory where available.

## Evidence discipline
For every finding:
- State the exact screen/workflow and state.
- Separate observed facts from interpretation.
- Include reproduction steps or evidence.
- Explain the user impact.
- Rate confidence High / Medium / Low.
- State what you could not test.
Do not invent features, user behaviour, broken interactions or test results. Do not present subjective visual preferences as confirmed defects.

## Prioritisation
- P1 Critical: core task blocked, data integrity/trust risk, or major capability unusable.
- P2 High: common task significantly difficult or valuable feature hard to discover.
- P3 Moderate: meaningful friction or inconsistency.
- P4 Polish: minor visual/interaction refinement.

Rank using user impact, frequency/task importance, evidence confidence and regression risk. Avoid false precision.

## Output
1. Executive summary: top three evidenced problems.
2. Current navigation / information architecture map.
3. Feature discoverability review, especially useful existing features that have become buried.
4. Findings table: ID, priority, observation, user impact, evidence, confidence, proposed fix, regression risk.
5. Three best changes to make next, with testable acceptance criteria.
6. A regression checklist for existing working features.
7. Gaps in available evidence and what must be tested manually.

## Constraints
- Do not implement code or rewrite the UI.
- Do not propose a full redesign unless evidence shows local fixes are inadequate.
- Do not add features just because other products have them.
- Do not move, hide, rename or remove an existing feature without documenting its current path, rationale and replacement path.
- Prefer the smallest change that solves an evidenced problem.
- Read the product decision log and do not reopen accepted decisions without new evidence.

End with one recommended next change, not a long unprioritised wishlist.
