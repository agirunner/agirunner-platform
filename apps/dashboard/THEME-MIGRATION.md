# Theme Migration Guide

## Overview

The dashboard is migrating from a Tailwind `dark:` class-based theme to a **dark-only CSS custom property** theme. The new system is defined in `theme-tokens.ts` and exposed via CSS variables in `app.css`.

This document lists every file that needs updating and explains how to do it correctly.

**Priority order:** execution section (work pages) first, then config, governance, fleet, workspaces, shared components, and UI primitives last.

---

## Migration Steps

For each file in the list below, apply these steps in order:

1. **Remove `dark:` prefixed Tailwind classes** — delete the `dark:` variant entirely. The base class becomes the only class.
   ```
   // Before
   className="bg-white dark:bg-gray-900"

   // After
   className="bg-[var(--color-bg-primary)]"
   ```

2. **Replace hardcoded Tailwind color classes with CSS var equivalents**
   ```
   // Before
   className="bg-gray-800 text-gray-300 border-gray-600"

   // After
   className="bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] border-[var(--color-border-subtle)]"
   ```

3. **Replace hardcoded hex values in inline styles with token imports**
   ```tsx
   // Before
   style={{ color: '#888888' }}

   // After
   import { colors } from '@/app/theme-tokens';
   style={{ color: colors.textTertiary }}
   ```

4. **Replace `data-theme` conditional logic** — remove any code that reads or switches between `light` and `dark`.

5. **Test visual appearance** — verify the component renders correctly against a dark background and that interactive states (hover, focus, active) are visible.

---

## ThemeProvider Removal (Task 26)

The existing `theme.ts` file (`src/app/theme.ts`) contains `readTheme`, `applyTheme`, and the `ThemeMode` type. These are no longer needed once migration is complete.

When Task 26 runs, perform the following:

1. Delete `src/app/theme.ts` entirely.
2. In `layout.tsx`, remove the `onToggleTheme` prop and any call to `applyTheme` or `readTheme`.
3. In `DashboardLayout` (or wherever the toggle renders), remove the theme toggle button.
4. Remove the `[data-theme="dark"]` block from `app.css` — the `:root` block is sufficient.
5. Remove the `@theme` block from `app.css` if it is no longer referenced anywhere (it contains legacy Tailwind semantic colors).
6. Search for any remaining `localStorage.getItem('agirunner.theme')` or `data-theme` references and delete them.

Do not perform this removal until all files below have been migrated and verified.

---

## Files to Migrate

### UI Primitives (`src/components/ui/`)

These are the lowest-level components. Migrate these carefully — changes propagate everywhere.

| File | Notes |
|---|---|
| `button.tsx` | Remove `dark:` variants, use `--color-accent-primary` for primary, `--color-bg-secondary` for secondary |
| `badge.tsx` | Status color backgrounds at 20% opacity; remove `dark:` |
| `card.tsx` | `--color-bg-secondary` background, border-focus on hover |
| `dialog.tsx` | Backdrop uses `--color-bg-overlay`, content uses `--color-bg-secondary`, shadow-overlay |
| `dropdown-menu.tsx` | `--color-bg-secondary`, `--shadow-dropdown`, border `--color-border-subtle` |
| `input.tsx` | `--color-bg-primary`, border `--color-border-subtle`, focus border `--color-border-focus` |
| `popover.tsx` | Same as dropdown-menu |
| `select.tsx` | Same as input + dropdown |
| `separator.tsx` | `--color-border-default` |
| `skeleton.tsx` | `--color-bg-secondary` with opacity pulse |
| `switch.tsx` | Track: `--color-bg-secondary`; active: `--color-accent-primary` |
| `table.tsx` | Header: `--color-bg-deep`; row border: `--color-border-default` |
| `tabs.tsx` | Inactive: `--color-bg-secondary`; active: `--color-accent-primary` pill pattern |
| `textarea.tsx` | Same as input |
| `toggle-card.tsx` | Pill container `--color-bg-secondary`, active `--color-accent-primary` |
| `tooltip.tsx` | `--color-bg-deep`, `--color-text-primary`, `--shadow-dropdown` |

### Shared Components (`src/components/`)

| File | Notes |
|---|---|
| `layout.tsx` | Remove theme toggle prop and `applyTheme` call; sidebar uses `--color-bg-deep` |
| `breadcrumb-bar.tsx` | Text colors: primary/tertiary tokens; separator: `--color-border-default` |
| `diff-viewer.tsx` | `--color-bg-deep` background, addition/deletion use status colors |
| `execution-log-viewer.tsx` | `--color-bg-deep`, monospace, status color row highlights |
| `execution-inspector-*.tsx` (4 files) | Replace all `dark:` classes; status row left-border pattern |
| `log-viewer/*.tsx` (18 files) | `--color-bg-deep` for log surface; level colors map to status tokens |
| `saved-views.tsx` | `--color-bg-secondary`, border tokens |
| `structured-data.tsx` | `--color-bg-secondary` rows, `--color-text-tertiary` labels |
| `operator-display.tsx` | Role color dot (6px, `--role-<name>`), `--color-text-secondary` name |
| `built-in-capability-badge.tsx` | Use badge pattern: status color 20% bg |
| `workflow-budget-card.tsx` | `--color-bg-secondary` card, `--color-status-warning` for budget alerts |
| `chain-workflow-dialog.tsx` | Dialog pattern |
| `artifact-preview-page.tsx` | `--color-bg-deep` for preview area |

