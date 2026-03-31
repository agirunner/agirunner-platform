import type { LogRow } from '../../../logging/log-service.js';

import { readOptionalNumber, readString } from './shared.js';

export function readMirroredAgentPhase(
  operation: string,
): 'think' | 'plan' | 'act' | 'verify' | null {
  switch (operation) {
    case 'agent.think':
      return 'think';
    case 'agent.plan':
      return 'plan';
    case 'agent.act':
      return 'act';
    case 'agent.verify':
      return 'verify';
    default:
      return null;
  }
}

export function readRuntimeLoopPhase(
  operation: string,
): 'think' | 'plan' | 'observe' | 'verify' | null {
  switch (operation) {
    case 'runtime.loop.think':
      return 'think';
    case 'runtime.loop.plan':
      return 'plan';
    case 'runtime.loop.observe':
      return 'observe';
    case 'runtime.loop.verify':
      return 'verify';
    default:
      return null;
  }
}

export function readAgentLoopPhaseForRuntimePreference(
  operation: string,
): 'think' | 'plan' | 'observe' | 'verify' | null {
  switch (operation) {
    case 'agent.think':
      return 'think';
    case 'agent.plan':
      return 'plan';
    case 'agent.observe':
      return 'observe';
    case 'agent.verify':
      return 'verify';
    default:
      return null;
  }
}

export function buildExecutionPhaseKey(
  row: LogRow,
  phase: 'think' | 'plan' | 'act' | 'observe' | 'verify',
  payload: Record<string, unknown>,
): string | null {
  const turnOrdinal = readExecutionTurnOrdinal(payload);
  if (!turnOrdinal) {
    return null;
  }
  return [
    row.activation_id ?? '',
    readString(row.role) ?? '',
    phase,
    turnOrdinal,
    row.task_id ?? '',
    row.work_item_id ?? '',
  ].join(':');
}

export function buildLLMResponseCompanionKey(
  row: LogRow,
  payload: Record<string, unknown>,
): string | null {
  const turnOrdinal = readExecutionTurnOrdinal(payload);
  if (!turnOrdinal) {
    return null;
  }
  return [
    row.activation_id ?? '',
    readString(row.role) ?? '',
    turnOrdinal,
    row.task_id ?? '',
    row.work_item_id ?? '',
  ].join(':');
}

export function readExecutionTurnOrdinal(payload: Record<string, unknown>): string | null {
  const llmTurnCount = readOptionalNumber(payload.llm_turn_count);
  if (llmTurnCount !== null) {
    return `turn:${llmTurnCount}`;
  }
  const burstId = readOptionalNumber(payload.burst_id);
  if (burstId !== null) {
    return `burst:${burstId}`;
  }
  return null;
}
