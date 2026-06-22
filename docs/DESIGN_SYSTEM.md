# TripMap Design System

This project uses a compact, local-first mobile app surface. Product copy is Chinese by default, controls keep 44px or taller touch targets, and dense operational pages should prioritize scanability over decorative layout.

## Tokens

- Use `src/index.css` theme tokens for color, typography, spacing, and grouped surfaces.
- Prefer `text-on-surface`, `tm-muted`, `tm-field`, `tm-chip`, `tm-row`, and `tm-focus` over one-off slate classes.
- Keep cards to actual repeated records, dialogs, or framed tools. Page sections should stay as normal document flow with constrained content.

## Primitives

- Use `Button` for primary commands and icon+text actions.
- Use `ActionToolbar` for compact groups of related commands. Set `ariaLabel` when the group is not obvious from the surrounding heading.
- Use `InlineStatus` for inline success, warning, error, info, and neutral messages instead of custom rounded status blocks.
- Use `Card` only for repeated items, dialogs, and self-contained tool surfaces.
- Use `ListRow` for settings or metadata rows with stable icon/title/detail structure.

## Interaction Rules

- Prefer icon buttons for repeated mechanical actions such as move, close, retry, delete, save, and refresh; include an accessible label when the visible text is absent.
- Do not rely on drag-only controls. Provide buttons for ordering and keyboard/touch workflows.
- Do not claim offline support for maps, routes, search, provider calls, or cloud sync unless a real local cache exists for that capability.
- Destructive, sync, storage, and update actions must be confirmation-gated or user-triggered.
