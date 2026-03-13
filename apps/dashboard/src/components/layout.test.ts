import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildBreadcrumbs } from './layout.js';

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
    const crumbs = buildBreadcrumbs('/work/workflows/12345678-aaaa');
    expect(crumbs).toHaveLength(3);
    expect(crumbs[0]).toEqual({ label: 'Work', href: '/work' });
    expect(crumbs[1]).toEqual({ label: 'Workflows', href: '/work/workflows' });
    expect(crumbs[2].href).toBeUndefined();
  });

  it('capitalizes and de-hyphenates segment labels', () => {
    const crumbs = buildBreadcrumbs('/mission-control');
    expect(crumbs[0].label).toBe('Mission Control');
  });

  it('points configuration navigation at the trigger overview route', () => {
    const source = readFileSync(resolve(import.meta.dirname, './layout.tsx'), 'utf8');
    expect(source).toContain("label: 'Trigger Overview'");
    expect(source).toContain("href: '/config/triggers'");
  });

  it('exposes a single canonical runtime navigation entry', () => {
    const source = readFileSync(resolve(import.meta.dirname, './layout.tsx'), 'utf8');
    expect(source).toContain("label: 'Runtimes'");
    expect(source).not.toContain("label: 'Runtime Defaults'");
  });

  it('labels the roles page as Roles & Orchestrator for discoverability', () => {
    const source = readFileSync(resolve(import.meta.dirname, './layout.tsx'), 'utf8');
    expect(source).toContain("label: 'Roles & Orchestrator'");
    expect(source).toContain("href: '/config/roles'");
    expect(source).not.toContain("label: 'Role Definitions'");
  });

  it('attaches orchestrator keywords to the roles nav item for command palette search', () => {
    const source = readFileSync(resolve(import.meta.dirname, './layout.tsx'), 'utf8');
    expect(source).toContain("keywords: ['orchestrator'");
    expect(source).toContain("'prompt'");
    expect(source).toContain("'model routing'");
    expect(source).toContain("'pool posture'");
    expect(source).toContain("'role definitions'");
  });

  it('passes nav item keywords through to command palette quick links', () => {
    const source = readFileSync(resolve(import.meta.dirname, './layout.tsx'), 'utf8');
    expect(source).toContain('item.keywords?.length');
    expect(source).toContain('keywords: item.keywords');
  });

  it('wires keyboard-first command palette navigation and explicit search states', () => {
    const source = readFileSync(resolve(import.meta.dirname, './layout.tsx'), 'utf8');
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
});
