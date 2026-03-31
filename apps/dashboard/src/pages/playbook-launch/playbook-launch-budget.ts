import type { DashboardWorkflowBudgetInput } from '../../lib/api.js';

export interface WorkflowBudgetDraft {
  tokenBudget: string;
  costCapUsd: string;
  maxDurationMinutes: string;
}

export type WorkflowBudgetMode = 'open-ended' | 'guarded';

export interface WorkflowBudgetFieldErrors {
  tokenBudget?: string;
  costCapUsd?: string;
  maxDurationMinutes?: string;
}

export function createWorkflowBudgetDraft(): WorkflowBudgetDraft {
  return {
    tokenBudget: '',
    costCapUsd: '',
    maxDurationMinutes: '',
  };
}

export function clearWorkflowBudgetDraft(): WorkflowBudgetDraft {
  return createWorkflowBudgetDraft();
}

export function readWorkflowBudgetMode(draft: WorkflowBudgetDraft): WorkflowBudgetMode {
  return hasWorkflowBudgetGuardrails(draft) ? 'guarded' : 'open-ended';
}

export function buildWorkflowBudgetInput(
  draft: WorkflowBudgetDraft,
): DashboardWorkflowBudgetInput | undefined {
  const tokenBudget = parsePositiveInteger(draft.tokenBudget, 'Token budget');
  const costCapUsd = parsePositiveNumber(draft.costCapUsd, 'Cost cap');
  const maxDurationMinutes = parsePositiveInteger(draft.maxDurationMinutes, 'Maximum duration');

  const value: DashboardWorkflowBudgetInput = {};
  if (tokenBudget !== undefined) {
    value.token_budget = tokenBudget;
  }
  if (costCapUsd !== undefined) {
    value.cost_cap_usd = costCapUsd;
  }
  if (maxDurationMinutes !== undefined) {
    value.max_duration_minutes = maxDurationMinutes;
  }
  return Object.keys(value).length > 0 ? value : undefined;
}

export function summarizeWorkflowBudgetDraft(draft: WorkflowBudgetDraft): string {
  const parts: string[] = [];
  if (draft.tokenBudget.trim()) {
    parts.push(`${draft.tokenBudget.trim()} tokens`);
  }
  if (draft.costCapUsd.trim()) {
    parts.push(`$${draft.costCapUsd.trim()} cost cap`);
  }
  if (draft.maxDurationMinutes.trim()) {
    parts.push(`${draft.maxDurationMinutes.trim()} minutes`);
  }
  return parts.length > 0
    ? `Workflow guardrails set for ${parts.join(', ')}.`
    : 'No explicit budget guardrails; the workflow will use open-ended defaults.';
}

export function validateWorkflowBudgetDraft(
  draft: WorkflowBudgetDraft,
): WorkflowBudgetFieldErrors {
  return {
    tokenBudget: readBudgetFieldError(draft.tokenBudget, 'Token budget', parsePositiveInteger),
    costCapUsd: readBudgetFieldError(draft.costCapUsd, 'Cost cap', parsePositiveNumber),
    maxDurationMinutes: readBudgetFieldError(
      draft.maxDurationMinutes,
      'Maximum duration',
      parsePositiveInteger,
    ),
  };
}

function parsePositiveInteger(value: string, label: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive whole number.`);
  }
  return parsed;
}

function parsePositiveNumber(value: string, label: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be greater than zero.`);
  }
  return parsed;
}

function hasWorkflowBudgetGuardrails(draft: WorkflowBudgetDraft): boolean {
  return (
    draft.tokenBudget.trim().length > 0 ||
    draft.costCapUsd.trim().length > 0 ||
    draft.maxDurationMinutes.trim().length > 0
  );
}

function readBudgetFieldError(
  value: string,
  label: string,
  parser: (raw: string, fieldLabel: string) => number | undefined,
): string | undefined {
  try {
    parser(value, label);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : `${label} is invalid.`;
  }
}
