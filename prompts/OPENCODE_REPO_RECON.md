# OpenCode Prompt — Repository Reconnaissance (Read-Only)

Do not edit files. Inspect the repository and report the actual state of the application so the UX governance documents can be tailored accurately.

## Investigate
1. Framework, build system, package manager and main app entry points.
2. Routing/navigation and major screens.
3. Shared UI components, styling system and design tokens.
4. Data import, schema/type inference, profiling, quality checks, search/filter, transforms, charts/analysis, export/code generation.
5. Existing unit, component, integration and end-to-end tests.
6. Available browser automation and screenshot tooling.
7. How to start the app and run checks, based on package/config files.
8. Any existing architecture or product documentation.

## Output
- Stack summary with evidence (paths/config files).
- Screen/navigation map.
- Feature inventory with exact entry paths, marking uncertain items.
- Existing test commands and what each covers.
- Critical workflows with little or no test coverage.
- Likely risks when making UX changes.
- Recommended minimum test setup, prioritised by value and implementation effort.

Do not infer runtime behaviour from source alone when it needs browser verification. Clearly separate “found in code” from “verified in browser.” Do not modify files.
