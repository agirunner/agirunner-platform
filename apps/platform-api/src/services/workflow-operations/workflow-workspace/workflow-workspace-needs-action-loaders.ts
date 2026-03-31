import type {
  ActionableTaskRecord,
  GateActionSource,
  TaskActionSource,
  WorkflowGateRecord,
  WorkflowTaskBindingRecord,
} from './workflow-workspace-types.js';
import {
  asRecord,
  buildTaskVerificationSummary,
  readOptionalInteger,
  readOptionalRecord,
  readOptionalString,
  readStringArray,
} from './workflow-workspace-common.js';
import { isActionableGateStatus } from './workflow-workspace-needs-action-board.js';

export async function loadWorkflowGates(
  gateActionSource: GateActionSource | undefined,
  tenantId: string,
  workflowId: string,
): Promise<WorkflowGateRecord[]> {
  if (!gateActionSource) {
    return [];
  }
  const gates = await gateActionSource.listWorkflowGates(tenantId, workflowId);
  return gates
    .map(normalizeWorkflowGate)
    .filter((gate): gate is WorkflowGateRecord => gate !== null && isActionableGateStatus(gate.status));
}

export async function loadActionableTasks(
  taskActionSource: TaskActionSource | undefined,
  tenantId: string,
  workflowId: string,
  workItemId: string | null,
): Promise<ActionableTaskRecord[]> {
  if (!taskActionSource) {
    return [];
  }
  const states = ['awaiting_approval', 'output_pending_assessment', 'escalated', 'failed'] as const;
  const pages = await Promise.all(
    states.map((state) =>
      taskActionSource.listTasks(tenantId, {
        workflow_id: workflowId,
        work_item_id: workItemId ?? undefined,
        state,
        page: 1,
        per_page: 100,
      }),
    ),
  );

  return pages
    .flatMap((page) => page.data)
    .map(normalizeActionableTask)
    .filter((task): task is ActionableTaskRecord => task !== null)
    .sort(compareActionableTasks);
}

export async function loadWorkflowTaskBindings(
  taskActionSource: TaskActionSource | undefined,
  tenantId: string,
  workflowId: string,
): Promise<WorkflowTaskBindingRecord[]> {
  if (!taskActionSource) {
    return [];
  }
  const pageSize = 200;
  const bindings: WorkflowTaskBindingRecord[] = [];
  for (let page = 1; page < 100; page += 1) {
    const result = await taskActionSource.listTasks(tenantId, {
      workflow_id: workflowId,
      page,
      per_page: pageSize,
    });
    const normalizedPage = result.data
      .map(normalizeWorkflowTaskBinding)
      .filter((task): task is WorkflowTaskBindingRecord => task !== null);
    bindings.push(...normalizedPage);
    if (result.data.length < pageSize) {
      break;
    }
  }
  return bindings;
}

function normalizeActionableTask(record: Record<string, unknown>): ActionableTaskRecord | null {
  const id = readOptionalString(record.id);
  const title = readOptionalString(record.title);
  const state = readOptionalString(record.state);
  if (!id || !title || !state) {
    return null;
  }
  const metadata = asRecord(record.metadata);
  return {
    id,
    title,
    role: readOptionalString(record.role),
    state,
    work_item_id: readOptionalString(record.work_item_id),
    updated_at: readOptionalString(record.updated_at),
    description: readOptionalString(record.description) ?? readOptionalString(metadata.description),
    review_feedback:
      readOptionalString(asRecord(record.input).assessment_feedback)
      ?? readOptionalString(metadata.assessment_feedback),
    verification_summary: buildTaskVerificationSummary(asRecord(record.verification)),
    subject_revision:
      readOptionalInteger(asRecord(record.input).subject_revision)
      ?? readOptionalInteger(metadata.subject_revision)
      ?? readOptionalInteger(metadata.output_revision),
    escalation_reason: readOptionalString(metadata.escalation_reason),
    escalation_context: readOptionalString(metadata.escalation_context),
    escalation_work_so_far: readOptionalString(metadata.escalation_work_so_far),
    escalation_context_packet: readOptionalRecord(metadata.escalation_context_packet),
  };
}

function normalizeWorkflowTaskBinding(record: Record<string, unknown>): WorkflowTaskBindingRecord | null {
  const id = readOptionalString(record.id);
  if (!id) {
    return null;
  }
  return {
    id,
    work_item_id: readOptionalString(record.work_item_id),
  };
}

function compareActionableTasks(left: ActionableTaskRecord, right: ActionableTaskRecord): number {
  return (right.updated_at ?? '').localeCompare(left.updated_at ?? '') || left.id.localeCompare(right.id);
}

function normalizeWorkflowGate(record: Record<string, unknown>): WorkflowGateRecord | null {
  const gateId = readOptionalString(record.gate_id) ?? readOptionalString(record.id);
  const stageName = readOptionalString(record.stage_name);
  const status = readOptionalString(record.status) ?? readOptionalString(record.gate_status);
  if (!gateId || !stageName || !status) {
    return null;
  }
  return {
    gate_id: gateId,
    stage_name: stageName,
    status,
    request_summary: readOptionalString(record.request_summary) ?? readOptionalString(record.summary),
    recommendation: readOptionalString(record.recommendation),
    concerns: readStringArray(record.concerns),
    requested_by_work_item_id: readOptionalString(record.requested_by_work_item_id) ?? null,
    requested_by_task_title:
      readOptionalString(asRecord(record.requested_by_task).title)
      ?? readOptionalString(record.requested_by_task_title),
    requested_by_work_item_title:
      readOptionalString(asRecord(record.requested_by_task).work_item_title)
      ?? readOptionalString(record.requested_by_work_item_title),
  };
}
