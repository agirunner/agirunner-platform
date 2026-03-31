export function readOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function readOptionalRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function readOptionalInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : null;
  }
  return null;
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => readOptionalString(entry))
    .filter((entry): entry is string => entry !== null);
}

export function ensureSentence(value: string): string {
  return /[.!?]$/.test(value) ? value : `${value}.`;
}

export function humanizeActionKind(actionKind: string): string {
  return actionKind
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function humanizeToken(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

export function humanizeGateStatus(value: string): string {
  return value.replaceAll('_', ' ');
}

export function isBlockedGateStatus(gateStatus: string | null): boolean {
  return gateStatus === 'blocked'
    || gateStatus === 'request_changes'
    || gateStatus === 'changes_requested'
    || gateStatus === 'rejected';
}

export function readRedriveLineage(
  workflow: Record<string, unknown>,
): Record<string, unknown> | null {
  const rootWorkflowId = readOptionalString(workflow.root_workflow_id);
  const previousAttemptWorkflowId = readOptionalString(workflow.previous_attempt_workflow_id);
  const attemptNumber = workflow.attempt_number;
  const attemptKind = readOptionalString(workflow.attempt_kind);
  if (!rootWorkflowId && !previousAttemptWorkflowId && attemptNumber == null && !attemptKind) {
    return null;
  }
  return {
    root_workflow_id: rootWorkflowId,
    previous_attempt_workflow_id: previousAttemptWorkflowId,
    attempt_number: attemptNumber ?? null,
    attempt_kind: attemptKind,
  };
}

export function readConciseRecordText(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = readOptionalString(record[key]);
    if (!value) {
      continue;
    }
    return value.length > 180 ? `${value.slice(0, 179)}…` : value;
  }
  return null;
}

export function buildTaskVerificationSummary(verification: Record<string, unknown>): string | null {
  const operatorSummary = readConciseRecordText(verification, ['summary', 'reason', 'details', 'assessment_prompt', 'message']);
  if (operatorSummary) {
    return operatorSummary;
  }
  if (typeof verification.passed === 'boolean') {
    return verification.passed ? 'Verification passed.' : 'Verification reported a failing check.';
  }
  const fieldCount = Object.keys(verification).length;
  if (fieldCount === 0) {
    return null;
  }
  return `${fieldCount} verification ${fieldCount === 1 ? 'field' : 'fields'} recorded.`;
}

export function summarizeConcerns(concerns: string[]): string | null {
  if (concerns.length === 0) {
    return null;
  }
  if (concerns.length === 1) {
    return concerns[0];
  }
  return `${concerns[0]} (+${concerns.length - 1} more)`;
}
