import { describe, expect, it } from 'vitest';

import { readLogsSurfaceView } from './logs-page-view.js';

describe('logs page view', () => {
  it('defaults the generic logs route back to raw logs without an explicit selected entry', () => {
    expect(readLogsSurfaceView(new URLSearchParams())).toBe('raw');
    expect(readLogsSurfaceView(new URLSearchParams('view=summary'))).toBe('raw');
    expect(readLogsSurfaceView(new URLSearchParams('view=detailed'))).toBe('raw');
  });

  it('preserves explicit selected-log deep links into inspector tabs', () => {
    expect(readLogsSurfaceView(new URLSearchParams('view=detailed&log=44'))).toBe('detailed');
    expect(readLogsSurfaceView(new URLSearchParams('view=debug&log=44'))).toBe('debug');
  });
});
