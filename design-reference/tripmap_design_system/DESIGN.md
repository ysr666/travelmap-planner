---
name: TripMap Design System
colors:
  surface: '#f8f9fb'
  surface-dim: '#d9dadc'
  surface-bright: '#f8f9fb'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f4f6'
  surface-container: '#edeef0'
  surface-container-high: '#e7e8ea'
  surface-container-highest: '#e1e2e4'
  on-surface: '#191c1e'
  on-surface-variant: '#414755'
  inverse-surface: '#2e3132'
  inverse-on-surface: '#f0f1f3'
  outline: '#717786'
  outline-variant: '#c1c6d7'
  surface-tint: '#005bc1'
  primary: '#0058bc'
  on-primary: '#ffffff'
  primary-container: '#0070eb'
  on-primary-container: '#fefcff'
  inverse-primary: '#adc6ff'
  secondary: '#4c4aca'
  on-secondary: '#ffffff'
  secondary-container: '#6664e4'
  on-secondary-container: '#fffbff'
  tertiary: '#9e3d00'
  on-tertiary: '#ffffff'
  tertiary-container: '#c64f00'
  on-tertiary-container: '#fffbff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d8e2ff'
  primary-fixed-dim: '#adc6ff'
  on-primary-fixed: '#001a41'
  on-primary-fixed-variant: '#004493'
  secondary-fixed: '#e2dfff'
  secondary-fixed-dim: '#c2c1ff'
  on-secondary-fixed: '#0c006a'
  on-secondary-fixed-variant: '#3631b4'
  tertiary-fixed: '#ffdbcc'
  tertiary-fixed-dim: '#ffb595'
  on-tertiary-fixed: '#351000'
  on-tertiary-fixed-variant: '#7c2e00'
  background: '#f8f9fb'
  on-background: '#191c1e'
  surface-variant: '#e1e2e4'
typography:
  nav-title:
    fontFamily: Plus Jakarta Sans
    fontSize: 34px
    fontWeight: '700'
    lineHeight: 41px
    letterSpacing: -0.4px
  headline-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 25px
    letterSpacing: -0.2px
  body-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 17px
    fontWeight: '400'
    lineHeight: 22px
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 20px
  label-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 18px
  footnote:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  safe-area-inset: 16px
  row-height-default: 56px
  row-height-large: 72px
  stack-gap-sm: 8px
  stack-gap-md: 12px
  section-margin-bottom: 24px
  card-padding: 16px
---

## Brand & Style

The design system is a high-fidelity, utility-first framework inspired by the iOS human interface philosophy. It is designed specifically for a mobile PWA context, focusing on structural clarity, systematic density, and a native-app feel. The brand personality is professional, organized, and reliable—evoking the feeling of a high-end personal assistant or a well-structured "Control Center" for travel planning.

The style is **Modern Corporate / HIG-inspired**, characterized by:
- **Grouped List Architecture:** Content is organized into distinct white "islands" against a soft gray background.
- **Precision Iconography:** Use of circular background tints for category-level icons to aid rapid scanning.
- **Hierarchical Clarity:** Heavy emphasis on weight-based typography to guide the eye through dense itinerary data.
- **Systematic Constraints:** A strict adherence to iOS-native interaction patterns like 44px minimum touch targets and inset grouped layouts.

## Colors

The color palette is strictly functional, utilizing the Apple system palette to ensure instant familiarity for mobile users.

- **Primary Blue (#007AFF):** Used for primary actions, interactive links, and active states.
- **Surface Strategy:** The UI uses a two-tier background system. The base canvas is `#F5F6F8`, while all interactive content cards and list groups use `#FFFFFF`.
- **Text Tiers:** Primary text uses pure black for maximum contrast. Secondary text and metadata use `#8E8E93`, following the iOS "Caption" and "Footnote" conventions.
- **Semantic Accents:** Status colors (green, orange, red) are used sparingly for itinerary status indicators (e.g., "Confirmed", "Pending").

## Typography

This design system uses **Plus Jakarta Sans** as a modern, highly legible substitute for San Francisco. It provides a clean, neutral character that handles both English and Chinese character sets with balanced density.

- **Scale:** The scale follows a strict hierarchy. Large titles (34px) are used only on top-level views.
- **Chinese Support:** For Chinese characters, ensure the system falls back to standard system fonts (PingFang SC) while maintaining the defined weights and line heights.
- **Contrast:** Bold weights (600-700) are used for entity names and section headers, while Regular (400) is reserved for descriptions and secondary metadata.

## Layout & Spacing

The layout utilizes a **Fixed-Fluid Hybrid** model optimized for the iPhone aspect ratio.

- **Inset Grouped Layout:** All primary content groups are inset from the screen edge by 16px. This creates the "pill" container effect seen in iOS Settings.
- **Vertical Rhythm:** A strict 8px grid governs all spacing. List rows have a minimum height of 56px for touch accessibility.
- **Sectioning:** Content is grouped by logical function (e.g., "Basic Info", "Transport"). Each group is separated by a 24px vertical gap.
- **Breakpoints:** This design system is mobile-first. For tablet widths, containers should maintain a maximum width of 600px and center-align to preserve the mobile-native feel.

## Elevation & Depth

This design system avoids heavy shadows and physical depth in favor of **Tonal Layering** and **Hairline Borders**.

- **Surface Levels:** 
  - Level 0: Background Canvas (#F5F6F8)
  - Level 1: Content Groups (#FFFFFF)
- **Separators:** Within a white content group, individual rows are separated by a 0.5pt (or 1px) hairline border (#E5E5E7). The separator should typically be inset by the icon width (approx 44-56px) to maintain visual alignment with the text.
- **Selection State:** Interactive rows should show a brief gray background tint (#E5E5E7) upon touch/press to provide tactile feedback.

## Shapes

The shape language is defined by the "Continuous Curve" aesthetic found in iOS.

- **Group Containers:** Content blocks use a generous 18px to 24px corner radius.
- **Icon Backgrounds:** Small category icons within lists are contained in 32px circles or highly rounded squares (8px radius).
- **Buttons:** Primary action buttons use a 12px radius or a full pill-shape depending on the context. Full-width buttons at the bottom of the screen should follow the card radius (18-24px).

## Components

### Buttons
- **Primary:** High-contrast blue (#007AFF) with white text. Bold weight.
- **Secondary:** White background with blue text and a subtle hairline border.
- **Destructive:** White background with red (#FF3B30) text for delete/cancel actions.

### List Rows (Grouped)
- Each row contains: [Icon/Image] + [Title/Subtitle] + [Chevron/Value].
- Left-side icons should be placed in a 32px tinted circular container (e.g., Blue tint for "Location", Orange for "Food").
- Right-side indicators use a light gray chevron-right icon.

### Input Fields
- Inset within white groups.
- Labels are aligned left, with placeholder/input text aligned right (or stacked for long-form notes).
- No borders on individual inputs; use hairline separators between rows.

### Itinerary Cards
- Top-level cards feature a 1:1 or 16:9 image with a 12px radius.
- Metadata is stacked below with "Metric-Label" pairs (e.g., "12 Days", "38 Spots").

### Segmented Control
- A pill-shaped toggle used for switching views (e.g., "List" vs "Map").
- Dark gray selection indicator with soft shadow.

### Tab Bar (PWA Navigation)
- Fixed at the bottom of the viewport.
- 49-60px height with translucent background (SF Pro icons).