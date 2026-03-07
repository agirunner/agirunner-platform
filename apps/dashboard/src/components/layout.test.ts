import { describe, expect, it } from 'vitest';

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
});
