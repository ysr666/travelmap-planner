---
name: Nocturnal Explorer
colors:
  surface: '#131315'
  surface-dim: '#131315'
  surface-bright: '#39393b'
  surface-container-lowest: '#0e0e10'
  surface-container-low: '#1b1b1d'
  surface-container: '#1f1f21'
  surface-container-high: '#2a2a2c'
  surface-container-highest: '#353437'
  on-surface: '#e4e2e4'
  on-surface-variant: '#c0c6d6'
  inverse-surface: '#e4e2e4'
  inverse-on-surface: '#303032'
  outline: '#8b91a0'
  outline-variant: '#414754'
  surface-tint: '#aac7ff'
  primary: '#aac7ff'
  on-primary: '#003064'
  primary-container: '#3e90ff'
  on-primary-container: '#002957'
  inverse-primary: '#005db8'
  secondary: '#47e266'
  on-secondary: '#003910'
  secondary-container: '#09bf49'
  on-secondary-container: '#004615'
  tertiary: '#ffb691'
  on-tertiary: '#552000'
  tertiary-container: '#eb6a12'
  on-tertiary-container: '#4a1b00'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#d6e3ff'
  primary-fixed-dim: '#aac7ff'
  on-primary-fixed: '#001b3e'
  on-primary-fixed-variant: '#00468d'
  secondary-fixed: '#6cff82'
  secondary-fixed-dim: '#47e266'
  on-secondary-fixed: '#002106'
  on-secondary-fixed-variant: '#00531a'
  tertiary-fixed: '#ffdbcb'
  tertiary-fixed-dim: '#ffb691'
  on-tertiary-fixed: '#341100'
  on-tertiary-fixed-variant: '#793100'
  background: '#131315'
  on-background: '#e4e2e4'
  surface-variant: '#353437'
typography:
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 26px
    fontWeight: '700'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 17px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 20px
  label-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  margin-mobile: 16px
  margin-desktop: 32px
  gutter: 16px
  section-gap: 24px
  stack-gap: 12px
---

## Brand & Style
The design system is a premium, high-utility travel and navigation interface optimized for low-light environments and late-night trip planning. It targets sophisticated travelers who value clarity, focus, and a reduced cognitive load. 

The aesthetic is **Modern Corporate** with **Glassmorphic** influences. It utilizes deep, immersive backgrounds and elevated surface "islands" to create a sense of organized hierarchy. The emotional response is one of calm, precision, and reliability—mimicking the high-end feel of modern automotive interfaces and premium iOS applications. By utilizing dark surfaces, the design system minimizes glare, preserves night vision during travel, and allows vibrant map data or imagery to become the focal point.

## Colors
The palette is built on a "True Black" foundation to maximize OLED efficiency and provide infinite depth. 

- **Primary (System Blue):** A high-vibrancy blue (#0A84FF) specifically tuned for accessibility on dark backgrounds. It is used for primary actions, active states, and critical navigation paths.
- **Surface Strategy:** The system uses a tiered dark-gray approach. The base is `#000000`. Grouped content blocks use `#1C1C1E`. Interactive or nested elements use `#2C2C2E`.
- **Typography Colors:** Primary titles use pure white (#FFFFFF) for maximum contrast. Secondary metadata and descriptions use a muted Silver-Gray (#8E8E93) to establish a clear visual hierarchy.

## Typography
The typography system balances the friendly, approachable geometry of **Plus Jakarta Sans** for headings with the systematic legibility of **Inter** for functional data.

- **Headlines:** Use Plus Jakarta Sans with tighter letter-spacing to create a distinctive, modern look. 
- **Body & UI:** Inter is utilized for all body copy, labels, and input fields to ensure maximum readability at small sizes.
- **Scale:** Headline-LG scales down for mobile to prevent awkward text wrapping on map overlays.

## Elevation & Depth
Depth is communicated through **Tonal Layering** and **Subtle Outlines** rather than heavy shadows.

- **Z-Axis:** The further an element "rises" toward the user, the lighter its gray value becomes. (Black -> #1C1C1E -> #2C2C2E).
- **Overlays:** For maps and high-contrast imagery, use a Backdrop Blur (20px) with a 70% opacity fill of the surface color to create a "Glassmorphic" effect.
- **Borders:** Use a subtle 0.5px border (#38383A) on all surface containers to define edges against the true black background.

## Shapes
The shape language is defined by large, friendly radii that evoke a premium feel. 

- **Primary Radius:** All main surface containers and cards use a **20px (1.25rem)** corner radius.
- **Secondary Elements:** Buttons and input fields follow this curve at a slightly smaller scale (12px-16px) to maintain nested harmony.
- **Interaction:** Active states should maintain the same curvature to ensure the silhouette remains consistent.

## Components
- **Buttons:** Primary buttons are solid Blue (#0A84FF) with white text. Secondary buttons are Ghost-style with a #2C2C2E background and Blue text.
- **Grouped Lists:** Use #1C1C1E backgrounds with dividers (#38383A) that stop 16px short of the left edge (text-aligned).
- **Cards:** Travel cards feature high-quality imagery with a 15% black-to-transparent gradient overlay at the bottom to ensure white text legibility.
- **Input Fields:** Use #2C2C2E as the background with a 12px radius. The cursor and "active" border should use the primary accent blue.
- **Chips/Badges:** Small, pill-shaped tags used for categories (e.g., "Restaurant", "Park") use #2C2C2E background with white text and 0.5px stroke.
- **Map Markers:** Circular with a white outer ring and a primary blue core to ensure they remain the highest-contrast elements on the screen.