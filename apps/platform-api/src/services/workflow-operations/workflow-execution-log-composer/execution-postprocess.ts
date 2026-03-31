import type { WorkflowLiveConsoleItem } from '../workflow-operations-types.js';

import { normalizeExecutionComparisonText, readOperatorReadableText } from './console-text.js';
import { dedupeIds, humanizeToken, readString } from './shared.js';

const EXECUTION_BURST_WINDOW_MS = 15_000;

export function shouldSuppressAdjacentExecutionItem(
  previousItem: WorkflowLiveConsoleItem | undefined,
  currentItem: WorkflowLiveConsoleItem,
): boolean {
  if (!previousItem) {
    return false;
  }
  const previousSummary = normalizeExecutionComparisonText(previousItem.summary);
  const currentSummary = normalizeExecutionComparisonText(currentItem.summary);
  if (!previousSummary || !currentSummary || previousSummary !== currentSummary) {
    return false;
  }
  if (!hasMatchingExecutionContext(previousItem, currentItem)) {
    return false;
  }

  const previousPhase = readExecutionItemPhase(previousItem);
  const currentPhase = readExecutionItemPhase(currentItem);
  if (!previousPhase || !currentPhase) {
    return false;
  }
  return previousPhase === currentPhase || previousPhase === 'Verify' || currentPhase === 'Verify';
}

export function shouldCoalesceAdjacentExecutionItem(
  previousItem: WorkflowLiveConsoleItem | undefined,
  currentItem: WorkflowLiveConsoleItem,
): boolean {
  if (!previousItem || !hasMatchingExecutionContext(previousItem, currentItem)) {
    return false;
  }

  const previousPhase = readExecutionItemPhase(previousItem);
  const currentPhase = readExecutionItemPhase(currentItem);
  if (!previousPhase || previousPhase !== currentPhase || previousPhase === 'Act') {
    return false;
  }
  if (!occurredWithinBurstWindow(previousItem.created_at, currentItem.created_at)) {
    return false;
  }

  const previousSummary = normalizeExecutionComparisonText(previousItem.summary);
  const currentSummary = normalizeExecutionComparisonText(currentItem.summary);
  if (!previousSummary || !currentSummary || previousSummary === currentSummary) {
    return false;
  }

  return mergeExecutionTurnText(previousItem.summary, currentItem.summary) !== null;
}

export function coalesceExecutionTurnItem(
  previousItem: WorkflowLiveConsoleItem,
  currentItem: WorkflowLiveConsoleItem,
): void {
  const phase = readExecutionItemPhase(previousItem);
  const mergedText = mergeExecutionTurnText(previousItem.summary, currentItem.summary);
  if (!phase || !mergedText) {
    return;
  }

  previousItem.summary = mergedText;
  previousItem.headline = formatExecutionPhaseLabelHeadline(phase, mergedText);
  previousItem.created_at = currentItem.created_at;
  previousItem.linked_target_ids = dedupeIds([
    ...previousItem.linked_target_ids,
    ...currentItem.linked_target_ids,
  ]);
}

export function formatExecutionPhaseHeadline(operation: string, headline: string): string {
  return `[${readPhaseLabel(operation)}] ${headline}`;
}

export function formatExecutionPhaseLabelHeadline(phase: string, headline: string): string {
  return `[${phase}] ${headline}`;
}

function hasMatchingExecutionContext(
  previousItem: WorkflowLiveConsoleItem,
  currentItem: WorkflowLiveConsoleItem,
): boolean {
  return (
    previousItem.source_kind === currentItem.source_kind
    && previousItem.source_label === currentItem.source_label
    && previousItem.scope_binding === currentItem.scope_binding
    && previousItem.work_item_id === currentItem.work_item_id
    && previousItem.task_id === currentItem.task_id
  );
}

function occurredWithinBurstWindow(previousTimestamp: string, currentTimestamp: string): boolean {
  const previousTime = Date.parse(previousTimestamp);
  const currentTime = Date.parse(currentTimestamp);
  return Number.isFinite(previousTime)
    && Number.isFinite(currentTime)
    && currentTime >= previousTime
    && currentTime - previousTime <= EXECUTION_BURST_WINDOW_MS;
}

function mergeExecutionTurnText(previousSummary: string, currentSummary: string): string | null {
  const previousText = normalizeExecutionComparisonText(previousSummary);
  const currentText = normalizeExecutionComparisonText(currentSummary);
  if (!previousText || !currentText || previousText === currentText) {
    return null;
  }
  const mergedText = readOperatorReadableText(`${previousText} ${currentText}`, 180);
  return mergedText && mergedText !== previousText ? mergedText : null;
}

function readExecutionItemPhase(item: WorkflowLiveConsoleItem): string | null {
  return readString(item.headline.match(/^\[([^\]]+)\]\s+/)?.[1] ?? null);
}

function readPhaseLabel(operation: string): string {
  switch (operation) {
    case 'agent.think':
    case 'runtime.loop.think':
      return 'Think';
    case 'agent.plan':
    case 'runtime.loop.plan':
      return 'Plan';
    case 'agent.act':
      return 'Act';
    case 'agent.observe':
    case 'runtime.loop.observe':
      return 'Observe';
    case 'agent.verify':
    case 'runtime.loop.verify':
      return 'Verify';
    default:
      return humanizeToken(operation);
  }
}
