import type { CSSProperties } from 'react';

export const DEFAULT_WORKFLOW_RAIL_WIDTH_PX = 360;
export const MIN_WORKFLOW_RAIL_WIDTH_PX = 280;
export const MAX_WORKFLOW_RAIL_WIDTH_PX = 520;
export const DEFAULT_WORKFLOW_WORKBENCH_FRACTION = 0.5;
export const MIN_WORKFLOW_WORKBENCH_FRACTION = 0.35;
export const MAX_WORKFLOW_WORKBENCH_FRACTION = 0.7;
const WORKFLOW_SPLIT_GUTTER_REM = 0.5;
const WORKFLOW_BOARD_MIN_HEIGHT_REM = 16;
const WORKFLOW_WORKBENCH_MIN_HEIGHT_REM = 18;

export function buildWorkflowsShellClassName(isRailHidden: boolean): string {
  const baseClassName = 'flex w-full min-w-0 flex-col gap-3 lg:h-[calc(100vh-8.5rem)] lg:min-h-0 lg:overflow-hidden';
  if (isRailHidden) {
    return `${baseClassName} lg:flex`;
  }
  return `${baseClassName} lg:grid`;
}

export function buildWorkflowsShellStyle(
  isRailHidden: boolean,
  railWidthPx: number,
): CSSProperties {
  if (isRailHidden) {
    return {};
  }
  return {
    gridTemplateColumns: `${clampWorkflowRailWidthPx(railWidthPx)}px 0.75rem minmax(0,1fr)`,
  };
}

export function buildWorkflowWorkspaceSplitStyle(
  workbenchFraction: number,
): CSSProperties {
  const clampedFraction = clampWorkflowWorkbenchFraction(workbenchFraction);
  const boardWeight = trimGridWeight(1 - clampedFraction);
  const footerWeight = trimGridWeight(clampedFraction);
  return {
    gridTemplateRows:
      `minmax(${WORKFLOW_BOARD_MIN_HEIGHT_REM}rem, ${boardWeight}fr) ${WORKFLOW_SPLIT_GUTTER_REM}rem minmax(${WORKFLOW_WORKBENCH_MIN_HEIGHT_REM}rem, ${footerWeight}fr)`,
  };
}

export function clampWorkflowRailWidthPx(widthPx: number): number {
  if (!Number.isFinite(widthPx)) {
    return DEFAULT_WORKFLOW_RAIL_WIDTH_PX;
  }
  return Math.min(MAX_WORKFLOW_RAIL_WIDTH_PX, Math.max(MIN_WORKFLOW_RAIL_WIDTH_PX, Math.round(widthPx)));
}

export function clampWorkflowWorkbenchFraction(fraction: number): number {
  if (!Number.isFinite(fraction)) {
    return DEFAULT_WORKFLOW_WORKBENCH_FRACTION;
  }
  return Math.min(MAX_WORKFLOW_WORKBENCH_FRACTION, Math.max(MIN_WORKFLOW_WORKBENCH_FRACTION, fraction));
}

function trimGridWeight(value: number): string {
  return Number((value / DEFAULT_WORKFLOW_WORKBENCH_FRACTION).toFixed(3)).toString();
}
