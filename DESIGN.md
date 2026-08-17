---
name: DeepSeek WebUI Studio
description: "A compact, native-feeling plugin workbench with precise controls and restrained depth."
colors:
  primary-accent: "var(--studio-accent)"
  neutral-canvas: "var(--studio-canvas)"
  neutral-panel: "var(--studio-panel)"
  neutral-raised: "var(--studio-panel-raised)"
  neutral-control: "var(--studio-control)"
  neutral-control-hover: "var(--studio-control-hover)"
  neutral-control-pressed: "var(--studio-control-pressed)"
  neutral-text: "var(--studio-text)"
  neutral-text-secondary: "var(--studio-text-secondary)"
  neutral-border: "var(--studio-border)"
  neutral-focus: "var(--studio-focus)"
  neutral-overlay: "var(--studio-overlay)"
typography:
  scale:
    micro: "9px"
    compact: "10px"
    body: "11px"
    label: "12px"
    title: "13px"
    headline: "14px"
    panel-title: "15px"
    mobile-input: "16px"
    metric: "17px"
  headline:
    fontFamily: '"Avenir Next", "SF Pro Text", "Segoe UI", sans-serif'
    fontSize: "14px"
    fontWeight: 700
    lineHeight: "20px"
    letterSpacing: "-0.015em"
  title:
    fontFamily: '"Avenir Next", "SF Pro Text", "Segoe UI", sans-serif'
    fontSize: "13px"
    fontWeight: 700
    lineHeight: "20px"
    letterSpacing: "-0.01em"
  body:
    fontFamily: '"Avenir Next", "SF Pro Text", "Segoe UI", sans-serif'
    fontSize: "11px"
    fontWeight: 400
    lineHeight: "17px"
  label:
    fontFamily: '"Avenir Next", "SF Pro Text", "Segoe UI", sans-serif'
    fontSize: "12px"
    fontWeight: 700
    lineHeight: "18px"
  control:
    fontFamily: '"Avenir Next", "SF Pro Text", "Segoe UI", sans-serif'
    fontSize: "10px"
    fontWeight: 600
    lineHeight: 1
rounded:
  indicator: "2px"
  compact: "3px"
  sm: "6px"
  md: "9px"
  lg: "13px"
  pill: "999px"
components:
  settings-trigger:
    backgroundColor: "{colors.neutral-control}"
    textColor: "{colors.neutral-text-secondary}"
    rounded: "{rounded.sm}"
    size: "28px"
  settings-trigger-mobile:
    backgroundColor: "{colors.neutral-control}"
    textColor: "{colors.neutral-text-secondary}"
    rounded: "{rounded.sm}"
    size: "40px"
  settings-dialog:
    backgroundColor: "{colors.neutral-panel}"
    textColor: "{colors.neutral-text}"
    rounded: "{rounded.lg}"
    width: "min(780px, calc(100vw - 40px))"
    height: "min(460px, calc(100vh - 40px))"
  settings-nav-item:
    textColor: "{colors.neutral-text-secondary}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    height: "34px"
  settings-nav-item-active:
    backgroundColor: "{colors.neutral-control-pressed}"
    textColor: "{colors.neutral-text}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    height: "34px"
  settings-nav-item-mobile:
    textColor: "{colors.neutral-text-secondary}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    height: "42px"
  settings-choice-mobile:
    backgroundColor: "{colors.neutral-control}"
    textColor: "{colors.neutral-text-secondary}"
    rounded: "{rounded.md}"
    height: "40px"
---

# Design System: DeepSeek WebUI Studio

## Overview

**Creative North Star: "The Native Plugin Workbench"**

Studio should feel like a precise native developer workbench. It is compact, calm, and operational: browser-like draft tabs, dense tool rails, transparent workspace layers, focused modal tasks, and familiar controls keep the plugin preview visually primary.

This contract records the shared Studio palette, type ramp, shape scale, and depth vocabulary. The settings components below are the first fully documented surface; they inherit the same tokens, theme behavior, internationalization, and responsive control geometry as the surrounding workbench.

**Key Characteristics:**

- Compact icon-only entry point.
- Theme-aware, divider-led modal surfaces.
- Orientation-aware keyboard navigation.
- 40–42px mobile controls.

## Colors

The settings surface inherits the Studio theme rather than owning a separate palette. Raised panels, controls, text, dividers, focus, accent, and overlay roles remain live-bound to the existing light, dark, and system theme primitives.

### Primary

- **Studio Accent:** Marks the selected theme choice and other established active states; it is not a decorative fill for the dialog.

### Neutral

- **Workbench Canvas:** Remains behind the modal and is subdued by the theme overlay.
- **Panel and Raised Panel:** Separate the dialog shell, title bar, navigation rail, and content plane through restrained tonal contrast.
- **Control States:** Distinguish resting, hovered, and selected controls without introducing a new hue.
- **Primary and Secondary Text:** Keep labels clear while allowing descriptions and inactive navigation to recede.
- **Divider:** Structures the title bar, navigation boundary, page heading, and settings rows.
- **Focus and Overlay:** Preserve visible keyboard focus and modal isolation in every theme.

**The Theme Inheritance Rule.** Settings must consume existing Studio color primitives; do not introduce a settings-only palette or hard-code a single theme.

## Typography

**Display Font:** Not used on this utility surface.
**Body Font:** Avenir Next, with SF Pro Text and Segoe UI fallbacks.
**Label/Mono Font:** The body family is retained for settings labels and controls; monospace is not used here.

