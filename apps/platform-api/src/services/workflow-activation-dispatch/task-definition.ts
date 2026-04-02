import { buildGitRemoteResourceBindings, resolveWorkspaceStorageBinding } from '../workspace/workspace-storage.js';

import { DEFAULT_REPOSITORY_TASK_TEMPLATE, type ActivationTaskDefinition, type QueuedActivationRow, type WorkflowDispatchRow } from './types.js';
import {
  asNullableString,
  asRecord,
  countDispatchableEvents,
  deriveActivationReason,
  derivePrimaryActivationEvent,
  formatActivationEventDetails,
  formatActivationEventDetailsFromFields,
} from './helpers.js';

export function buildActivationTaskTitle(workflow: WorkflowDispatchRow): string {
  return `Orchestrate ${workflow.name}`;
}

export function buildActivationTaskDefinition(
  workflow: WorkflowDispatchRow,
  activation: QueuedActivationRow,
  activationBatch: QueuedActivationRow[],
): ActivationTaskDefinition {
  const repository = resolveWorkflowRepositoryContext(workflow);
  const activationReason = deriveActivationReason(activationBatch);
  const primaryEvent = derivePrimaryActivationEvent(activation, activationBatch);

  return {
    title: buildActivationTaskTitle(workflow),
    stageName: activationTaskStageName(workflow, activationBatch),
    workItemId: activationTaskWorkItemId(activation, activationBatch),
    input: buildActivationTaskInput(workflow, activation, primaryEvent, activationBatch),
    roleConfig: buildActivationRoleConfig(),
    environment: buildActivationEnvironment(repository),
    resourceBindings: buildActivationResourceBindings(repository),
    metadata: {
      activation_event_type: primaryEvent.event_type,
      activation_reason: activationReason,
      activation_request_id: primaryEvent.request_id,
      activation_event_count: countDispatchableEvents(activationBatch),
      activation_dispatch_attempt: activation.dispatch_attempt,
      activation_dispatch_token: activation.dispatch_token,
    },
  };
}

