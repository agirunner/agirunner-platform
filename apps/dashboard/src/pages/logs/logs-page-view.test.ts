import { describe, expect, it } from 'vitest';

import { readLogsSurfaceView } from './logs-page-view.js';

describe('logs page view', () => {
  it('keeps operator-log tabs stable from the url alone and folds removed delivery links into summary', () => {
    expect(readLogsSurfaceView(new URLSearchParams())).toBe('raw');
    expect(readLogsSurfaceView(new URLSearchParams('view=summary'))).toBe('summary');
    expect(readLogsSurfaceView(new URLSearchParams('view=detailed&log=44'))).toBe('summary');
    expect(readLogsSurfaceView(new URLSearchParams('view=detailed'))).toBe('summary');
  });
});
