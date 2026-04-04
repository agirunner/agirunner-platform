import type { PlaybookRuleEvaluationResult } from '../playbook/playbook-rule-evaluation-service.js';
import type { WorkItemContinuityContextRow } from './types.js';

export function readCheckpointName(
  task: Record<string, unknown>,
  context: WorkItemContinuityContextRow,
) {
  return readOptionalString(task.stage_name) ?? context.stage_name ?? null;
}

export function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

export function readDecisionState(task: Record<string, unknown>) {
  const metadata = asRecord(task.metadata);
  const action = readOptionalString(metadata.assessment_action);
  if (action === 'request_changes') {
    return 'request_changes';
  }
  if (action === 'reject') {
    return 'rejected';
  }
  if (action === 'block') {
    return 'blocked';
  }
  return null;
}

export function normalizeStringList(values: string[] | undefined): string[] | undefined {
  if (!Array.isArray(values)) {
    return undefined;
  }
  const filtered = values
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value.length > 0);
  return filtered.length > 0 ? filtered : undefined;
}

export function readFinishStateContinuity(metadata: Record<string, unknown> | null | undefined) {
  const raw = compactRecord(asRecord(asRecord(metadata).orchestrator_finish_state));
  return compactRecord({
    status_summary: readOptionalString(raw.status_summary),
    next_expected_event: readOptionalString(raw.next_expected_event),
    blocked_on: normalizeStringList(raw.blocked_on as string[] | undefined),
    active_subordinate_tasks: normalizeStringList(raw.active_subordinate_tasks as string[] | undefined),
  });
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export function compactRecord<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

export function gateApprovalTakesPrecedence(
  definition: unknown,
  checkpointName: string | null,
  evaluation: PlaybookRuleEvaluationResult,
): PlaybookRuleEvaluationResult {
  if (!checkpointRequiresHumanApproval(definition, checkpointName)) {
    return evaluation;
  }
  return {
    matchedRuleType: 'approval',
    nextExpectedActor: 'human',
    nextExpectedAction: 'approve',
    requiresHumanApproval: true,
    reworkDelta: evaluation.reworkDelta,
  };
}

export function checkpointRequiresHumanApproval(
  definition: unknown,
  checkpointName: string | null,
) {
  void definition;
  void checkpointName;
  return false;
}
