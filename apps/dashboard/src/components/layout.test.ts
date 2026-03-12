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

  it('wires keyboard-first command palette navigation and explicit search states', () => {
    const source = readFileSync(resolve(import.meta.dirname, './layout.tsx'), 'utf8');
    expect(source).toContain("event.key === 'ArrowDown'");
    expect(source).toContain("event.key === 'ArrowUp'");
    expect(source).toContain('dashboard-command-palette-results');
    expect(source).toContain('Search the workspace');
    expect(source).toContain('describeCommandPaletteState');
    expect(source).toContain('shouldRunCommandPaletteSearch');
  });
});
