import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildBreadcrumbs } from './layout.js';

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
  it('maps root path to Home breadcrumb', () => {
    expect(buildBreadcrumbs('/')).toEqual([{ label: 'Home' }]);
  });

  it('creates labeled breadcrumbs for sections', () => {
    expect(buildBreadcrumbs('/config/orchestrator')).toEqual([
      { label: 'Config' },
      { label: 'Orchestrator' },
    ]);
  });

  it('handles nested paths with id segments', () => {
    const crumbs = buildBreadcrumbs('/work/boards/12345678-aaaa');
    expect(crumbs).toHaveLength(3);
    expect(crumbs[0]).toEqual({ label: 'Work' });
    expect(crumbs[1]).toEqual({ label: 'Workflow Boards', href: '/work/boards' });
    expect(crumbs[2].href).toBeUndefined();
  });

  it('capitalizes and de-hyphenates segment labels', () => {
    const crumbs = buildBreadcrumbs('/mission-control');
    expect(crumbs[0].label).toBe('Mission Control');
  });

  it('points integrations navigation at the triggers route', () => {
    const source = readLayoutSource();
    expect(source).toContain("label: 'Triggers'");
    expect(source).toContain("href: '/config/triggers'");
  });

  it('keeps fleet navigation for runtimes and live containers only', () => {
    const source = readLayoutSource();
    expect(source).toContain("label: 'Fleet'");
    expect(source).toContain("label: 'Runtimes'");
    expect(source).toContain("href: '/config/runtimes'");
    expect(source).toContain("label: 'Containers'");
    expect(source).toContain("href: '/fleet/containers'");
    expect(source).not.toContain("label: 'Runtime Defaults'");
    expect(source).not.toContain("href: '/fleet/workers'");
    expect(source).not.toContain("href: '/fleet/warm-pools'");
    expect(source).not.toContain("href: '/fleet/status'");
  });

  it('has separate Orchestrator and Roles nav entries', () => {
    const source = readLayoutSource();
    expect(source).toContain("label: 'Orchestrator'");
    expect(source).toContain("href: '/config/orchestrator'");
    expect(source).toContain("label: 'Roles'");
    expect(source).toContain("href: '/config/roles'");
  });

  it('keeps user management out of the primary governance navigation', () => {
    const source = readLayoutSource();
    expect(source).toContain("label: 'API Keys'");
    expect(source).not.toContain("label: 'User Management'");
  });

  it('removes orchestrator grants from governance navigation and breadcrumbs', () => {
    const source = readLayoutSource();
    expect(source).not.toContain("label: 'Orchestrator Grants'");
    expect(source).not.toContain("href: '/governance/grants'");
    expect(buildBreadcrumbs('/governance/grants')).toEqual([
      { label: 'Governance' },
      { label: 'Grants' },
    ]);
  });

  it('labels the deprecated users route truthfully in breadcrumbs', () => {
    expect(buildBreadcrumbs('/governance/users')).toEqual([
      { label: 'Governance' },
      { label: 'Legacy User Access' },
    ]);
  });

  it('keeps workspace scoped explorer breadcrumbs clickable without exposing raw UUID labels', () => {
    expect(
      buildBreadcrumbs(
        '/workspaces/321ddb16-0ac7-4af4-b008-94afe2592ee3/memory',
        { workspaceLabel: 'Release Automation' },
      ),
    ).toEqual([
      { label: 'Workspaces', href: '/workspaces' },
      { label: 'Release Automation', href: '/workspaces/321ddb16-0ac7-4af4-b008-94afe2592ee3' },
      { label: 'Memory' },
    ]);
  });

  it('uses workspace labels from history state when the current route already knows the name', () => {
    stubBreadcrumbWindow({
      usr: {
        workspaceLabel: 'Release Automation',
      },
    });

    expect(buildBreadcrumbs('/workspaces/321ddb16-0ac7-4af4-b008-94afe2592ee3')).toEqual([
      { label: 'Workspaces', href: '/workspaces' },
      { label: 'Release Automation' },
    ]);
  });

  it('uses cached workspace labels for direct workspace loads when history state is empty', () => {
    stubBreadcrumbWindow(
      null,
      {
        'agirunner.workspaceLabel.321ddb16-0ac7-4af4-b008-94afe2592ee3': 'Release Automation',
      },
    );

    expect(buildBreadcrumbs('/workspaces/321ddb16-0ac7-4af4-b008-94afe2592ee3/artifacts')).toEqual([
      { label: 'Workspaces', href: '/workspaces' },
      { label: 'Release Automation', href: '/workspaces/321ddb16-0ac7-4af4-b008-94afe2592ee3' },
      { label: 'Artifacts' },
    ]);
  });

  it('attaches orchestrator keywords to the roles nav item for command palette search', () => {
    const source = readLayoutSource();
    expect(source).toContain("keywords: ['orchestrator'");
    expect(source).toContain("'prompt'");
    expect(source).toContain("'model routing'");
    expect(source).toContain("'pool posture'");
    expect(source).toContain("'role definitions'");
  });

  it('passes nav item keywords through to command palette quick links', () => {
    const source = readLayoutSource();
    expect(source).toContain('item.keywords?.length');
    expect(source).toContain('keywords: item.keywords');
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
