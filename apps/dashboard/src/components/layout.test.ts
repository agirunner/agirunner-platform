import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildBreadcrumbs } from './layout.js';

function readLayoutSource() {
  return readFileSync(resolve(import.meta.dirname, './layout.tsx'), 'utf8');
}

function readDialogSource() {
  return readFileSync(resolve(import.meta.dirname, './ui/dialog.tsx'), 'utf8');
}

describe('layout breadcrumbs', () => {
  it('maps root path to Home breadcrumb', () => {
    expect(buildBreadcrumbs('/')).toEqual([{ label: 'Home' }]);
  });

  it('creates labeled breadcrumbs for sections', () => {
    expect(buildBreadcrumbs('/fleet/workers')).toEqual([
      { label: 'Fleet', href: '/fleet' },
      { label: 'Workers', href: undefined },
    ]);
  });

  it('handles nested paths with id segments', () => {
    const crumbs = buildBreadcrumbs('/work/boards/12345678-aaaa');
    expect(crumbs).toHaveLength(3);
    expect(crumbs[0]).toEqual({ label: 'Work', href: '/work' });
    expect(crumbs[1]).toEqual({ label: 'Workflow Boards', href: '/work/boards' });
    expect(crumbs[2].href).toBeUndefined();
  });

  it('capitalizes and de-hyphenates segment labels', () => {
    const crumbs = buildBreadcrumbs('/mission-control');
    expect(crumbs[0].label).toBe('Mission Control');
  });

  it('points configuration navigation at the trigger overview route', () => {
    const source = readLayoutSource();
    expect(source).toContain("label: 'Trigger Overview'");
    expect(source).toContain("href: '/config/triggers'");
  });

  it('exposes a single canonical runtime navigation entry', () => {
    const source = readLayoutSource();
    expect(source).toContain("label: 'Runtimes'");
    expect(source).not.toContain("label: 'Runtime Defaults'");
  });

  it('labels the roles page as Roles & Orchestrator for discoverability', () => {
    const source = readLayoutSource();
    expect(source).toContain("label: 'Roles & Orchestrator'");
    expect(source).toContain("href: '/config/roles'");
    expect(source).not.toContain("label: 'Role Definitions'");
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
