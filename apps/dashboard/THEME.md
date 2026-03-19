# Dashboard Theme Reference

## Overview

The dashboard uses a **dark-only theme**. There is no light/dark toggle. All theme values are defined in a single authoritative source:

```
apps/dashboard/src/app/theme-tokens.ts
```

CSS custom properties are generated from `theme-tokens.ts` via `toCssVars()` and applied to `:root` in `src/styles/app.css`. If the CSS and the TypeScript tokens diverge, update the CSS to match `theme-tokens.ts`.

---

## Color Tokens

All 18 color tokens. The CSS variable name is derived from the JS key by converting camelCase to kebab-case and prefixing with `--color-`.

| JS Token (`colors.*`) | CSS Variable | Value | Usage |
|---|---|---|---|
| `bgPrimary` | `--color-bg-primary` | `#1a1a2e` | Page background, input backgrounds |
| `bgSecondary` | `--color-bg-secondary` | `#252540` | Cards, panels, elevated surfaces |
| `bgDeep` | `--color-bg-deep` | `#0d0d1a` | Code blocks, raw stream, deepest surfaces |
| `bgOverlay` | `--color-bg-overlay` | `rgba(0,0,0,0.7)` | Modal and command palette backdrop |
| `accentPrimary` | `--color-accent-primary` | `#8b5cf6` | Primary actions, active states, branding |
| `accentPrimaryMuted` | `--color-accent-primary-muted` | `#8b5cf640` | Hover states, subtle highlights |
| `statusSuccess` | `--color-status-success` | `#22c55e` | Running, completed, healthy, online |
| `statusWarning` | `--color-status-warning` | `#f59e0b` | Gate waiting, attention needed, degraded |
| `statusError` | `--color-status-error` | `#ef4444` | Failed, cancelled, offline |
| `link` | `--color-link` | `#3b82f6` | Hyperlinks, clickable references |
| `textPrimary` | `--color-text-primary` | `#ffffff` | Headings, names, primary content |
| `textSecondary` | `--color-text-secondary` | `#cccccc` | Body text, descriptions |
| `textTertiary` | `--color-text-tertiary` | `#888888` | Labels, metadata, timestamps |
| `textMuted` | `--color-text-muted` | `#666666` | Placeholders, disabled text, hints |
| `textFaint` | `--color-text-faint` | `#555555` | Subtle separators, inactive tabs |
| `borderDefault` | `--color-border-default` | `#333333` | Dividers, card borders |
| `borderFocus` | `--color-border-focus` | `#8b5cf6` | Focused inputs, active panels |
| `borderSubtle` | `--color-border-subtle` | `#444444` | Input borders, secondary dividers |

---

## Role Colors

Role colors are exposed as `--role-<name>` CSS variables and as the `roleColors` export from `theme-tokens.ts`.

| Role | CSS Variable | Value |
|---|---|---|
| `developer` | `--role-developer` | `#8b5cf6` |
| `reviewer` | `--role-reviewer` | `#f59e0b` |
| `architect` | `--role-architect` | `#22c55e` |
| `qa` | `--role-qa` | `#3b82f6` |
| `product-manager` | `--role-product-manager` | `#ec4899` |
| `orchestrator` | `--role-orchestrator` | `#06b6d4` |

---

## Shadows

| Token (`shadows.*`) | CSS Variable | Value | Usage |
|---|---|---|---|
| `none` | `--shadow-none` | `none` | Reset / no elevation |
| `panel` | `--shadow-panel` | `0 4px 24px rgba(0,0,0,0.4)` | Sidebars, detail panels |
| `overlay` | `--shadow-overlay` | `0 8px 32px rgba(139,92,246,0.3)` | Modals, command palette |
| `dropdown` | `--shadow-dropdown` | `0 4px 12px rgba(0,0,0,0.5)` | Menus, popovers, tooltips |

---

## Transitions

| Token (`transitions.*`) | CSS Variable | Value | Usage |
|---|---|---|---|
| `fast` | `--transition-fast` | `150ms ease-out` | Hover states, toggles, badges |
| `normal` | `--transition-normal` | `250ms ease-out` | Panel open/close, tab switches |
| `slow` | `--transition-slow` | `400ms ease-out` | Page-level transitions, large reveals |

---

## Z-Index Scale

