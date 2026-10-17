# Quality Gates and Definition of Done

## Every UX change must have

- [ ] A single, approved problem statement.
- [ ] Evidence that the problem exists.
- [ ] Explicit acceptance criteria.
- [ ] A list of existing behaviours to preserve.
- [ ] A defined scope and explicit non-goals.
- [ ] A known-good Git commit or clean rollback point.
- [ ] Automated tests appropriate to the affected behaviour.
- [ ] Manual browser verification for material UX changes.
- [ ] A change-log entry and updates to relevant inventory/baseline documents.

## Test layers

### 1. Static and unit checks
Run repository-native lint, type checks, unit tests and build checks as applicable. Discover actual commands from the repo; do not assume a package manager or framework.

### 2. Component / integration tests
Test changed components and interactions, especially validation, state transitions, filters, transformations, and error handling.

### 3. End-to-end critical journeys
Automate core flows where practical:
- Import a known CSV.
- Confirm schema/profile output.
- Find a seeded quality issue.
- Apply a transformation and validate the resulting values.
- Generate an analysis or chart.
- Export a result or recipe and validate its content.

Use deterministic synthetic fixtures. Avoid relying on real user data.

### 4. Visual regression
Capture screenshots for stable, important states. Review diffs rather than blindly accepting them. Dynamic charts, dates and random identifiers may need controlled test data or targeted masking.

### 5. Manual UX review
For material changes, interact with the app at the supported viewport sizes. Check focus, loading, empty, error and success states where relevant.

## Release gate

A change is ready only if:
- Acceptance criteria are met.
- Relevant tests pass, or any failure is explicitly explained and approved.
- No unintended feature loss or discoverability regression is found.
- The UI has been inspected in the actual browser when the change is visual or interactive.
- The implementation stays within the approved scope.
- Remaining risks are documented.

## Failure policy

If a relevant test fails:
1. Do not claim the task is complete.
2. Identify whether the failure is pre-existing, caused by the change, or uncertain.
3. Fix it within scope if practical; otherwise report it and ask for a decision.
4. Do not weaken or delete a test merely to obtain a green result without explicit justification.

## Rollback

Before a risky change, create a branch or commit the known-good state. If a regression is broader than the benefit, revert the change rather than piling on unrelated fixes.
