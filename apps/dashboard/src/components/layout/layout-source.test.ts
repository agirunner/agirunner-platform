import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildBreadcrumbs } from './layout.js';

function readLayoutSource() {
  return [
    './layout.tsx',
    './layout-nav.tsx',
    './layout-sidebar.tsx',
    './layout-command-palette.tsx',
  ]
    .map((path) => readFileSync(resolve(import.meta.dirname, path), 'utf8'))
    .join('\n');
}

function readDialogSource() {
  return readFileSync(resolve(import.meta.dirname, '../ui/dialog.tsx'), 'utf8');
}

describe('layout source contracts', () => {
  it('points integrations navigation at the triggers route', () => {
    const source = readLayoutSource();
    expect(source).toContain("label: 'Integrations'");
    expect(source.indexOf("label: 'MCP Servers'")).toBeLessThan(
      source.indexOf("label: 'Triggers (soon)'"),
    );
    expect(source.indexOf("label: 'Triggers (soon)'")).toBeLessThan(
      source.indexOf("label: 'Webhooks (soon)'"),
    );
    expect(source).toContain("label: 'Triggers (soon)'");
    expect(source).toContain("href: '/integrations/triggers'");
    expect(source).toContain("label: 'MCP Servers'");
    expect(source).toContain("href: '/integrations/mcp-servers'");
    expect(source).toContain("label: 'Webhooks (soon)'");
    expect(source).toContain("href: '/integrations/webhooks'");
    expect(source).not.toContain("label: 'ACP'");
    expect(source).not.toContain("href: '/integrations/acp'");
    expect(source).not.toContain("label: 'Agent Protocols'");
  });

  it('keeps playbooks above workspaces in the Work Design nav group', () => {
    const source = readLayoutSource();
    expect(source.indexOf("label: 'Playbooks'")).toBeLessThan(
      source.indexOf("label: 'Workspaces'"),
    );
  });

  it('keeps advanced settings under admin and leaves platform focused on regular operator surfaces', () => {
    const source = readLayoutSource();
    expect(source).toContain("label: 'Platform'");
    expect(source).toContain("href: '/platform/environments'");
    expect(source).toContain("href: '/platform/tools'");
    expect(source).toContain("label: 'Diagnostics'");
    expect(source).toContain("label: 'Live Containers'");
    expect(source).toContain("href: '/diagnostics/live-containers'");
    expect(source).toContain("label: 'Agentic Settings'");
    expect(source).toContain("href: '/admin/agentic-settings'");
    expect(source).toContain("label: 'Platform settings'");
    expect(source).toContain("href: '/admin/platform-settings'");
    expect(source).toContain("label: 'General Settings'");
    expect(source).toContain("href: '/admin/general-settings'");
    expect(source).not.toContain("href: '/platform/runtimes'");
    expect(source).not.toContain("href: '/platform/operations'");
    expect(source).not.toContain("label: 'Fleet'");
    expect(source).not.toContain("label: 'Runtime Defaults'");
    expect(source).not.toContain("href: '/fleet/workers'");
    expect(source).not.toContain("href: '/fleet/warm-pools'");
    expect(source).not.toContain("href: '/fleet/status'");
  });

  it('has separate Orchestrator and Specialists nav entries in their new groups', () => {
    const source = readLayoutSource();
    expect(source).toContain("label: 'Orchestrator'");
    expect(source).toContain("href: '/platform/orchestrator'");
    expect(source).toContain("label: 'Specialists'");
    expect(source).toContain("href: '/design/specialists'");
  });

  it('keeps Mission Control as the parent nav label while exposing Workflows as the inner item', () => {
    const source = readLayoutSource();

    expect(source.match(/label: 'Mission Control'/g)).toHaveLength(1);
    expect(source).toContain("label: 'Workflows',");
    expect(source).toContain('function readSidebarItemStateClasses(isActive: boolean): string {');
    expect(source).toContain('return SIDEBAR_ACTIVE_ITEM_CLASSES;');
    expect(source).not.toContain('SIDEBAR_CONTEXTUAL_ACTIVE_ITEM_CLASSES');
    expect(source).not.toContain("return sectionLabel === 'Mission Control'");
    expect(source).toContain(
      'isActive ? SIDEBAR_SECTION_ACTIVE_CLASSES : SIDEBAR_SECTION_INACTIVE_CLASSES',
    );
    expect(source).not.toContain('bg-amber');
    expect(source).not.toContain('bg-yellow');
  });

  it('treats the routed content area as the only vertical scroll container', () => {
    const source = readLayoutSource();
    expect(source).toContain('<div className="flex h-dvh min-h-screen overflow-hidden">');
    expect(source).toContain(
      '<main className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-background pt-12 lg:pt-0">',
    );
    expect(source).toContain(
      '<div className="flex min-h-0 min-w-0 flex-1 flex-col px-4 py-4 sm:px-6 lg:px-8">',
    );
    expect(source).toContain('<div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">');
    expect(source).not.toContain(
      '<div className="flex min-h-full min-w-0 flex-1 flex-col px-4 py-4 sm:px-6 lg:px-8">',
    );
  });

  it('renders Mission Control like the other expandable nav groups instead of collapsing it into a single row', () => {
    const source = readLayoutSource();
    expect(source).toContain("label: 'Mission Control'");
    expect(source).toContain("label: 'Workflows'");
    expect(source).toContain('const rendersAsSingleItem =');
    expect(source).toContain('props.section.items.length === 1');
    expect(source).toContain('props.section.items[0]?.label === props.section.label');
    expect(source).toContain(
      'const singleItem = rendersAsSingleItem ? props.section.items[0] : null;',
    );
    expect(source).toContain('<span className="flex-1 text-left">{props.section.label}</span>');
    expect(source).toContain(
      "<ChevronRight size={14} className={cn('transition-transform', expanded && 'rotate-90')} />",
    );
    expect(source).toContain('{item.label}');
    expect(source).not.toContain("label: 'Mission Control',\n        href: WORKFLOWS_NAV_HREF,");
  });

  it('uses distinct icons for playbooks, environments, live diagnostics, webhooks, and agentic settings', () => {
    const source = readLayoutSource();
    expect(source).toContain("{ label: 'Playbooks', href: '/design/playbooks', icon: FileText }");
    expect(source).toContain("label: 'Environments'");
    expect(source).toContain("href: '/platform/environments'");
    expect(source).toContain('icon: Container');
    expect(source).toContain("href: '/diagnostics/live-containers'");
    expect(source).toContain('icon: Package');
    expect(source).toContain("href: '/diagnostics/live-logs'");
    expect(source).toContain("label: 'Live Logs'");
    expect(source).toContain("href: '/integrations/webhooks'");
    expect(source).toContain('icon: Send');
    expect(source).toContain("href: '/admin/agentic-settings',");
    expect(source).toContain('icon: Server');
  });

  it('hides the AI Assistant page from primary navigation', () => {
    const source = readLayoutSource();
    expect(source).not.toContain("label: 'AI Assistant'");
  });

  it('keeps user management out of the primary admin navigation', () => {
    const source = readLayoutSource();
    expect(source).toContain("label: 'Admin'");
    expect(source).toContain("label: 'API Keys'");
    expect(source).toContain("href: '/admin/api-keys'");
    expect(source).toContain("href: '/admin/general-settings'");
    expect(source.indexOf("href: '/admin/api-keys'")).toBeLessThan(
      source.indexOf("href: '/admin/general-settings'"),
    );
    expect(source).not.toContain("label: 'Retention Policy'");
    expect(source).not.toContain("label: 'User Management'");
  });

  it('removes orchestrator grants from governance navigation and breadcrumbs', () => {
    const source = readLayoutSource();
    expect(source).not.toContain("label: 'Orchestrator Grants'");
    expect(source).not.toContain("href: '/governance/grants'");
    expect(buildBreadcrumbs('/governance/grants')).toEqual([
      { label: 'Admin' },
      { label: 'Grants' },
    ]);
  });

  it('attaches orchestrator keywords to the roles nav item for command palette search', () => {
    const source = readLayoutSource();
    expect(source).toContain("keywords: ['orchestrator'");
    expect(source).toContain("'prompt'");
    expect(source).toContain("'model routing'");
    expect(source).toContain("label: 'Models'");
    expect(source).toContain("'pool posture'");
    expect(source).toContain("'role definitions'");
    expect(source).toContain("label: 'Specialists'");
  });

  it('passes nav item keywords through to command palette quick links', () => {
    const source = readLayoutSource();
    expect(source).toContain('item.keywords?.length');
    expect(source).toContain('keywords: item.keywords');
  });

  it('keeps Mission Control scoped to the workflows route without restoring separate live board, tasks, or action queue links', () => {
    const source = readLayoutSource();
    expect(source).toContain("label: 'Mission Control'");
    expect(source).toContain("label: 'Workflows'");
    expect(source).toContain('WORKFLOWS_NAV_HREF');
    expect(source).toContain("const WORKFLOWS_NAV_HREF = '/workflows'");
    expect(source).not.toContain('SIDEBAR_WORKFLOWS_ACTIVE_CLASSES');
    expect(source).not.toContain('SIDEBAR_WORKFLOWS_INACTIVE_CLASSES');
    expect(source).not.toContain('isWorkflowsNavItem(item)');
    expect(source).toContain("'live operations'");
    expect(source).toContain("'action queue'");
    expect(source).toContain("'workflow canvas'");
    expect(source).toContain("'attention rail'");
    expect(source).not.toContain("label: 'Live Board'");
    expect(source).not.toContain("label: 'Action Queue'");
  });

  it('wires keyboard-first command palette navigation and explicit search states', () => {
    const source = readLayoutSource();
    expect(source).toContain("event.key === 'ArrowDown'");
    expect(source).toContain("event.key === 'ArrowUp'");
    expect(source).toContain('dashboard-command-palette-results');
    expect(source).toContain('Search the workspace');
    expect(source).toContain('describeCommandPaletteState');
    expect(source).toContain('shouldRunCommandPaletteSearch');
    expect(source).toContain('buildCommandPaletteSections');
    expect(source).toContain('recordRecentCommandPaletteItem');
    expect(source).toContain('Actions');
    expect(source).toContain('Recent');
  });

  it('uses dialog semantics and restores focus for the mobile menu and command palette overlays', () => {
    const source = readLayoutSource();
    expect(source).toContain('open={isMobileMenuOpen}');
    expect(source).toContain('open={searchOpen}');
    expect(source).toContain('DialogTitle className="sr-only">Navigation menu');
    expect(source).toContain('DialogDescription className="sr-only"');
    expect(source).toContain('onOpenAutoFocus');
    expect(source).toContain('onCloseAutoFocus');
    expect(source).toContain('restoreFocusToElement');
    expect(source).toContain('searchRestoreFocusRef');
    expect(source).toContain('mobileMenuRestoreFocusRef');
    expect(source).toContain('skipMobileMenuRestoreRef');
    expect(source).toContain('Close navigation menu');
    expect(source).toContain('Close command palette');
  });

  it('applies visible keyboard focus treatment to layout controls and palette rows', () => {
    const source = readLayoutSource();
    expect(source).toContain('FOCUS_RING_CLASSES');
    expect(source).toContain('focus-visible:ring-offset-surface');
    expect(source).toContain('aria-haspopup="dialog"');
    expect(source).toContain('aria-expanded={props.searchOpen}');
  });

  it('uses recessed nav groups and high-contrast active states in the sidebar', () => {
    const source = readLayoutSource();
    expect(source).toContain('SIDEBAR_SHELL_CLASSES');
    expect(source).toContain('SIDEBAR_SECTION_GROUP_CLASSES');
    expect(source).toContain('SIDEBAR_ACTIVE_ITEM_CLASSES');
    expect(source).toContain('bg-stone-100/95');
    expect(source).toContain('bg-sky-100 text-sky-950');
    expect(source).toContain('dark:bg-white dark:text-slate-950');
    expect(source).toContain('bg-stone-50/85');
    expect(source).not.toContain('bg-amber-200 text-amber-950');
    expect(source).not.toContain('bg-amber-50 text-amber-950');
    expect(source).not.toContain('border-l border-border pl-2');
    expect(source).not.toContain('bg-accent/10 font-medium text-accent');
  });

  it('supports a persisted collapsed desktop icon rail without changing the mobile menu dialog', () => {
    const source = readLayoutSource();
    expect(source).toContain('buildDesktopSidebarStorageKey(session?.tenantId ?? null)');
    expect(source).toContain(
      'readDesktopSidebarCollapsedState(localStorage, session?.tenantId ?? null)',
    );
    expect(source).toContain(
      "localStorage.setItem(desktopSidebarStorageKey, nextCollapsed ? 'true' : 'false')",
    );
    expect(source).toContain('Desktop navigation');
    expect(source).toContain('Expand sidebar');
    expect(source).toContain('Collapse sidebar');
    expect(source).toContain('title={item.label}');
    expect(source).toContain('aria-label={item.label}');
    expect(source).toContain('const sidebarWidthClass = props.isMobile');
    expect(source).toContain("? 'w-20'");
    expect(source).toContain(": 'w-64';");
    expect(source).toContain('DialogTitle className="sr-only">Navigation menu');
  });

  it('adds an accessible default close control to the shared dialog primitive', () => {
    const source = readDialogSource();
    expect(source).toContain("closeLabel = 'Close dialog'");
    expect(source).toContain('showCloseButton = true');
    expect(source).toContain('aria-label={closeLabel}');
    expect(source).toContain('sr-only');
    expect(source).toContain('focus-visible:ring-2');
  });
});
