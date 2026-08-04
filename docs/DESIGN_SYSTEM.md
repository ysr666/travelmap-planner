# TripMap Design System

更新时间：2026-08-04

状态：**Current baseline + Candidate V3 implementation**

TripMap uses a compact consumer travel surface for complex outbound trips. Product copy is Chinese by default, controls keep 44px or taller touch targets, and every screen prioritizes the current travel stage, real objects, and one next action over feature exposure or decorative layout. Realtime online and AI-first remain implementation strategies, not the visual identity.

The upstream product contract is [PRODUCT_POSITIONING.md](PRODUCT_POSITIONING.md). The complete Target contract for the third UI refactor lives in [UI_REFACTOR_V3.md](UI_REFACTOR_V3.md). That document is authoritative for V3 information architecture, tooling, visual direction, adaptive behavior, screen requirements, accessibility, validation, and migration order. This file defines the shared implementation rules that apply before, during, and after migration.

## Status Boundary

- **Current:** `src/index.css`, `Button`, `Card`, `ActionToolbar`, `InlineStatus`, `ListRow`, the current App Shell, and existing page components remain the shipped implementation.
- **Target:** V3 replaces the persistent global AI input, repeated trip navigation, card-heavy page composition, and narrow desktop shell according to [UI_REFACTOR_V3.md](UI_REFACTOR_V3.md).
- A V3 rule must not be described as shipped until its component, tests, responsive screenshots, and relevant E2E are merged.

## Tokens

- Use `src/index.css` theme tokens for color, typography, spacing, and grouped surfaces.
- Prefer `text-on-surface`, `tm-muted`, `tm-field`, `tm-chip`, `tm-row`, and `tm-focus` over one-off slate classes.
- Keep cards to actual repeated records, dialogs, or framed tools. Page sections should stay as normal document flow with constrained content.
- V3 introduces semantic tokens for `background`, `surface`, `surface-subtle`, `text`, `text-muted`, `border`, `primary`, `secondary`, `success`, `warning`, and `danger`.
- Keep the existing `#0E7C73` teal as the primary candidate, but use it only for primary actions and selected states. Neutral surfaces remain visually dominant.
- Do not introduce decorative gradients, gradient placeholders, bokeh, color orbs, or a one-hue page palette.
- Do not scale type continuously with viewport width. Letter spacing is `0`.

Target V3 type scale:

| Token | Size / line-height | Usage |
| --- | --- | --- |
| `display` | `28 / 34` | Top-level page title |
| `title` | `20 / 28` | Primary object title |
| `section` | `17 / 24` | Section heading |
| `body` | `15 / 22` | Body and form content |
| `meta` | `13 / 18` | Date, source, and status |
| `label` | `11 / 16` | Navigation and compact labels |

Target spacing sequence is `4, 8, 12, 16, 24, 32`. Mobile page margins are `16px`, tablet margins `24px`, and desktop content margins `32px`.

## Primitives

- Use `Button` for primary commands and icon+text actions.
- Use `ActionToolbar` for compact groups of related commands. Set `ariaLabel` when the group is not obvious from the surrounding heading.
- Use `InlineStatus` for inline success, warning, error, info, and neutral messages instead of custom rounded status blocks.
- Use `Card` only for repeated items, dialogs, and self-contained tool surfaces.
- Use `ListRow` for settings or metadata rows with stable icon/title/detail structure.
- Use Lucide React for product icons. Do not add hand-drawn SVGs, emoji icons, or a second icon library when Lucide has an equivalent.
- V3 shared primitives are `AppScaffold`, `ContextHeader`, `PrimaryNavigation`, `Section`, `StatusStrip`, `RecordRow`, `TimelineRow`, `DocumentThumbnail`, `AiActionSheet`, `FilterSheet`, `DisclosureRow`, and `FormSection`.
- Materials uses `DocumentPreviewRow` as the default presentation: a stable real thumbnail on the left and title plus essential metadata on the right. `DocumentThumbnail` remains available inside previews and detail surfaces, not as the default two-column page layout.
- Shared primitives define default, pressed, focus, selected, disabled, loading, error, empty, long-content, and dark-mode states before broad page adoption.
- Cards, buttons, inputs, and rows use at most `8px` radius. A modal bottom sheet may use `12px` on its top corners.

