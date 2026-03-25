import { describe, expect, it } from 'vitest';

import { DASHBOARD_BADGE_TOKENS } from './dashboard-badge-palette.js';

describe('dashboard badge palette', () => {
  it('pins the approved semantic preview ids', () => {
    expect(DASHBOARD_BADGE_TOKENS.error.id).toEqual({ light: 'B400', dark: 'B400' });
    expect(DASHBOARD_BADGE_TOKENS.warning.id).toEqual({ light: 'B231', dark: 'B231' });
    expect(DASHBOARD_BADGE_TOKENS.informationPrimary.id).toEqual({
      light: 'B433',
      dark: 'B239',
    });
    expect(DASHBOARD_BADGE_TOKENS.informationNeutral.id).toEqual({
      light: 'B230',
      dark: 'B230',
    });
    expect(DASHBOARD_BADGE_TOKENS.informationSecondary.id).toEqual({
      light: 'B438',
      dark: 'B437',
    });
    expect(DASHBOARD_BADGE_TOKENS.success.id).toEqual({ light: 'B237', dark: 'B237' });
  });

  it('keeps the selected semantic classes filled in both themes', () => {
    expect(DASHBOARD_BADGE_TOKENS.warning.className).toContain('bg-slate-700');
    expect(DASHBOARD_BADGE_TOKENS.warning.className).toContain('dark:bg-amber-300');
    expect(DASHBOARD_BADGE_TOKENS.informationPrimary.className).toContain('bg-sky-600');
    expect(DASHBOARD_BADGE_TOKENS.informationPrimary.className).toContain('dark:bg-sky-400');
    expect(DASHBOARD_BADGE_TOKENS.success.className).toContain('dark:bg-green-400');
  });
});