| Token (`zIndex.*`) | CSS Variable | Value | Usage |
|---|---|---|---|
| `base` | `--z-base` | `0` | Normal document flow |
| `sticky` | `--z-sticky` | `10` | Sticky headers, pinned rows |
| `panel` | `--z-panel` | `20` | Side panels, drawers (background) |
| `resource` | `--z-resource` | `25` | Resource detail cards |
| `drawer` | `--z-drawer` | `30` | Slide-in drawers |
| `overlayBackdrop` | `--z-overlay-backdrop` | `40` | Backdrop scrim behind overlays |
| `overlay` | `--z-overlay` | `50` | Modals, dialogs |
| `palette` | `--z-palette` | `60` | Command palette |
| `connection` | `--z-connection` | `70` | Connection status toasts |

---

## Spacing

The theme uses a 4px base scale. These values are used directly as pixel values in inline styles or as Tailwind arbitrary values.

`4, 6, 8, 10, 12, 14, 16, 20, 24, 32`

Import from `theme-tokens.ts` as `spacing` when you need a value programmatically. Prefer Tailwind classes (e.g., `p-4`, `gap-6`) for static layout; use arbitrary values (`p-[10px]`) only when a spacing value falls outside the Tailwind default scale.

---

## Typography

| Property | Value |
|---|---|
| Font family | `ui-monospace, 'SF Mono', 'Cascadia Code', 'Fira Code', Menlo, Monaco, Consolas, monospace` |
| CSS variable | `--font-family` |

### Size Hierarchy

| Role | Size | Weight | Usage |
|---|---|---|---|
| Page heading | `13px` | bold | Page title, major section name |
| Section heading | `11px` | bold | Card header, group label |
| Subsection heading | `10px` | bold | Sub-group label, sidebar section |
| Body | `11px` | normal | General content text |
| Label | `9–10px` | medium, uppercase | Field labels, column headers, chips |
| Code | `10px` | normal (monospace) | Code blocks, raw output, IDs |

---

## Component Patterns

These patterns define the expected visual treatment for each recurring component type.

### Cards
- Background: `--color-bg-secondary`
- Border radius: `6–8px`
- Default state: no visible border (border present at `borderDefault` but blends in)
- Hover state: border becomes `--color-border-focus` (accent purple)

### Status Rows
- A `3px` left border in the relevant status color (`statusSuccess`, `statusWarning`, `statusError`)
- Row background remains `--color-bg-secondary`

### Primary Buttons
- Background: `--color-accent-primary`
- Text: `--color-text-primary` (white)
- Hover: slightly lighter or `accentPrimaryMuted` overlay

### Secondary Buttons
- Background: `--color-bg-secondary`
- Border: `--color-border-subtle`
- Text: `--color-text-secondary`

### Toggles and Dials
- Pill container background: `--color-bg-secondary`
- Active segment background: `--color-accent-primary`
- Active segment text: white

### Badges
- Background: status color at 20% opacity (e.g., `rgba(34,197,94,0.2)` for success)
- Text: full status color value

### Inputs
- Background: `--color-bg-primary`
- Default border: `--color-border-subtle`
- Focus border: `--color-border-focus`
- Placeholder text: `--color-text-muted`

### Agent Dots
- 6px circles
- Fill color: the agent's role color from `--role-<name>`

---

## Usage Rules

1. **No raw hex values in component code.** Use `var(--color-*)` in CSS/Tailwind or import named tokens from `theme-tokens.ts` in JS/TS.
2. **`theme-tokens.ts` is authoritative.** If `app.css` diverges from the token file, update `app.css` to match — never the other way around.
3. **Never use `dark:` prefixed Tailwind classes.** The theme is dark-only; `dark:` classes are dead weight and should be removed on sight.
4. **Never hardcode z-index values.** Import from `zIndex` in `theme-tokens.ts` or use `var(--z-*)`.

---

## Usage Examples

### Tailwind arbitrary value (CSS var)

```tsx
<div className="bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] rounded-lg p-4">
  ...
</div>
```

### Inline style from token import

```tsx
import { colors, roleColors } from '@/app/theme-tokens';

<span style={{ color: colors.textTertiary, fontSize: '10px' }}>
  last updated 3m ago
</span>

<span
  style={{
    backgroundColor: roleColors['developer'],
    width: 6,
    height: 6,
    borderRadius: '50%',
  }}
/>
```

### Full import pattern

```ts
import {
  colors,
  roleColors,
  shadows,
  transitions,
  zIndex,
  spacing,
  typography,
  type RoleName,
} from '@/app/theme-tokens';
```
