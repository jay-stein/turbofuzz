# OpenCode Prompt — Regression Review

Review the current change for unintended regressions. Do not implement fixes until you report findings and obtain approval if fixes would expand scope.

## Inputs
- Approved change brief:
- Baseline commit:
- Current diff / commit:
- Existing feature inventory:
- Test commands/results:

## Review
1. Inspect the diff for unrelated changes, risky state changes and accidental feature removal.
2. Compare against acceptance criteria.
3. Identify existing journeys and features potentially affected by changed components, navigation, state, styles or data semantics.
4. Run relevant automated tests if available.
5. If browser automation is available, run affected core journeys with deterministic test fixtures.
6. Verify that active selection, filters, transformations, export scope and other relevant state remain consistent.
7. Check narrow viewport, keyboard focus and error/empty states where relevant.
8. Report any checks you could not perform.

## Output
Classify findings as:
- Confirmed regression.
- Acceptance criterion failure.
- Potential risk requiring verification.
- No issue observed.

For each issue include severity, evidence, affected feature/journey IDs, reproduction steps, and smallest safe remedy.

Do not claim “no regressions” if the relevant behaviour was not tested. Do not change unrelated code or expand the implementation. End with a recommendation: accept, revise, or roll back.
