---
name: HitterLoop

colors:
  primary: "#B4503A"
  background: "#121418"
  surface1: "#1A1E25"
  surface2: "#232830"
  surface3: "#2C323B"
  textPrimary: "#F4EFEA"
  textSecondary: "#BDB6AB"
  textMuted: "#9A9588"
  brandFill: "#B4503A"
  brandPressed: "#9C4632"
  brandText: "#E27B60"
  onBrand: "#FFFFFF"
  success: "#34D399"
  warning: "#F2B84B"
  danger: "#E0584C"
  dangerFill: "#C7443A"

typography:
  coachTitle:
    fontFamily: Oswald
    fontSize: 1.25rem
    fontWeight: 600
  simplifiedTitle:
    fontFamily: Oswald
    fontSize: 2rem
    fontWeight: 700
  body:
    fontFamily: Inter
    fontSize: 1rem
    lineHeight: 1.4
  sectionLabel:
    fontFamily: Inter
    fontSize: 0.8125rem
    fontWeight: 600

rounded:
  small: 8px
  card: 12px
  sheet: 16px
  pill: 999px

spacing:
  space1: 4px
  space2: 8px
  space3: 12px
  space4: 16px
  space6: 24px
  space8: 32px
---

# HitterLoop design system as implemented

This is the canonical record of the existing frontend, not a redesign brief. The shared coach tokens in `coach/coach.css` are the baseline for the product. `coach/simple.html` adds `coach/simple.css`; `coach/family.html` adds inline family styles; public reports use the coach stylesheet; and the internal methodology admin uses `admin/admin.css`. The Capacitor mobile app wraps the coach web frontend. These surfaces share a palette but do not use identical components or type scales. `docs/design/simplified-app/` is a design reference, not the shipped implementation. Source CSS and rendered behavior take precedence if this record becomes stale.

## Visual character and color

- The coach UI calls its dark-only theme “infield dirt at night”: slate page and surfaces, warm sand text, and clay or terracotta actions. `color-scheme: dark` is set in both main stylesheets; there is no light theme or theme switch.
- The YAML `primary` and `brandFill` entries both map to `--brand-fill`; the remaining palette maps to `--bg`, `--surface-1` through `--surface-3`, `--text-1` through `--text-3`, `--brand-fill-pressed`, `--brand-text`, `--on-brand`, and semantic status tokens in `coach/coach.css`. The admin stylesheet repeats a subset of these colors but does not define `--brand-text`. Primary buttons use clay fill with white text. Global links use sand (`--text-1`) in coach and simplified pages, and clay (`--brand-fill`) in admin. Coach tertiary buttons and selected tabs use the lighter clay `--brand-text`.
- Borders are warm translucent sand: `--border: rgba(244,239,234,0.10)` and `--border-strong: rgba(244,239,234,0.40)`. `--gridline` is `rgba(244,239,234,0.14)`. Scrims use `rgba(0,0,0,0.60)`. Media wells are black.
- Success, warning, and danger use green `#34D399`, amber `#F2B84B`, and coral `#E0584C`; destructive fills use `#C7443A`. Status backgrounds are usually 14% translucent versions of those colors or `color-mix()` equivalents. Legacy score and heatmap UI uses additional status shades (`#2BB989`, `#D9A13A`, `#C74A3F`).
- Older code uses aliases such as `--clay`, `--sand`, `--page`, `--text-primary`, and `--status-good`. These resolve to the same palette. Some legacy markup still uses emoji icons and one-off inline styles; the current UI is not wholly tokenized.

## Typography

- Coach pages import Oswald (500, 600, 700) for display headings and jersey numerals; Inter (400, 500, 600, 700) for body, controls, and compact labels; and JetBrains Mono (600, 700) for scoreboard-like score digits. System and platform fonts are fallbacks. Body text has a 1.4 line height and inherits the browser's 16px root size.
- The shared coach `h1` is Oswald 600 at 1.25rem; app bar titles clamp from 17px to 22px and can occupy two lines. The shared `h2` is an Inter 600 section label at 0.8125rem, muted and spaced 24px from the preceding section. Cards and reports also use larger Inter headings, often 1–1.25rem.
- The simplified route enlarges its uppercase Oswald headings to 2rem (`h1`) and 1.3rem (`h2`) with 0.02em tracking. Its uppercase Inter eyebrow is 0.75rem with 0.08em tracking; the large coaching cue uses 1.5rem Oswald. Its card paragraphs use 1.5 line height.
- Dense supporting text, captions, chips, and navigation labels commonly run 0.75–0.875rem. The admin is desktop-first Inter at 14px/1.5, with 20px and 16px bold Inter headings, 12px uppercase table headers, and JetBrains Mono for inline code. It does not use Oswald or jersey-number treatment.

