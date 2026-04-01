import { parsePlaybookDefinition } from '../../orchestration/playbook-model.js';
import { sanitizeSecretLikeRecord, sanitizeSecretLikeValue } from '../secret-redaction.js';
import type { WorkflowWorkItemSummary } from './workflow-service.types.js';

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
    id: task.id ?? null,
    tenant_id: task.tenant_id ?? null,
    workflow_id: task.workflow_id ?? null,
    workspace_id: task.workspace_id ?? null,
    parent_id: task.parent_id ?? null,
    work_item_id: task.work_item_id ?? null,
    activation_id: task.activation_id ?? null,
    title: task.title ?? null,
    description: task.description ?? null,
    state: task.state ?? null,
    priority: task.priority ?? null,
    execution_backend: task.execution_backend ?? null,
    used_task_sandbox: task.used_task_sandbox ?? false,
    role: task.role ?? null,
    input: sanitizeTaskPayload(task.input),
    metadata: sanitizeTaskPayload(task.metadata),
    assigned_agent_id: task.assigned_agent_id ?? null,
    assigned_worker_id: task.assigned_worker_id ?? null,
    depends_on: Array.isArray(task.depends_on)
      ? task.depends_on.filter((value): value is string => typeof value === 'string' && value.length > 0)
      : [],
    timeout_minutes: task.timeout_minutes ?? null,
    auto_retry: task.auto_retry ?? false,
    max_retries: task.max_retries ?? 0,
    retry_count: task.retry_count ?? 0,
    claimed_at: task.claimed_at ?? null,
    started_at: task.started_at ?? null,
    completed_at: task.completed_at ?? null,
    failed_at: task.failed_at ?? null,
    cancelled_at: task.cancelled_at ?? null,
    created_at: task.created_at ?? null,
    updated_at: task.updated_at ?? null,
    stage_name: task.stage_name ?? null,
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
  }) as Record<string, unknown>;
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
