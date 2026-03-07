import { describe, expect, it } from 'vitest';

import { buildBreadcrumbs } from './layout.js';

describe('layout breadcrumbs', () => {
  it('maps root path to workflows breadcrumb', () => {
    expect(buildBreadcrumbs('/')).toEqual([{ label: 'Workflows', href: '/workflows' }]);
  });

  it('creates labeled breadcrumbs for known sections', () => {
    expect(buildBreadcrumbs('/workers')).toEqual([{ label: 'Workers', href: undefined }]);
    expect(buildBreadcrumbs('/activity')).toEqual([{ label: 'Activity Feed', href: undefined }]);
    expect(buildBreadcrumbs('/templates')).toEqual([{ label: 'Templates', href: undefined }]);
    expect(buildBreadcrumbs('/runtime-customization')).toEqual([
      { label: 'Runtime Customization', href: undefined },
    ]);
  });

  it('truncates id segments and keeps parent links navigable', () => {
    const crumbs = buildBreadcrumbs('/workflows/12345678-aaaa-bbbb-cccc-0123456789ab');
    expect(crumbs[0]).toEqual({ label: 'Workflows', href: '/workflows' });
    expect(crumbs[1].label).toBe('12345678…');
    expect(crumbs[1].href).toBeUndefined();
  });
});