## Spacing, layout, and responsive behavior

- Coach CSS defines a 4px base spacing ladder: `--space-1` 4px, `--space-2` 8px, `--space-3` 12px, `--space-4` 16px, `--space-6` 24px, and `--space-8` 32px. Common aliases are `--screen-pad` and `--card-pad` 16px, `--gap-card` and `--gap-inline` 8px, and `--gap-section` 24px. Legacy and specialized screens also contain fixed values outside this ladder.
- Coach screens are mobile-first and vertically stacked. `.wrap` is centered at a 640px maximum with 16px side padding and bottom space for the fixed navigation and safe area. `.wrap.wide` expands to 980px at 900px and above. Some review/development grids become two columns at 900px; they collapse or reflow at 620px. Small-screen fixes also exist at 420px, 390px, and 480px (demo bar). Long chip/tab rows scroll horizontally.
- The shared coach app bar is at least 56px tall plus top safe area. Its fixed three-slot bottom navigation is at least 56px tall plus bottom safe area. Sticky tabs, count strips, and action bars sit against these chrome heights; the shell measures bar sizes for placement. Coach pages reserve bottom padding so content remains reachable above navigation.
- The simplified screen has a 720px maximum top bar and main column, 16px side padding, a 64px top bar, and 110px bottom content padding. Its fixed bottom navigation has 52px buttons plus safe-area padding. Its dialog is bottom aligned on narrow screens and becomes a centered, fully rounded panel at 700px. The dialog is at most 520px wide and 85vh high.
- The public report centers content at 680px; the family page uses that report layout with its own inline styles. The admin uses a separate desktop-first, 1100px maximum main area with 20px side padding, wrapping top navigation, forms, and tables. It does not impose the coach's touch-size floor.

## Shape, elevation, and motion

- Coach token radii are 8px for small controls and fields, 12px for cards, 16px for sheets, and 999px for pill chips. Jersey badges are circles. Simplified cards use 16px, its buttons 12px, its mobile dialog 20px top corners, and its desktop dialog 20px all around. Admin cards use 10px and its fields/buttons 8px. These route-specific values are existing exceptions to the shared tokens.
- Most depth comes from progressively lighter slate surfaces and thin borders. Shared coach cards and list rows are flat. The stylesheet retains shadows for the legacy player switcher and bottom-nav add icon, and applies one to the development hero; shadows are not a general card treatment.
- Existing gradients serve a fading scroll edge, a sticky-action fade, and loading skeleton shimmer. Sticky bars use translucent dark backgrounds and blur. Overlay scrims dim the page.
- Coach motion tokens are `--motion-fast: 150ms`, `--motion-normal: 200ms`, and `--ease-out: cubic-bezier(0.16,1,0.3,1)`. Sheets slide in; spinners and skeletons animate. The coach stylesheet reduces animation and transition duration under `prefers-reduced-motion: reduce`.

## Components and recurring patterns