### Work / Execution Pages (`src/pages/work/` and `src/pages/workflow-*.tsx`)

Highest priority — these are the primary user-facing surfaces.

| File | Notes |
|---|---|
| `workflow-list-page.tsx` | List surface, filter bar |
| `workflow-list-layouts.tsx` | Grid/board layout containers |
| `workflow-list-board-view.tsx` | Kanban columns: `--color-bg-secondary` |
| `workflow-list-summary-cards.tsx` | Metric cards: `--color-bg-secondary` |
| `workflow-list-view-toggle.tsx` | Toggle pill pattern |
| `workflow-detail-page.tsx` | Detail shell |
| `workflow-detail-content.tsx` | Content area |
| `workflow-detail-sections.tsx` | Section headers |
| `workflow-inspector-page.tsx` | Inspector layout |
| `workflow-inspector-page.sections.tsx` | Section cards |
| `workflow-inspector-telemetry-panel.tsx` | `--color-bg-deep` for telemetry |
| `workflow-work-item-detail-panel.tsx` | Slide-in panel, `--shadow-panel` |
| `workflow-work-item-history-*.tsx` (4 files) | Timeline entries, status colors |
| `workflow-work-item-task-review-dialogs.tsx` | Dialog pattern |
| `workflow-work-item-metadata-editor.tsx` | Input pattern |
| `workflow-control-actions.tsx` | Action button group |
| `workflow-surface-recovery-state.tsx` | Error state colors |
| `workflow-history-card.tsx` | Card pattern |
| `task-list-page.tsx` | Task list |
| `task-list-page.rows.tsx` | Row pattern with status left-border |
| `task-list-page.sections.tsx` | Section headers |
| `task-detail-page.tsx` | Task detail |
| `task-detail-artifacts-panel.tsx` | `--color-bg-secondary` |
| `task-detail-context-section.tsx` | `--color-text-tertiary` labels |
| `approval-queue-page.tsx` | Queue list |
| `approval-queue-layout.tsx` | Layout shell |
| `approval-queue-stage-gate-card.tsx` | Status border pattern |
| `approval-queue-task-card.tsx` | Card pattern |
| `approval-queue-review-disclosure.tsx` | Disclosure surface |
| `gate-detail-card.tsx` | Status color border |
| `gate-handoff-trail.tsx` | Timeline trail |
| `operator-breadcrumb-trail.tsx` | Breadcrumb with role colors |

### Config Pages (`src/pages/config/`)

| File | Notes |
|---|---|
| `role-definitions-page.tsx` | List page |
| `role-definitions-list.tsx` | Row with role color dot |
| `role-definitions-dialog.tsx` | Dialog pattern |
| `role-definitions-dialog.basics.tsx` | Form fields |
| `role-definitions-dialog.catalog.tsx` | Catalog items |
| `role-definitions-dialog.summary.tsx` | Summary section |
| `role-definitions-orchestrator.tsx` | Orchestrator section |
| `role-definitions-orchestrator.sections.tsx` | Section cards |
| `role-definitions-orchestrator.dialogs.tsx` | Dialog pattern |
| `role-definitions-delete-dialog.tsx` | Destructive dialog: `--color-status-error` |
| `llm-providers-page.tsx` | Provider cards |
| `runtime-defaults-page.tsx` | Settings form |
| `runtime-defaults-fields.tsx` | Form field pattern |
| `runtime-defaults-search.tsx` | Search input |
| `runtimes-page.tsx` | Runtime list |
| `runtimes-build-history.tsx` | History list |
| `playbook-list-page.tsx` | Playbook catalog |
| `playbook-list-page.library.tsx` | Library grid |
| `playbook-detail-page.tsx` | Detail surface |
| `playbook-detail-sections.tsx` | Section cards |
| `playbook-authoring-form.tsx` | Form shell |
| `playbook-authoring-form-fields.tsx` | Field patterns |
| `playbook-authoring-form-sections.tsx` | Section layout |
| `playbook-authoring-structured-controls.tsx` | Structured controls |
| `playbook-launch-page.tsx` | Launch wizard |
| `playbook-launch-*.tsx` (9 files) | Wizard step patterns |
| `platform-instructions-page.tsx` | Monaco editor page |
| `platform-instructions-page.content.tsx` | Content area |
| `orchestrator-page.tsx` | Orchestrator config |
| `tools-page.tsx` | Tools list |
| `tools-page.dialogs.tsx` | Dialog pattern |
| `integrations-page.tsx` | Integration list |
| `integrations-editor-dialog.tsx` | Dialog pattern |
| `webhooks-page.tsx` | Webhook list |
| `work-item-triggers-page.tsx` | Trigger list |
| `ai-config-assistant-page.tsx` | Assistant surface |
| `config-form-controls.tsx` | Shared form controls |

