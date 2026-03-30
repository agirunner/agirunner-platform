import type { CSSProperties } from 'react';

export const DEFAULT_WORKFLOW_RAIL_WIDTH_PX = 320;
export const MIN_WORKFLOW_RAIL_WIDTH_PX = 296;
export const MAX_WORKFLOW_RAIL_WIDTH_PX = 440;
export const DEFAULT_WORKFLOW_WORKBENCH_FRACTION = 0.44;
export const MIN_WORKFLOW_WORKBENCH_FRACTION = 0.42;
export const MAX_WORKFLOW_WORKBENCH_FRACTION = 0.58;
const WORKFLOW_SPLIT_GUTTER_REM = 0.5;
const WORKFLOW_SPLIT_BASELINE_FRACTION = 0.5;

export function buildWorkflowsShellClassName(isRailHidden: boolean): string {
  const baseClassName = [
    'flex',
    'flex-1',
    'w-full',
    'min-w-0',
    'h-full',
    'min-h-0',
    'flex-col',
    'gap-1.5',
    'lg:overflow-hidden',
  ].join(' ');
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
  const boardWeight = trimGridWeight((1 - clampedFraction) / WORKFLOW_SPLIT_BASELINE_FRACTION);
  const footerWeight = trimGridWeight(clampedFraction / WORKFLOW_SPLIT_BASELINE_FRACTION);
  return {
    '--workflow-board-track': `${boardWeight}fr`,
    '--workflow-workbench-track': `${footerWeight}fr`,
  } as CSSProperties;
}

export function buildWorkflowWorkspaceSplitClassName(): string {
  return [
    'flex',
    'flex-col',
    'min-h-0',
    'min-w-0',
    'gap-3',
    'lg:grid',
    'lg:h-full',
    'lg:gap-0',
    'lg:items-stretch',
    'lg:overflow-hidden',
    `lg:grid-rows-[minmax(0,var(--workflow-board-track))_${WORKFLOW_SPLIT_GUTTER_REM}rem_minmax(0,var(--workflow-workbench-track))]`,
  ].join(' ');
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
  return Number(value.toFixed(3)).toString();
}
