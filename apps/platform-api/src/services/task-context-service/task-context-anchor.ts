import { createHash } from 'node:crypto';

import type { DatabaseQueryable } from '../../db/database.js';
import {
  readPendingDispatches,
  selectFocusedWorkItem,
} from '../workflow-instruction-layer/orchestrator-context.js';
import { asOptionalNumber, asOptionalString, asRecord, readPositiveInteger } from './task-context-utils.js';
import { DEFAULT_ASSEMBLED_PROMPT_WARNING_THRESHOLD_CHARS } from './task-context-constants.js';

export interface TaskContextAnchor {
  source: 'task' | 'activation_event' | 'none';
  event_type: string | null;
  work_item_id: string | null;
  stage_name: string | null;
  triggering_task_id: string | null;
}

interface BuildOrchestratorExecutionBriefInput {
  workflow?: Record<string, unknown> | null;
  orchestratorContext?: Record<string, unknown> | null;
  workflowLiveVisibility?: Record<string, unknown> | null;
}

export function buildOrchestratorExecutionBrief(
  input: BuildOrchestratorExecutionBriefInput,
): Record<string, unknown> | null {
  const workflow = asRecord(input.workflow);
  const orchestratorContext = asRecord(input.orchestratorContext);
  const operatorVisibility = asRecord(input.workflowLiveVisibility);
  const currentFocus = buildOrchestratorCurrentFocus(workflow, orchestratorContext);
  if (!currentFocus && Object.keys(operatorVisibility).length === 0) {
    return null;
  }

  const brief = {
    refresh_key: hashCanonicalJson({
      current_focus: currentFocus,
      operator_visibility: operatorVisibility,
    }),
    current_focus: currentFocus,
    operator_visibility: Object.keys(operatorVisibility).length > 0 ? operatorVisibility : null,
    rendered_markdown: renderOrchestratorExecutionBrief(currentFocus, operatorVisibility),
  };
  return brief;
}

export function resolveTaskContextAnchor(task: Record<string, unknown>): TaskContextAnchor {
  const workItemId = asOptionalString(task.work_item_id) ?? null;
  const stageName = asOptionalString(task.stage_name) ?? null;
  if (workItemId) {
    return {
      source: 'task',
      event_type: null,
      work_item_id: workItemId,
      stage_name: stageName,
      triggering_task_id: null,
    };
  }

  const activationEvent = readActivationEventAnchor(asRecord(task.input));
  if (activationEvent) {
    return {
      source: 'activation_event',
      event_type: activationEvent.event_type,
      work_item_id: activationEvent.work_item_id,
      stage_name: activationEvent.stage_name,
      triggering_task_id: activationEvent.triggering_task_id,
    };
  }

  if (stageName) {
    return {
      source: 'task',
      event_type: null,
      work_item_id: null,
      stage_name: stageName,
      triggering_task_id: null,
    };
  }

  return {
    source: 'none',
    event_type: null,
    work_item_id: null,
    stage_name: null,
    triggering_task_id: null,
  };
}

export function applyTaskContextAnchor(
  task: Record<string, unknown>,
  contextAnchor: TaskContextAnchor,
): Record<string, unknown> {
  if (contextAnchor.source === 'none') {
    return task;
  }

  return {
    ...task,
    work_item_id: contextAnchor.work_item_id ?? task.work_item_id,
    stage_name: contextAnchor.stage_name ?? task.stage_name,
  };
}

export async function readTenantAssembledPromptWarningThreshold(
  db: DatabaseQueryable,
  tenantId: string,
): Promise<number> {
  const result = await db.query<{ assembled_prompt_warning_threshold_chars: number }>(
    `SELECT assembled_prompt_warning_threshold_chars
       FROM agentic_settings
      WHERE tenant_id = $1`,
    [tenantId],
  );
  return (
    readPositiveInteger(result.rows[0]?.assembled_prompt_warning_threshold_chars) ??
    DEFAULT_ASSEMBLED_PROMPT_WARNING_THRESHOLD_CHARS
  );
}

export function readLiveVisibilityMode(value: unknown): 'standard' | 'enhanced' | null {
  return value === 'standard' || value === 'enhanced' ? value : null;
}

export function resolveOperatorExecutionContextId(task: Record<string, unknown>): string | null {
  if (task.is_orchestrator_task === true) {
    return asOptionalString(task.activation_id) ?? asOptionalString(task.id) ?? null;
  }
  return asOptionalString(task.id) ?? null;
}

function readActivationEventAnchor(
  taskInput: Record<string, unknown>,
): Omit<TaskContextAnchor, 'source'> | null {
  const events = Array.isArray(taskInput.events) ? taskInput.events : [];
  for (const entry of events) {
    const event = asRecord(entry);
    const payload = asRecord(event.payload);
    const workItemId =
      asOptionalString(event.work_item_id) ?? asOptionalString(payload.work_item_id) ?? null;
    const stageName =
      asOptionalString(event.stage_name) ?? asOptionalString(payload.stage_name) ?? null;
    const triggeringTaskId =
      asOptionalString(event.task_id) ?? asOptionalString(payload.task_id) ?? null;
    const eventType = asOptionalString(event.type) ?? asOptionalString(event.event_type) ?? null;
    if (!workItemId && !stageName && !triggeringTaskId) {
      continue;
    }
    return {
      event_type: eventType,
      work_item_id: workItemId,
      stage_name: stageName,
      triggering_task_id: triggeringTaskId,
    };
  }
  return null;
}

