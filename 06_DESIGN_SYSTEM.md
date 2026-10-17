# UX and Design Consistency Rules

> Document the actual design system here. Do not invent token names or component APIs; inspect the repository and existing UI library first.

## Existing system audit

- UI framework:
- Component library:
- Styling approach:
- Design tokens / theme files:
- Shared layout components:
- Form controls:
- Tables / data grid:
- Dialogs / menus:
- Charting library:
- Accessibility conventions:

## Consistency rules

### Components
- Reuse existing shared components for equivalent interactions.
- Avoid creating a one-off component when an existing component can be extended safely.
- If the same pattern appears in several places, consider a shared component only when behaviour is genuinely consistent.
- Do not perform a broad component refactor as part of a small UX fix.

### Labels and terminology
- Use the same label for the same concept across screens.
- Distinguish date-only from datetime where the product supports both.
- Explain technical terms when the intended user may not know them.
- Keep action labels specific (for example, “Export CSV” rather than “Go”).
- Make destructive or irreversible actions explicit.

### Interaction feedback
- Every meaningful action should have a visible outcome or a clear explanation of why it cannot proceed.
- Show progress for operations that take noticeable time.
- Prevent duplicate submissions where relevant.
- Use errors that describe the problem and a plausible next step.
- Make active filters, selections and applied transformations visible.

### Tables and data grids
- Preserve readable column names and units.
- Make sorting, filtering, selection and pagination state understandable where present.
- Provide a useful empty state rather than an unexplained blank panel.
- Avoid changing column widths, row selection or scroll behaviour unexpectedly.
- Verify keyboard interaction and focus behaviour for custom controls.

### Responsive behaviour
- Identify the minimum supported viewport.
- Avoid horizontal overflow that hides critical controls.
- Ensure menus, dialogs and tables remain usable at supported widths.
- Do not assume desktop screenshots prove mobile usability.

### Accessibility
- Use semantic elements and accessible names.
- Maintain visible keyboard focus.
- Do not rely on colour alone to convey status.
- Check contrast and keyboard access for important workflows.
- Respect reduced-motion preferences where animation is used.

## Visual change policy

A visual polish change should not silently change data semantics, action placement, keyboard behaviour, responsive layout or workflow steps. If it does, treat it as a functional UX change and test accordingly.