## Interaction Rules

- Prefer icon buttons for repeated mechanical actions such as move, close, retry, delete, save, and refresh; include an accessible label when the visible text is absent.
- Do not rely on drag-only controls. Provide buttons for ordering and keyboard/touch workflows.
- Do not claim offline support for maps, routes, search, provider calls, or cloud sync unless a real local cache exists for that capability.
- Show realtime state with a short source/freshness treatment; stale or failed facts must visibly degrade without expanding into a diagnostic card.
- Destructive, sync, storage, and update actions must be confirmation-gated or user-triggered.
- Put the user's primary object first: phase-appropriate next action before maps or advice, itinerary timeline before tools, real materials before import settings, and setting categories before their controls.
- Secondary intelligence, diagnostics, reminders, setup forms, and level-two settings default to a single compact disclosure row. Opening one surface must not expand unrelated surfaces.
- Keep disclosure labels short and state-bearing. The expanded content owns its detail copy; the collapsed row must not summarize a paragraph.
- A completed global AI navigation action closes the AI panel and focuses the destination. Do not leave an answer panel covering the page it just opened.
- When AI can perform a registered action, show the result, affected object, and one primary command instead of a long answer. Read-only actions may complete immediately; a reversible write plan gets one confirmation.
- Long ticket names, locations, addresses, and imported filenames must wrap inside the mobile viewport. Flex children carrying user content need `min-width: 0`.
- One screen has one primary task, one primary action, and no more than two navigation levels.
- A title, trip name, date, metric group, address, or map-link group appears once per viewport.
- Bottom navigation is for top-level destinations only. AI, Add, Search, Delete, and other commands belong in a toolbar, content control, menu, or modal.
- V3 mobile navigation is `今日 | 行程 | 资料 | 我的`; pending inbox items are a state inside Materials, and AI opens from the shared toolbar as an on-demand modal Action Sheet.
- Only one fixed bottom interaction surface may be expanded at a time. The AI sheet, map place sheet, sticky action area, and bottom navigation must not stack over each other.
- AI closes after successful navigation and restores focus to its trigger when dismissed.
- Forms disclose basic information and place first; timezone, coordinates, cross-day transport, and advanced rules remain collapsed until requested.
- Empty states contain one reason and one primary command. Do not lead with zero metrics, Provider status, or setup diagnostics.

## Adaptive Layout

- `<600px`: bottom navigation, one-column push navigation, mobile sheets.
- `600–1023px`: navigation rail or stable top navigation and optional list-detail split.
- `>=1024px`: sidebar and master-detail layout; do not render the app as a centered phone column.
- App Shell owns safe-area insets, fixed navigation height, content padding, and z-index.
- Text and controls must remain usable at `320px`, with software keyboard open, and at `200%` text zoom.

## Accessibility

- Target WCAG 2.2 AA.
- Touch targets are at least `44 x 44px`; primary buttons are at least `48px` high.
- Body text contrast is at least `4.5:1`; large text, icons, and control boundaries are at least `3:1`.
- Focus order follows visual order and focus indicators cannot be obscured by the header, keyboard, sheets, or navigation.
- Modal sheets implement the WAI-ARIA dialog pattern, trap focus, close with Escape, and return focus to the invoker.
- Tabs implement `tablist`, `tab`, and `tabpanel`; status announcements use restrained live regions.
- Color is never the only carrier of state.

## Visual Validation

- Validate `320x568`, `390x844`, `430x932`, `768x1024`, and `1440x900`.
- Test light/dark, long Chinese and English content, loading, empty, error, offline, stale, partial success, AI confirmation, and software-keyboard states.
- Static Golden Screenshots target `maxDiffPixelRatio <= 0.005`.
- Dynamic maps use stable fixture data plus canvas, marker, control, and overlap assertions.
- Every page checks that `scrollWidth <= clientWidth`.
- Real iPhone Safari/PWA and Android Chrome/PWA remain required before release; simulator results cannot replace the device record.