function buildActivationTaskInput(
  workflow: WorkflowDispatchRow,
  activation: QueuedActivationRow,
  primaryEvent: QueuedActivationRow,
  activationBatch: QueuedActivationRow[],
): Record<string, unknown> {
  const repository = resolveWorkflowRepositoryContext(workflow);
  const activationReason = deriveActivationReason(activationBatch);
  const queuedEvents =
    activationReason === 'heartbeat'
      ? []
      : activationBatch
        .filter((event) => event.event_type !== 'heartbeat')
        .map((event) => ({
          queue_id: event.id,
          type: event.event_type,
          reason: event.reason,
          payload: event.payload,
          work_item_id: asNullableString(event.payload.work_item_id),
          stage_name: asNullableString(event.payload.stage_name),
          timestamp: event.queued_at.toISOString(),
        }));
  const primaryEventDetails = formatActivationEventDetails(primaryEvent);
  const queuedEventDetails = queuedEvents
    .map((event) => formatActivationEventDetailsFromFields(event.type, event.payload))
    .filter((value): value is string => value !== null);

  return {
    activation_id: activation.id,
    activation_reason: activationReason,
    activation_dispatch_attempt: activation.dispatch_attempt,
    activation_dispatch_token: activation.dispatch_token,
    lifecycle: workflow.lifecycle,
    ...(workflow.lifecycle !== 'ongoing' ? { current_stage: workflow.current_stage } : {}),
    active_stages: workflow.active_stages,
    repository: buildActivationRepositoryInput(repository),
    events: queuedEvents,
    description: [
      `You are the workflow orchestrator for "${workflow.name}" (${workflow.playbook_name}).`,
      `Reason for this activation: ${activationReason}.`,
      activationReason === 'heartbeat'
        ? 'No queued events were present. Proactively inspect stale tasks, blocked work, and overall workflow health.'
        : `Queued events in this batch: ${queuedEvents.length}.`,
      `Primary trigger event: ${primaryEvent.event_type}.`,
      primaryEventDetails ? `Primary trigger details: ${primaryEventDetails}.` : null,
      queuedEventDetails.length > 0
        ? `Queued event details: ${queuedEventDetails.join('; ')}.`
        : null,
      workflow.active_stages.length > 0
        ? `Active stages in open work: ${workflow.active_stages.join(', ')}.`
        : null,
      workflow.playbook_outcome
        ? `Target outcome: ${workflow.playbook_outcome}.`
        : null,
      repository.repository_url
        ? `Repository: ${repository.repository_url}.`
        : null,
      repository.base_branch
        ? `Base branch: ${repository.base_branch}.`
        : null,
      repository.feature_branch
        ? `Feature branch for repo-backed specialist work: ${repository.feature_branch}.`
        : null,
      'Review the attached workflow, playbook, work item, and activation context before deciding on the next step.',
      'Use the available workflow management tools to create work items, create tasks, advance stages, request gates, review task outputs, and update workspace memory when needed.',
      'Active subordinate work means real workflow work items and non-orchestrator specialist tasks, not the current orchestrator task itself.',
      'Do not use read_task_status on the current orchestrator task id as evidence that stage work already exists.',
      'Plans, thoughts, summaries, and failed attempts do not count as successful workflow mutations.',
      'Treat create_work_item, create_task, and other mutating workflow tools as done only after the corresponding tool call succeeds and returns the exact ids.',
      'Every mutating workflow management tool call must include a unique request_id.',
      'Repository-backed specialist tasks must include repository execution context so the runtime can clone, validate, commit, and push safely.',
      'Do not inspect repositories directly from the orchestrator activation. When repository evidence is required, read existing specialist outputs and artifacts or dispatch specialist work that performs the repository inspection.',
      'If you conclude that a planned workflow should progress, perform the required workflow mutation in the same activation instead of stopping at a recommendation.',
      'Return a concise operator-facing summary of what changed, what is blocked, and the next action you recommend.',
    ]
      .filter((line): line is string => Boolean(line))
      .join('\n'),
    acceptance_criteria: [
      'Describe the activation trigger and affected workflow state.',
      'Reference any impacted work items or tasks by ID when relevant.',
      'State the next recommended workflow action clearly.',
    ],
  };
}

function activationTaskStageName(
  workflow: WorkflowDispatchRow,
  activationBatch: QueuedActivationRow[],
): string | null {
  if (workflow.lifecycle !== 'ongoing') {
    return workflow.current_stage ?? null;
  }

  const eventStages = uniqueStageNames(activationBatch);
  if (eventStages.length === 1) {
    return eventStages[0];
  }
  if (workflow.active_stages.length === 1) {
    return workflow.active_stages[0];
  }
  return null;
}

function activationTaskWorkItemId(
  activation: QueuedActivationRow,
  activationBatch: QueuedActivationRow[],
): string | null {
  const primaryWorkItemId = asNullableString(activation.payload.work_item_id);
  if (primaryWorkItemId) {
    return primaryWorkItemId;
  }

  const eventWorkItemIds = uniqueWorkItemIds(activationBatch);
  if (eventWorkItemIds.length === 1) {
    return eventWorkItemIds[0];
  }

  return null;
}

function uniqueStageNames(activationBatch: QueuedActivationRow[]): string[] {
  return Array.from(
    new Set(
      activationBatch
        .map((event) => asNullableString(event.payload.stage_name))
        .filter((stageName): stageName is string => Boolean(stageName)),
    ),
  );
}

function uniqueWorkItemIds(activationBatch: QueuedActivationRow[]): string[] {
  return Array.from(
    new Set(
      activationBatch
        .map((event) => asNullableString(event.payload.work_item_id))
        .filter((workItemId): workItemId is string => Boolean(workItemId)),
    ),
  );
}

