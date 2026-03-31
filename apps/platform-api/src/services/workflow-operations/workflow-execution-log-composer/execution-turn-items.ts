import type { LogRow } from '../../../logging/log-service.js';
import type { WorkflowLiveConsoleItem } from '../workflow-operations-types.js';

import { buildExecutionTurnItem } from './execution-rendering.js';
import {
  coalesceExecutionTurnItem,
  shouldCoalesceAdjacentExecutionItem,
  shouldSuppressAdjacentExecutionItem,
} from './execution-postprocess.js';
import { hydrateLLMPhaseRows, collectPreferredLLMPhaseKeys } from './llm-phase.js';
import {
  buildExecutionPhaseKey,
  readAgentLoopPhaseForRuntimePreference,
  readMirroredAgentPhase,
  readRuntimeLoopPhase,
} from './phase-keys.js';
import { asRecord, compareLogRowsByCreatedAt } from './shared.js';

const LIVE_CONSOLE_AGENT_LOOP_OPERATIONS = new Set([
  'agent.think',
  'agent.plan',
  'agent.act',
  'agent.observe',
  'agent.verify',
  'runtime.loop.think',
  'runtime.loop.plan',
  'runtime.loop.observe',
  'runtime.loop.verify',
  'llm.chat_stream',
]);

export function buildExecutionTurnItems(rows: LogRow[]): WorkflowLiveConsoleItem[] {
  const orderedRows = [...rows].sort(compareLogRowsByCreatedAt);
  const hydratedRows = hydrateLLMPhaseRows(orderedRows);
  const preferredLLMPhaseKeys = collectPreferredLLMPhaseKeys(hydratedRows);
  const preferredRuntimeLoopKeys = collectPreferredRuntimeLoopKeys(hydratedRows);
  const items: WorkflowLiveConsoleItem[] = [];

  for (const row of hydratedRows) {
    if (!LIVE_CONSOLE_AGENT_LOOP_OPERATIONS.has(row.operation)) {
      continue;
    }
    if (shouldPreferLLMPhaseRow(row, preferredLLMPhaseKeys)) {
      continue;
    }
    if (shouldPreferRuntimeLoopRow(row, preferredRuntimeLoopKeys)) {
      continue;
    }

    const item = buildExecutionTurnItem(row);
    if (!item) {
      continue;
    }

    const previousItem = items.at(-1);
    if (shouldSuppressAdjacentExecutionItem(previousItem, item)) {
      continue;
    }
    if (shouldCoalesceAdjacentExecutionItem(previousItem, item)) {
      coalesceExecutionTurnItem(previousItem!, item);
      continue;
    }
    items.push(item);
  }

  return items;
}

function shouldPreferLLMPhaseRow(row: LogRow, preferredLLMPhaseKeys: Set<string>): boolean {
  const phase = readMirroredAgentPhase(row.operation);
  if (!phase) {
    return false;
  }
  const key = buildExecutionPhaseKey(row, phase, asRecord(row.payload));
  return key !== null && preferredLLMPhaseKeys.has(key);
}

function collectPreferredRuntimeLoopKeys(rows: LogRow[]): Set<string> {
  const keys = new Set<string>();
  for (const row of rows) {
    const phase = readRuntimeLoopPhase(row.operation);
    if (!phase) {
      continue;
    }
    const key = buildExecutionPhaseKey(row, phase, asRecord(row.payload));
    if (key) {
      keys.add(key);
    }
  }
  return keys;
}

function shouldPreferRuntimeLoopRow(row: LogRow, preferredRuntimeLoopKeys: Set<string>): boolean {
  const phase = readAgentLoopPhaseForRuntimePreference(row.operation);
  if (!phase) {
    return false;
  }
  const key = buildExecutionPhaseKey(row, phase, asRecord(row.payload));
  return key !== null && preferredRuntimeLoopKeys.has(key);
}
