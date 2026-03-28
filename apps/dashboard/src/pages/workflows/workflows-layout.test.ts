import { describe, expect, it } from 'vitest';

import {
  buildWorkflowWorkspaceSplitStyle,
  buildWorkflowsShellClassName,
  buildWorkflowsShellStyle,
  clampWorkflowRailWidthPx,
  clampWorkflowWorkbenchFraction,
} from './workflows-layout.js';

describe('buildWorkflowsShellClassName', () => {
  it('uses a single-column shell when the workflow rail is hidden', () => {
    expect(buildWorkflowsShellClassName(true)).toContain('lg:flex');
    expect(buildWorkflowsShellClassName(true)).toContain('lg:h-[calc(100vh-8.5rem)]');
    expect(buildWorkflowsShellClassName(true)).not.toContain('xl:grid-cols-[22rem_minmax(0,1fr)]');
  });

  it('uses the two-column shell when the workflow rail is visible', () => {
    expect(buildWorkflowsShellClassName(false)).toContain('lg:grid');
    expect(buildWorkflowsShellClassName(false)).toContain('lg:h-[calc(100vh-8.5rem)]');
    expect(buildWorkflowsShellClassName(false)).not.toContain('xl:grid-cols-[22rem_minmax(0,1fr)]');
  });

  it('builds a variable rail width style so the workflow rail can be resized without shrinking the workspace', () => {
    expect(buildWorkflowsShellStyle(false, 388)).toEqual({
      gridTemplateColumns: '388px 0.75rem minmax(0,1fr)',
    });
    expect(buildWorkflowsShellStyle(true, 388)).toEqual({});
  });

  it('clamps persisted shell dimensions to sane operator ranges', () => {
    expect(clampWorkflowRailWidthPx(120)).toBe(296);
    expect(clampWorkflowRailWidthPx(900)).toBe(440);
    expect(clampWorkflowWorkbenchFraction(0.1)).toBe(0.42);
    expect(clampWorkflowWorkbenchFraction(0.95)).toBe(0.58);
  });

  it('builds a stable board/workbench split that keeps the board large enough for stacked work-item cards', () => {
    expect(buildWorkflowWorkspaceSplitStyle(0.5)).toEqual({
      gridTemplateRows: 'minmax(24rem, 1fr) 0.5rem minmax(22rem, 1fr)',
    });
  });
});
