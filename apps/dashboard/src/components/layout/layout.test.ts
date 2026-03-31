import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  NAV_SECTIONS,
  buildBreadcrumbs,
  buildDesktopSidebarStorageKey,
  readDesktopSidebarCollapsedState,
} from './layout.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('layout breadcrumbs', () => {
  it('exposes the shipped primary nav graph and nothing else', () => {
    expect(
      NAV_SECTIONS.map((section) => ({
        label: section.label,
        hrefs: section.items.map((item) => item.href),
      })),
    ).toEqual([
      { label: 'Mission Control', hrefs: ['/workflows'] },
      {
        label: 'Work Design',
        hrefs: [
          '/design/playbooks',
          '/design/workspaces',
          '/design/specialists',
          '/design/specialists/skills',
        ],
      },
      {
        label: 'Platform',
        hrefs: [
          '/platform/models',
          '/platform/instructions',
          '/platform/orchestrator',
          '/platform/environments',
          '/platform/tools',
        ],
      },
      {
        label: 'Integrations',
        hrefs: ['/integrations/mcp-servers', '/integrations/triggers', '/integrations/webhooks'],
      },
      {
        label: 'Diagnostics',
        hrefs: ['/diagnostics/live-logs', '/diagnostics/live-containers'],
      },
      {
        label: 'Admin',
        hrefs: [
          '/admin/api-keys',
          '/admin/general-settings',
          '/admin/agentic-settings',
          '/admin/platform-settings',
        ],
      },
    ]);
  });

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