function buildActivationRoleConfig(): Record<string, unknown> {
  return {
    system_prompt: [
      'You are the workflow orchestrator.',
      'Assess workflow state, inspect repository artifacts when needed, and take the next management action directly through the workflow control tools.',
      'Use work-item continuity and structured handoffs as the source of operational truth between activations.',
      'Workflow-scoped activations often have no current work_item_id, so discover the exact target work item first before using continuity or handoff read tools.',
      'Your own current orchestrator task never counts as subordinate work. Only work items returned by list_work_items and non-orchestrator tasks returned by list_workflow_tasks count as active dispatched work.',
      'Do not use read_task_status on the current orchestrator task id as evidence that stage work already exists.',
      'Plans, thoughts, summaries, and failed attempts do not count as successful workflow mutations.',
      'Treat create_work_item, create_task, and other mutating workflow tools as done only after the corresponding tool call succeeds and returns the exact ids.',
      'After you dispatch required specialist work, request a gate, or detect active subordinate work with no new routing decision to make, finish the activation and wait for the next event.',
      'If no subordinate work is active and the workflow should progress, perform the workflow mutation now rather than ending with only a recommendation.',
      'Before seeding a planned successor stage, inspect the target stage contract and use one of its exact authored starter roles.',
      'If read_stage_status returns starter_roles for that stage, copy one exactly and do not reuse the predecessor role unless it appears there.',
      'Do not poll running tasks in a loop.',
      'If a stage already awaits approval, do not request another gate; finish the activation and wait for the decision event.',
      'Always include a unique request_id on mutating workflow control tool calls.',
      'Every orchestrator activation MUST finish with submit_handoff before task completion, including return-to-pending and legitimate wait-state activations.',
      'record_operator_brief is optional operator-facing narrative. It never replaces submit_handoff and is not a completion write.',
      'If you routed work, requested a gate, closed or reopened work, or chose to wait after inspection because canonical workflow state shows real active subordinate work or an explicit gate/escalation wait, submit_handoff in that same activation before attempting completion.',
      'Before attempting completion, perform a final self-check: if submit_handoff has not succeeded in this activation yet, do it now instead of ending on a brief or tool mutation alone.',
      'Every submit_handoff call must include request_id. If you are about to call submit_handoff without request_id, stop and construct it first from the provided handoff pattern.',
      'Use record_operator_brief for material milestone summaries and the terminal workflow brief.',
      'Standard live visibility comes from canonical workflow events and required briefs, not from an extra model-authored operator-update tool.',
      'Enhanced live visibility streams trimmed execution output automatically from the persisted loop phases. Do not add a reporting step just to keep the console moving.',
      'Operator briefs and live-console phase lines are console text, not audit logs: keep them human-readable, use titles and roles when available, and never dump tool chatter, phases, JSON, UUIDs, or lines like "Ran File Read", "tool_failure", or "executed 2 tools".',
      'Every record_operator_brief call must also include a unique request_id; reuse it only for an intentional retry of the same write.',
      'record_operator_brief inputs must include short_brief.headline plus detailed_brief_json.{headline,status_kind}; never send only linked_target_ids or an empty brief shell.',
      'record_operator_brief payload must include payload.short_brief and payload.detailed_brief_json objects.',
      'If payload.linked_deliverables uses the shorthand path form, every entry must include both label and path. Path-only shorthand entries are invalid.',
      'detailed_brief_json must include headline and status_kind.',
      'record_operator_brief example shape: { request_id: "operator-brief:<execution_context_id>:review-ready", execution_context_id: "<execution_context_id>", work_item_id: "<work_item_id if present>", source_kind: "orchestrator", payload: { short_brief: { headline: "Assessment packet is ready for review." }, detailed_brief_json: { headline: "Assessment packet is ready for review.", status_kind: "handoff", summary: "The packet now includes the current findings, risks, and recommended next action for review.", sections: { next_action: ["Route to reviewer for approval."] } } } }.',
      'Never call record_operator_brief with only linked_target_ids or linked deliverables. The short_brief and detailed_brief_json text fields are mandatory in the same call.',
      'Use the exact execution_context_id from the live visibility contract and never invent workflow, work-item, or task linkage. When the live visibility contract includes workflow_id, work_item_id, or task_id, copy those exact ids into the write.',
      'When assigning repository-backed specialist work, include the repository execution context and required git binding details in the task payload.',
      'Attached task context files live under /workspace/context/.... Use file_read only for those attached context files, and never use artifact_read or artifact_document_read for /workspace/context/... paths.',
      'Do not use repository, shell, git, web-fetch, or general filesystem-inspection tools from the orchestrator activation. Orchestrator activations run on the orchestrator agent only.',
      'Be brief, concrete, and operational.',
    ].join(' '),
    tools: [
      'memory_read',
      'memory_write',
      'file_read',
      'artifact_list',
      'artifact_read',
      'artifact_document_read',
      'record_operator_brief',
      'submit_handoff',
      'read_predecessor_handoff',
      'list_work_items',
      'list_workflow_tasks',
      'read_task_output',
      'read_task_status',
      'read_task_events',
      'read_escalation',
      'read_stage_status',
      'read_workflow_budget',
      'read_work_item_continuity',
      'read_latest_handoff',
      'read_handoff_chain',
      'update_task_input',
      'create_work_item',
      'update_work_item',
      'complete_work_item',
      'create_task',
      'create_workflow',
      'request_gate_approval',
      'approve_task',
      'request_rework',
      'advance_stage',
      'complete_workflow',
      'cancel_task',
      'memory_delete',
      'work_item_memory_read',
      'work_item_memory_history',
      'reassign_task',
      'retry_task',
      'send_task_message',
      'escalate',
    ],
  };
}