- The shared primitives in `coach/components/ui.js` produce cards, list rows, primary/secondary/tertiary/destructive buttons, icon buttons, filter and status chips, segmented tabs, disclosures, empty/error/processing states, sticky actions, bottom and action sheets, confirmation dialogs, overflow menus, and snackbars. Its icons come from the `coach/assets/icons.svg` sprite; icon-only buttons receive accessible labels. `coach/components/appShell.js` renders team/player app bars and the bottom nav. The system is CSS classes plus HTML-rendering helpers, not a single cross-route component library.
- The coach interface repeatedly uses a circular clay jersey-number badge beside player names, flat slate cards and 56px list rows, small muted supporting copy, pill statuses, and clay selected states. Findings and development pages use evidence links, disclosures, progress steps, drill choices, and black video surfaces. Public reports use a compact brand strip, player header, status pills, timeline/checklist rows, and media.
- The simplified route uses its own 16px bordered cards, 64px dividers/rows, 52px actions, pill switchers, fixed bottom navigation, native dialog, black video and side-by-side 9:16 comparison, expandable drills, and illustrated capture-guide steps. The family route uses report cards, player/game/practice switching, capture/upload controls, consent forms, and a video sheet.
- Internal admin pages use a top navigation bar, bordered 10px cards, data tables with muted uppercase headers and row hover, state badges, stacked labels and fields, and wrapping button groups. They are denser than the coach and family routes.
- Coach controls generally target at least 48px and use a 3px `--brand-text` focus-visible outline with 2px offset. Existing exceptions include 44px `.bt-button`, 40px filter chips and compact actions, 24px status chips, and small admin controls. Disabled buttons use 0.5 opacity.

## Forms and controls

- Coach text, email, and password inputs have `--surface-2` fill, `--border-strong` outlines, 8px corners, and 10px/12px padding. Text inputs, selects, buttons, and `.tap-target` controls inherit a 48px minimum height and width. Shared sheets set inputs, selects, and textareas to at least 48px with 1rem text. Legacy development forms use stacked small uppercase labels, 10px corners, and 48px fields. File inputs are often hidden behind visible upload or record actions.
- The simplified route inherits base fields and buttons, then uses its own 52px rounded action buttons, 48px pill switchers and selection chips, and 48px dialog selects. Settings are checkbox rows; record/upload choices use a native `<dialog>` and hidden video file inputs. The family page uses date inputs, checkboxes, consent copy, and a full-width primary action.
- Admin forms use stacked Inter labels, full-width surface-2 inputs/selects/textareas with 8px corners, 12px muted field hints, and 80px minimum textareas. Admin buttons are compact, wrapping action groups; primary hover darkens to `--brand-fill-pressed` and disabled controls fade to half opacity. Admin has no explicit coach-style 48px minimum or shared focus-visible rule.
- Selection is indicated by `aria-pressed`, `aria-current`, `data-active`, filled clay, lighter clay text/borders, or an underline depending on the control. Coach destructive actions can use coral fill or an outlined danger treatment. Status chips are informational, smaller than touch controls.

## Navigation and interaction

- The shared coach shell uses a back affordance, team or player title, optional jersey badge and player switcher, and overflow action. Its bottom bar has Team, Add, and Review destinations; Add opens an action sheet for at-bat, practice, or player creation. Contextual segmented tabs and horizontally scrollable chips organize detail pages. Overflow becomes an action sheet below 600px and a positioned menu on wider screens.
- The simplified route uses a HitterLoop brand/settings top bar and Home, Record, Progress bottom tabs, with a surface-3 active tab. Public report/family pages use a compact brand strip rather than the coach bottom navigation. Admin uses a wrapping desktop top bar with text links and an active-link state.
- Shared coach overlays use a 60% black scrim, bottom sheet or centered confirmation dialog, and safe-area-aware footers. Only the top overlay closes on browser/Android Back; Escape and scrim clicks also close it. Background content becomes inert, focus moves into the overlay and returns to its trigger. The simplified route instead uses a native dialog that is bottom aligned on phones. Disclosures use native `<details>/<summary>`; compare and filter controls can scroll horizontally.
- Hover is selective: shared coach list rows and legacy player-switcher options lighten to `--surface-2`, admin table rows and nav links respond on hover, and admin primary buttons darken. Active/pressed states are more prominent on touch surfaces. Focus-visible is globally styled in coach CSS; admin relies on its route styles and browser defaults. The code does not define a universal hover state for every button.

## Loading, empty, error, and disabled states