### Governance Pages (`src/pages/governance/`)

| File | Notes |
|---|---|
| `api-key-page.tsx` | Key list |
| `api-key-page.sections.tsx` | Section cards |
| `api-key-page.dialogs.tsx` | Dialog pattern |
| `user-management-page.tsx` | User table |
| `user-management-page.sections.tsx` | Sections |
| `user-management-page.dialogs.tsx` | Dialog pattern |
| `user-management-page.deactivate-dialog.tsx` | Destructive dialog |
| `orchestrator-grants-page.tsx` | Grants list |
| `orchestrator-grants-page.sections.tsx` | Sections |
| `orchestrator-grants-page.table.tsx` | Table pattern |
| `orchestrator-grants-page.dialog.tsx` | Dialog pattern |
| `governance-review-field.tsx` | Field pattern |
| `retention-policy-page.tsx` | Settings form |
| `settings-page.tsx` | General settings |

### Fleet Pages (`src/pages/fleet/`)

| File | Notes |
|---|---|
| `worker-list-page.tsx` | Worker table |
| `worker-desired-state-dialog.tsx` | Dialog pattern |
| `agent-list-page.tsx` | Agent table with role color dots |
| `fleet-status-page.tsx` | Fleet status cards |
| `warm-pools-page.tsx` | Pool cards |
| `docker-page.tsx` | Docker info surface |

### Workspace Pages (`src/pages/workspaces/`)

| File | Notes |
|---|---|
| `workspace-list-page.tsx` | Workspace list |
| `workspace-list-page.cards.tsx` | Card grid |
| `workspace-list-page.dialogs.tsx` | Dialog pattern |
| `workspace-detail-page.tsx` | Detail shell |
| `workspace-detail-shell.tsx` | Shell layout |
| `workspace-overview-shell.tsx` | Overview tab |
| `workspace-settings-shell.tsx` | Settings tab shell |
| `workspace-settings-tab.tsx` | Settings form |
| `workspace-knowledge-shell.tsx` | Knowledge tab |
| `workspace-knowledge-tab.tsx` | Knowledge content |
| `workspace-detail-memory-tab.tsx` | Memory tab |
| `workspace-automation-tab.tsx` | Automation tab |
| `workspace-resources-tab.tsx` | Resources tab |
| `workspace-tools-tab.tsx` | Tools tab |
| `workspace-spec-tab.tsx` | Spec tab |
| `workspace-memory-table.tsx` | Memory table |
| `workspace-memory-table.fields.tsx` | Field cells |
| `workspace-memory-history-panel.tsx` | History panel |
| `workspace-content-*.tsx` (3 files) | Content tables |
| `workspace-delivery-history.tsx` | History list |
| `workspace-artifact-explorer-*.tsx` (5 files) | Explorer shell and panels |
| `workspace-artifact-files-panel.tsx` | File tree panel |
| `workspace-git-webhook-signatures-card.tsx` | Card pattern |
| `workspace-scheduled-trigger-form.tsx` | Form pattern |
| `workspace-scheduled-triggers-card.tsx` | Card pattern |
| `workspace-webhook-triggers-card.tsx` | Card pattern |
| `workspace-structured-entry-editor.tsx` | Editor surface |
| `workspace-detail-shared.tsx` | Shared types/helpers |

### Mission Control Pages (`src/pages/mission-control/`)

These pages are being deprecated but may contain patterns worth referencing before removal.

| File | Notes |
|---|---|
| `live-board-page.tsx` | Live board — patterns absorbed into new execution screen |
| `cost-dashboard-page.tsx` | Cost metrics — may move to governance |
| `cost-dashboard-breakdown-cards.tsx` | Card pattern |
| `alerts-approvals-page.tsx` | Being replaced by approval queue |
| `logs-page.tsx` | Being replaced by unified log viewer |
| `logs-page-activity-packets.tsx` | Activity packets |

### Top-Level Pages

| File | Notes |
|---|---|
| `src/pages/login-page.tsx` | Center-aligned on `--color-bg-primary`, form uses input pattern |
| `src/pages/governance-page.tsx` | Governance shell |
| `src/pages/workspaces-page.tsx` | Workspace shell |
| `src/pages/system-metrics-page.tsx` | Metrics surface |
| `src/pages/api-key-management-page.tsx` | Legacy key page |