**Character:** Compact and native rather than editorial. Hierarchy comes from small changes in weight, size, and spacing, not oversized display type.

### Hierarchy

- **Headline:** The current settings page title; compact, bold, and slightly tightened.
- **Title:** The modal title in the restrained title bar.
- **Body:** Descriptions and navigation labels, optimized for dense utility UI.
- **Label:** Setting names that anchor each divider-led row.
- **Control:** Compact segmented-control labels.

**The Utility Type Rule.** Keep settings copy within the existing Studio type scale; do not add a display face or marketing-sized headings to this dialog.

## Layout

The desktop dialog is centered and bounded by the viewport. Its 52px title bar sits above a two-column body with a 174px navigation rail and a scrollable content region. Content uses a page heading followed by flat rows: explanatory copy takes the flexible column and the setting control aligns to the trailing edge.

At widths up to 560px, the dialog keeps a 10px viewport inset and caps its height against the viewport. The title bar contracts to 48px, the navigation becomes a 50px horizontal strip, content padding tightens, and every settings row stacks copy above a full-width control. The toolbar trigger, close button, language select, and theme choices become 40px targets, while navigation tabs become 42px targets.

**The Orientation Matches Geometry Rule.** Vertical navigation uses up/down arrows and `aria-orientation="vertical"`; horizontal navigation uses left/right arrows and `aria-orientation="horizontal"`. Home and End remain available in both modes.

## Elevation & Depth

The modal is the only lifted settings surface. A theme-provided panel shadow and a lightly blurred overlay separate it from the workbench; inside the dialog, tonal layering and 1px dividers carry structure. Rows and navigation items do not become floating cards.

### Shadow Vocabulary

- **Modal Panel:** The existing theme panel shadow gives the dialog a clear but restrained layer above the workbench.
- **Selected Choice:** The existing low inset or ambient treatment identifies selected navigation and theme choices without creating extra elevation levels.

**The Modal-Only Lift Rule.** Elevate the dialog as a whole; keep internal settings content flat and divider-led.

## Shapes

The dialog uses the largest existing Studio radius, ordinary controls use the medium radius, and compact navigation or icon controls use the small radius. Two- and three-pixel radii are reserved for hairline indicators and especially dense instance controls; they are not general container radii. The pill radius is reserved for switch tracks and compact capsule states, never panels or ordinary buttons. Thin borders sharpen boundaries in both themes. Icons are simple stroked geometry with round caps and joins, consistent with the surrounding Studio toolbar.

**The Flat Rows Rule.** Settings rows are sections divided by rules, not individually rounded cards.

## Components

### Settings Toolbar Trigger

- **Shape:** A compact square icon button using the small control radius.
- **Content:** Icon-only presentation with an accessible localized label and native title affordance.
- **Responsive behavior:** Remains visually quiet at desktop density and expands to a 40px target on narrow screens.
- **States:** Reuses the existing ghost icon-button hover, active, and focus behavior.

### Settings Dialog

- **Shell:** A native HTML modal dialog with a restrained title bar, theme overlay, viewport-aware bounds, and one scrollable content plane.
- **Dismissal:** Close button, Escape, cancel, and native close events converge on the same close action.
- **Motion:** A brief 160ms entrance uses the existing ease-out curve only when reduced motion is not requested.

### Settings Navigation

- **Desktop:** A vertical icon-and-label tab rail with compact 34px rows.
- **Mobile:** A horizontal, evenly distributed icon-and-label tab strip with 42px targets.
- **Selection:** Uses the existing pressed-control tone, text emphasis, and a restrained inset divider treatment.
- **Semantics:** Implements a roving tab stop, associated tab panels, orientation-aware arrow keys, and Home/End navigation.

### Settings Rows

- **Structure:** One setting per divider-led row, with a strong label, a short secondary description, and one trailing control.
- **Desktop:** Copy and control share a two-column row with clear separation.
- **Mobile:** Copy stacks above a full-width control; rows retain divider continuity.

### Language Select

- **Source:** Options are generated from the locale registry rather than enumerated by the settings component.
- **Labels:** Every language uses a stable autonym, such as `English` or `简体中文`, independent of the active interface language.
- **Responsive behavior:** The native select aligns to the trailing edge on desktop and expands to a full-width 40px control on narrow screens.

### Theme Choices

- **Style:** Reuses the existing segmented theme switcher.
- **State:** The selected value uses the established raised panel and accent treatment; keyboard navigation follows the existing radiogroup behavior.
- **Responsive behavior:** Options share the available width and expose 40px targets on narrow screens.

**The Reuse Rule.** Settings must use the existing icon-button, select, theme, locale registry, and localization primitives instead of creating parallel variants.

**The Mobile Reach Rule.** Interactive settings controls must provide 40–42px targets at widths up to 560px without inflating the desktop density.

## Do's and Don'ts

### Do:

- **Do** preserve the existing Studio shell, theme tokens, type scale, focus treatment, and localization path.
- **Do** keep the title bar restrained and the content rows flat, scannable, and separated by dividers.
- **Do** change both keyboard semantics and hit areas when navigation changes orientation at 560px.
- **Do** keep icons paired with localized labels in navigation, even when the toolbar entry point is icon-only.

### Don't:

- **Don't** turn settings into a separate visual world, branded landing surface, or stack of floating cards.
- **Don't** use desktop-sized 28–34px interactive targets on the narrow layout.
- **Don't** rotate navigation visually without also updating `aria-orientation`, arrow-key behavior, and focus movement.
- **Don't** duplicate theme or language state outside the existing primitives.