- Shared coach empty and error states center an icon or heading, short supporting copy, and optional action. Error text/icons use danger coral. Processing states pair a short label with a 20px spinner, optional detail, and retry control; queue and report skeletons use slate blocks, with shimmer on `.bt-skeleton-row`. Snackbars announce short status text and can include an action.
- The simplified page has a live status message area, warning-colored error text, and in-card empty/error copy. Public report and family pages show skeleton blocks or centered report states while content loads or cannot be shown. Admin uses plain muted empty-state text, coral error text, and direct form feedback.
- Coach and admin disabled buttons use 50% opacity and a non-interactive cursor. Selected statuses and processing states use both wording/icons and color in the shared coach primitives; older screens still contain color-heavy score and heatmap displays. Reduced-motion settings suppress the coach stylesheet's animations.

## Consumer route standards (UI-PR3)

The simplified Home, report (including experimental), and Progress routes use these approved consumer roles. Shared coach and legacy scales remain as documented above.

| Role | Font and treatment | Size / line height |
|---|---|---|
| Display (Home h1 only) | Oswald 700, uppercase, 0.02em | 2rem / 1.1 |
| Title (app bar h1) | Oswald 600 | 1.375rem / 1.2 |
| Section (h2) | Inter 700, uppercase, 0.08em, `--brand-text` | 0.75rem / 1.4 |
| Issue (h3) | Oswald, uppercase, existing issue title size | 1.3rem / 1.2 |
| Cue | Oswald 600 | 1.5rem / 1.25 |
| Body | Inter 400 | 1rem / 1.5 |
| Meta | Inter 500 | 0.875rem / 1.4 |
| Caption | Inter 400 | 0.8125rem / 1.4 |

Consumer radii are cards 16px, buttons 12px, chips 999px, and sheet top corners 20px. Card padding is 16px, card gap 12px, and section gap 24px, using the existing spacing ladder. Each view has one h1; section h2 headings precede issue h3 titles. Strength text uses `--text-1` with the shared check icon in `--success`.

Progress uses existing `bt-status-chip` classes: Improving and Looks fixed are success; Early read, Checking, Still showing up, No clear pattern, and unknown statuses are neutral (`--surface-3` with `--text-1`). Meaning always appears in text. Brand fill is never a text colour; primary fills use white. Do not put `--text-3` or danger text on surface-3.

About this video and drill disclosures use native details/summary with a visible shared chevron-down icon. About this video keeps its descriptive summary visible while collapsed. Expanded chevrons rotate 180 degrees; reduced motion disables rotation and transition. Summary targets are at least 48px high. How to film puts the warning-bordered, warning-subtle safety note first, immediately after its title.

Normal reports show "Play video" with no event marker until source-frame timing exists.

Limited report analysis uses `.simple-status-line`: a shared info icon, explicit status text in `--text-1`, a `--warning` left border, and existing spacing tokens. It has `role="note"` and appears under the experimental banner when present.

### Coach Team and Player screens (UI-PR4)

Coaches use Team / Record / Progress; parents retain Home / Record / Progress. Team roster rows use the existing small jersey badge, player name, latest at-bat summary line, shared chevron and a separate overflow button. Latest-at-bat status uses the existing neutral or warning chips; focus remains server-owned in Progress. Team has no counts, filters, averages or review badges. Player uses the consumer app bar and shared Home feed, followed by a Parents card with linked guardians, pending invites, and existing secondary/destructive actions. Legacy coach tools are available only through the explicit Settings compatibility link.

Settings includes a coach-only Shared links sheet listing creator-only links without tokens, grouped into Active / Expired or turned off. A Player details card follows Parents, with a muted context summary, secondary Edit details, and destructive Delete player actions.

## Existing conflicts requiring a product decision

- The simplified route and the shared coach shell use different navigation models (Home/Record/Progress versus Team/Add/Review), heading scale, and card radius. The shared palette is the current common convention. Choosing one navigation or typography system across those routes is a product decision; this document preserves both as implemented.
- The coach stylesheet states a 48px touch minimum, yet shared `.bt-button` can be 44px, filter chips 40px, and some legacy actions smaller. Admin intentionally has no touch minimum. A future accessibility pass must decide whether to standardize these controls; the current exception is documented, not silently treated as compliant.
- Coach pages use an explicit clay focus-visible outline, while admin does not. Link colors also differ by route: sand on coach/family/simplified pages and darker clay in admin. These are presentational differences that need a cross-route decision only if the admin is brought into the consumer-facing design system.