function buildOrchestratorCurrentFocus(
  workflow: Record<string, unknown>,
  orchestratorContext: Record<string, unknown>,
): Record<string, unknown> | null {
  const lifecycle = workflow.lifecycle === 'ongoing' ? 'ongoing' : 'planned';
  const pendingDispatches = readPendingDispatches(orchestratorContext);
  const activeStageName = readCurrentStageName(workflow);
  if (pendingDispatches[0]) {
    const nextDispatch = pendingDispatches[0];
    return {
      lifecycle,
      work_item_id: nextDispatch.work_item_id,
      stage_name: nextDispatch.stage_name ?? activeStageName,
      next_expected_actor: nextDispatch.actor,
      next_expected_action: nextDispatch.action,
    };
  }

  const focusedWorkItem = asRecord(
    selectFocusedWorkItem(orchestratorContext, {
      workItemId: null,
      stageName: activeStageName,
    }),
  );
  const nextExpectedActor = asOptionalString(focusedWorkItem.next_expected_actor) ?? null;
  const nextExpectedAction = asOptionalString(focusedWorkItem.next_expected_action) ?? null;
  const boardPosition = asOptionalString(focusedWorkItem.column_id) ?? null;
  const focusedStageName = asOptionalString(focusedWorkItem.stage_name) ?? null;
  if (nextExpectedActor || nextExpectedAction || boardPosition || focusedStageName) {
    return {
      lifecycle,
      work_item_id: asOptionalString(focusedWorkItem.id) ?? null,
      stage_name: focusedStageName ?? activeStageName,
      board_position: boardPosition,
      next_expected_actor: nextExpectedActor,
      next_expected_action: nextExpectedAction,
    };
  }

  if (lifecycle === 'planned' && activeStageName) {
    return {
      lifecycle,
      stage_name: activeStageName,
      work_item_seed_required: true,
      next_expected_actor: 'orchestrator',
      next_expected_action: 'seed the first work item and starter specialist task for the current stage',
    };
  }

  if (!activeStageName) {
    return null;
  }
  return {
    lifecycle,
    stage_name: activeStageName,
  };
}

function readCurrentStageName(workflow: Record<string, unknown>): string | null {
  return (
    asOptionalString(workflow.current_stage) ??
    firstString(Array.isArray(workflow.active_stages) ? workflow.active_stages : [])
  );
}

function firstString(values: unknown[]): string | null {
  for (const value of values) {
    const candidate = asOptionalString(value);
    if (candidate) {
      return candidate;
    }
  }
  return null;
}

function renderOrchestratorExecutionBrief(
  currentFocus: Record<string, unknown> | null,
  operatorVisibility: Record<string, unknown>,
): string {
  const lines: string[] = ['## Current Focus'];
  if (currentFocus) {
    const lifecycle = asOptionalString(currentFocus.lifecycle);
    const stageName = asOptionalString(currentFocus.stage_name);
    const boardPosition = asOptionalString(currentFocus.board_position);
    const workItemId = asOptionalString(currentFocus.work_item_id);
    const workItemSeedRequired = currentFocus.work_item_seed_required === true;
    const nextExpectedActor = asOptionalString(currentFocus.next_expected_actor);
    const nextExpectedAction = asOptionalString(currentFocus.next_expected_action);
    if (lifecycle) lines.push(`Lifecycle: ${lifecycle}`);
    if (stageName) lines.push(`Stage: ${stageName}`);
    if (boardPosition) lines.push(`Board position: ${boardPosition}`);
    if (workItemId) lines.push(`Work item id: ${workItemId}`);
    if (nextExpectedActor) lines.push(`Next expected actor: ${nextExpectedActor}`);
    if (nextExpectedAction) lines.push(`Next expected action: ${nextExpectedAction}`);
    if (workItemSeedRequired) {
      lines.push(
        'No work item exists yet. Create the first work item and starter specialist task for this stage in the current activation.',
      );
      lines.push(
        'Planning text, thoughts, verify summaries, and failed attempts do not create work items or tasks.',
      );
      lines.push(
        'Treat create_work_item and create_task as done only after the corresponding tool call succeeds and returns the exact ids.',
      );
      lines.push(
        'Do not call list_workflow_tasks, read_work_item_continuity, or handoff-read tools until create_work_item succeeds and returns the exact work_item_id.',
      );
      lines.push(
        'Never invent work_item_id values from stage names or titles. Only use exact UUIDs returned by platform tools.',
      );
    }
  }

  if (Object.keys(operatorVisibility).length > 0) {
    lines.push('', '## Operator Visibility');
    const mode = asOptionalString(operatorVisibility.mode);
    const workflowId = asOptionalString(operatorVisibility.workflow_id);
    const executionContextId = asOptionalString(operatorVisibility.execution_context_id);
    const sourceKind = asOptionalString(operatorVisibility.source_kind);
    if (mode) lines.push(`Live visibility mode: ${mode}`);
    if (workflowId) lines.push(`Workflow id: ${workflowId}`);
    if (executionContextId) lines.push(`Execution context id: ${executionContextId}`);
    if (sourceKind) lines.push(`Source kind: ${sourceKind}`);
  }

  return lines.join('\n').trim();
}

function hashCanonicalJson(value: unknown): string {
  const payload = JSON.stringify(value);
  return createHash('sha256').update(payload).digest('hex');
}
