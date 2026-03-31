import { parsePlaybookDefinition } from '../../orchestration/playbook-model.js';
import { sanitizeSecretLikeRecord, sanitizeSecretLikeValue } from '../secret-redaction.js';
import type { WorkflowWorkItemSummary } from '../workflow-service.types.js';

export function normalizeWorkflowReadModel(
  workflow: Record<string, unknown>,
  detailSummary?: WorkflowWorkItemSummary,
): Record<string, unknown> {
  const orderedSummary = normalizeWorkflowWorkItemSummary(
    detailSummary ?? asRecord(workflow.work_item_summary),
    workflow.playbook_definition,
  );
  if (workflow.lifecycle !== 'ongoing') {
    const { playbook_definition: _playbookDefinition, ...rest } = workflow;
    return {
      ...rest,
      ...(orderedSummary ? { work_item_summary: orderedSummary } : {}),
    };
  }

  const { current_stage: _currentStage, playbook_definition: _playbookDefinition, ...rest } = workflow;
  return {
    ...rest,
    ...(orderedSummary ? { work_item_summary: orderedSummary } : {}),
    active_stages: orderedSummary?.active_stage_names ?? [],
  };
}

export function sanitizeWorkflowReadModel(workflow: Record<string, unknown>) {
  return {
    ...workflow,
    metadata: sanitizeWorkflowMetadata(workflow.metadata),
    context: sanitizeWorkflowContext(workflow.context),
    parameters: sanitizeWorkflowParameters(workflow.parameters),
    resolved_config: sanitizeWorkflowConfigView(workflow.resolved_config),
    config_layers: sanitizeWorkflowConfigLayers(workflow.config_layers),
  };
}

export function sanitizeTaskReadModel(task: Record<string, unknown>) {
  return {
    ...task,
    input: sanitizeTaskPayload(task.input),
    context: sanitizeTaskPayload(task.context),
    output: sanitizeTaskPayload(task.output),
    error: sanitizeTaskPayload(task.error),
    role_config: sanitizeTaskPayload(task.role_config),
    environment: sanitizeTaskPayload(task.environment),
    resource_bindings: sanitizeTaskPayload(task.resource_bindings),
    metrics: sanitizeTaskPayload(task.metrics),
    git_info: sanitizeTaskPayload(task.git_info),
    metadata: sanitizeTaskPayload(task.metadata),
  };
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function readWorkflowIdArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    : [];
}

export function readCount(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function sanitizeWorkflowMetadata(value: unknown) {
  return sanitizeSecretLikeRecord(value, {
    redactionValue: 'redacted://workflow-metadata-secret',
    allowSecretReferences: false,
  });
}

function sanitizeWorkflowContext(value: unknown) {
  return sanitizeSecretLikeRecord(value, {
    redactionValue: 'redacted://workflow-context-secret',
    allowSecretReferences: false,
  });
}

function sanitizeWorkflowParameters(value: unknown) {
  return sanitizeSecretLikeRecord(value, {
    redactionValue: 'redacted://workflow-parameters-secret',
    allowSecretReferences: false,
  });
}

function sanitizeWorkflowConfigView(value: unknown) {
  return sanitizeSecretLikeRecord(value, {
    redactionValue: 'redacted://workflow-config-secret',
    allowSecretReferences: false,
  });
}

function sanitizeWorkflowConfigLayers(value: unknown) {
  return sanitizeSecretLikeRecord(value, {
    redactionValue: 'redacted://workflow-config-secret',
    allowSecretReferences: false,
  });
}

function sanitizeTaskPayload(value: unknown) {
  return sanitizeSecretLikeValue(value, {
    redactionValue: 'redacted://task-secret',
    allowSecretReferences: false,
  });
}

function normalizeWorkflowWorkItemSummary(
  value: unknown,
  definition: unknown,
): WorkflowWorkItemSummary | null {
  const summary = asRecord(value);
  if (Object.keys(summary).length === 0) {
    return null;
  }
  const activeStageNames = orderStageNamesByDefinition(uniqueStageNames(summary.active_stage_names), definition);
  return {
    total_work_items: readCount(summary.total_work_items),
    open_work_item_count: readCount(summary.open_work_item_count),
    blocked_work_item_count: readCount(summary.blocked_work_item_count),
    completed_work_item_count: readCount(summary.completed_work_item_count),
    active_stage_count: activeStageNames.length,
    awaiting_gate_count: readCount(summary.awaiting_gate_count),
    active_stage_names: activeStageNames,
  };
}

function orderStageNamesByDefinition(stageNames: string[], definition: unknown): string[] {
  if (stageNames.length <= 1) {
    return stageNames;
  }
  const stageOrder = readPlaybookStageOrder(definition);
  if (stageOrder.length === 0) {
    return stageNames;
  }
  const remaining = new Set(stageNames);
  const ordered: string[] = [];

  for (const stageName of stageOrder) {
    if (!remaining.has(stageName)) {
      continue;
    }
    ordered.push(stageName);
    remaining.delete(stageName);
  }
  for (const stageName of stageNames) {
    if (!remaining.has(stageName)) {
      continue;
    }
    ordered.push(stageName);
    remaining.delete(stageName);
  }
  return ordered;
}

function readPlaybookStageOrder(definition: unknown): string[] {
  try {
    return parsePlaybookDefinition(definition).stages.map((stage) => stage.name);
  } catch {
    return [];
  }
}

function uniqueStageNames(values: unknown): string[] {
  const entries = Array.isArray(values) ? values : [];
  return Array.from(
    new Set(
      entries.filter((value): value is string => typeof value === 'string' && value.length > 0),
    ),
  );
}