interface WorkflowRepositoryContext {
  repository_url: string | null;
  base_branch: string | null;
  feature_branch: string | null;
  git_user_name: string | null;
  git_user_email: string | null;
  git_token_secret_ref: string | null;
}

function resolveWorkflowRepositoryContext(workflow: WorkflowDispatchRow): WorkflowRepositoryContext {
  const storage = resolveWorkspaceStorageBinding({
    repository_url: workflow.workspace_repository_url,
    settings: workflow.workspace_settings,
  });
  return {
    repository_url: storage.type === 'git_remote' ? storage.repository_url : null,
    base_branch: storage.type === 'git_remote' ? storage.default_branch : null,
    feature_branch: null,
    git_user_name: storage.type === 'git_remote' ? storage.git_user_name : null,
    git_user_email: storage.type === 'git_remote' ? storage.git_user_email : null,
    git_token_secret_ref:
      storage.type === 'git_remote' ? storage.git_token_secret_ref : null,
  };
}

function buildActivationEnvironment(repository: WorkflowRepositoryContext): Record<string, unknown> {
  return {
    execution_mode: 'orchestrator',
    ...(repository.repository_url ? { template: DEFAULT_REPOSITORY_TASK_TEMPLATE } : {}),
    ...(repository.repository_url ? { repository_url: repository.repository_url } : {}),
    ...(repository.base_branch ? { branch: repository.base_branch } : {}),
    ...(repository.git_user_name ? { git_user_name: repository.git_user_name } : {}),
    ...(repository.git_user_email ? { git_user_email: repository.git_user_email } : {}),
  };
}

function buildActivationRepositoryInput(
  repository: WorkflowRepositoryContext,
): Record<string, unknown> | null {
  const details = {
    ...(repository.repository_url ? { repository_url: repository.repository_url } : {}),
    ...(repository.base_branch ? { base_branch: repository.base_branch } : {}),
    ...(repository.feature_branch ? { feature_branch: repository.feature_branch } : {}),
    ...(repository.git_user_name ? { git_user_name: repository.git_user_name } : {}),
    ...(repository.git_user_email ? { git_user_email: repository.git_user_email } : {}),
  };
  return Object.keys(details).length > 0 ? details : null;
}

function buildActivationResourceBindings(
  repository: WorkflowRepositoryContext,
): Record<string, unknown>[] {
  return buildGitRemoteResourceBindings({
    type: 'git_remote',
    working_directory: '/workspace/repo',
    repository_url: repository.repository_url,
    default_branch: repository.base_branch,
    git_user_name: repository.git_user_name,
    git_user_email: repository.git_user_email,
    git_token_secret_ref: repository.git_token_secret_ref,
  });
}
