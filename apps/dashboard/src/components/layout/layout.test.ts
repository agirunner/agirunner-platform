import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildBreadcrumbs,
  buildDesktopSidebarStorageKey,
  readDesktopSidebarCollapsedState,
} from './layout.js';

function readLayoutSource() {
  return readFileSync(resolve(import.meta.dirname, './layout.tsx'), 'utf8');
}

function readDialogSource() {
  return readFileSync(resolve(import.meta.dirname, '../ui/dialog.tsx'), 'utf8');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('layout breadcrumbs', () => {
  it('scopes desktop sidebar collapse state per tenant in localStorage', () => {
    expect(buildDesktopSidebarStorageKey('tenant-42')).toBe(
      'agirunner.desktop-sidebar-collapsed.tenant-42',
    );
    expect(buildDesktopSidebarStorageKey(null)).toBe('agirunner.desktop-sidebar-collapsed');
  });

  it('reads the persisted desktop sidebar collapse state defensively', () => {
    expect(
      readDesktopSidebarCollapsedState(
        createStorage({ 'agirunner.desktop-sidebar-collapsed.tenant-42': 'true' }),
        'tenant-42',
      ),
    ).toBe(true);
    expect(
      readDesktopSidebarCollapsedState(
        createStorage({ 'agirunner.desktop-sidebar-collapsed.tenant-42': 'false' }),
        'tenant-42',
      ),
    ).toBe(false);
    expect(readDesktopSidebarCollapsedState(undefined, 'tenant-42')).toBe(false);
    expect(
      readDesktopSidebarCollapsedState(
        createStorage({ 'agirunner.desktop-sidebar-collapsed': 'true' }),
        null,
      ),
    ).toBe(true);
    expect(
      readDesktopSidebarCollapsedState(
        createStorage({ 'agirunner.desktop-sidebar-collapsed.tenant-7': 'maybe' }),
        'tenant-7',
      ),
    ).toBe(false);
  });

  it('maps root path to Home breadcrumb', () => {
    expect(buildBreadcrumbs('/')).toEqual([{ label: 'Home' }]);
  });

  it('creates labeled breadcrumbs for sections', () => {
    expect(buildBreadcrumbs('/platform/orchestrator')).toEqual([
      { label: 'Platform' },
      { label: 'Orchestrator' },
    ]);
  });

  it('labels the platform models page as Models in breadcrumbs', () => {
    expect(buildBreadcrumbs('/platform/models')).toEqual([
      { label: 'Platform' },
      { label: 'Models' },
    ]);
  });

  it('labels the platform settings page in breadcrumbs', () => {
    expect(buildBreadcrumbs('/admin/platform-settings')).toEqual([
      { label: 'Admin' },
      { label: 'Platform settings' },
    ]);
  });

  it('labels the renamed general and agentic settings pages in breadcrumbs', () => {
    expect(buildBreadcrumbs('/admin/general-settings')).toEqual([
      { label: 'Admin' },
      { label: 'General Settings' },
    ]);
    expect(buildBreadcrumbs('/admin/agentic-settings')).toEqual([
      { label: 'Admin' },
      { label: 'Agentic Settings' },
    ]);
  });

  it('handles nested paths with id segments', () => {
    const crumbs = buildBreadcrumbs('/workflows/12345678-aaaa');
    expect(crumbs).toHaveLength(2);
    expect(crumbs[0]).toEqual({ label: 'Workflows', href: '/workflows' });
    expect(crumbs[1].href).toBeUndefined();
  });

  it('capitalizes and de-hyphenates segment labels', () => {
    const crumbs = buildBreadcrumbs('/workflows');
    expect(crumbs[0].label).toBe('Workflows');
  });

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

  it('labels the workflows nav item as Mission Control and keeps it on the shared active nav treatment', () => {
    const source = readLayoutSource();

    expect(source.match(/label: 'Mission Control'/g)).toHaveLength(2);
    expect(source).not.toContain("label: 'Workflows',");
    expect(source).toContain('active ? SIDEBAR_ACTIVE_ITEM_CLASSES : SIDEBAR_INACTIVE_ITEM_CLASSES');
    expect(source).not.toContain('bg-amber');
    expect(source).not.toContain('bg-yellow');
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

  it('labels the deprecated users route truthfully in breadcrumbs', () => {
    expect(buildBreadcrumbs('/governance/users')).toEqual([
      { label: 'Admin' },
      { label: 'Legacy User Access' },
    ]);
  });

  it('keeps workspace scoped explorer breadcrumbs clickable without exposing raw UUID labels', () => {
    expect(
      buildBreadcrumbs('/design/workspaces/321ddb16-0ac7-4af4-b008-94afe2592ee3/memory', {
        workspaceLabel: 'Release Automation',
      }),
    ).toEqual([
      { label: 'Work Design' },
      { label: 'Workspaces', href: '/design/workspaces' },
      {
        label: 'Release Automation',
        href: '/design/workspaces/321ddb16-0ac7-4af4-b008-94afe2592ee3',
      },
      { label: 'Memory' },
    ]);
  });

  it('uses workspace labels from history state when the current route already knows the name', () => {
    stubBreadcrumbWindow({
      usr: {
        workspaceLabel: 'Release Automation',
      },
    });

    expect(buildBreadcrumbs('/design/workspaces/321ddb16-0ac7-4af4-b008-94afe2592ee3')).toEqual([
      { label: 'Work Design' },
      { label: 'Workspaces', href: '/design/workspaces' },
      { label: 'Release Automation' },
    ]);
  });

  it('uses cached workspace labels for direct workspace loads when history state is empty', () => {
    stubBreadcrumbWindow(null, {
      'agirunner.workspaceLabel.321ddb16-0ac7-4af4-b008-94afe2592ee3': 'Release Automation',
    });

    expect(
      buildBreadcrumbs('/design/workspaces/321ddb16-0ac7-4af4-b008-94afe2592ee3/artifacts'),
    ).toEqual([
      { label: 'Work Design' },
      { label: 'Workspaces', href: '/design/workspaces' },
      {
        label: 'Release Automation',
        href: '/design/workspaces/321ddb16-0ac7-4af4-b008-94afe2592ee3',
      },
      { label: 'Artifacts' },
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

  it('keeps Mission Control as a single primary nav item instead of separate live board, workflows, tasks, and action queue links', () => {
    const source = readLayoutSource();
    expect(source).toContain("label: 'Mission Control'");
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
    expect(source).toContain('aria-expanded={searchOpen}');
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
    expect(source).toContain('readDesktopSidebarCollapsedState(localStorage, session?.tenantId ?? null)');
    expect(source).toContain('localStorage.setItem(desktopSidebarStorageKey, nextCollapsed ? \'true\' : \'false\')');
    expect(source).toContain('Desktop navigation');
    expect(source).toContain('Expand sidebar');
    expect(source).toContain('Collapse sidebar');
    expect(source).toContain('title={item.label}');
    expect(source).toContain('aria-label={item.label}');
    expect(source).toContain("isMobile ? 'w-64' : isDesktopSidebarCollapsed ? 'w-20' : 'w-64'");
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

function stubBreadcrumbWindow(
  historyState: unknown,
  storageEntries: Record<string, string> = {},
): void {
  const storage = createStorage(storageEntries);
  vi.stubGlobal('window', {
    history: { state: historyState },
    sessionStorage: storage,
    localStorage: storage,
  });
}

function createStorage(entries: Record<string, string>) {
  return {
    getItem(key: string) {
      return entries[key] ?? null;
    },
    setItem(key: string, value: string) {
      entries[key] = value;
    },
    removeItem(key: string) {
      delete entries[key];
    },
  };
}
