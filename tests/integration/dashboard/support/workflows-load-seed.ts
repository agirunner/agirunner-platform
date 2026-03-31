const DEFAULT_LOAD_BASE_ISO = '2026-02-01T00:00:00.000Z';

const LOAD_STAGES = [
  { name: 'intake', goal: 'Clarify the request', position: 0 },
  { name: 'delivery', goal: 'Deliver the requested outcome', position: 1 },
] as const;

type WorkflowLoadProfile =
  | 'active'
  | 'approval'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'escalated';

export interface WorkflowLoadSeedInput {
  tenantId: string;
  workspaceId: string;
  workspaceName: string;
  plannedPlaybookId: string;
  plannedPlaybookName: string;
  ongoingPlaybookId: string;
  ongoingPlaybookName: string;
  count: number;
  lifecycleMode?: 'mixed' | 'ongoing' | 'planned';
  baseIso?: string;
  turnsPerWorkflow?: number;
  briefsPerWorkflow?: number;
  workItemsPerWorkflow?: number;
  tasksPerWorkflow?: number;
  deliverablesPerWorkflow?: number;
}

export interface WorkflowLoadSeedPlan {
  baseTimeMs: number;
  workflows: string[];
  stages: string[];
  workItems: string[];
  tasks: string[];
  logs: string[];
  briefs: string[];
  documents: string[];
}

export function buildWorkflowLoadSeedPlan(input: WorkflowLoadSeedInput): WorkflowLoadSeedPlan {
  if (input.count <= 0) {
    return {
      baseTimeMs: Date.parse(input.baseIso ?? new Date().toISOString()),
      workflows: [],
      stages: [],
      workItems: [],
      tasks: [],
      logs: [],
      briefs: [],
      documents: [],
    };
  }

  const baseTimeMs = Date.parse(input.baseIso ?? new Date().toISOString());
  const turnsPerWorkflow = Math.max(1, input.turnsPerWorkflow ?? 2);
  const briefsPerWorkflow = Math.max(1, input.briefsPerWorkflow ?? 1);
  const workItemsPerWorkflow = Math.max(1, input.workItemsPerWorkflow ?? 1);
  const tasksPerWorkflow = Math.max(1, input.tasksPerWorkflow ?? 1);
  const deliverablesPerWorkflow = Math.max(1, input.deliverablesPerWorkflow ?? 1);
  const workflows: string[] = [];
  const stages: string[] = [];
  const workItems: string[] = [];
  const tasks: string[] = [];
  const logs: string[] = [];
  const briefs: string[] = [];
  const documents: string[] = [];

  for (let index = 0; index < input.count; index += 1) {
    const profile = resolveProfile(index, input.lifecycleMode);
    const workflowId = stableUuid(index, 1);
    const createdAtIso = new Date(baseTimeMs + (input.count - index) * 1000).toISOString();
    const workflow = buildWorkflowShape(profile);
    const workflowName = `E2E Perf Workflow ${String(index + 1).padStart(5, '0')}`;
    const workflowMetadata = workflow.state === 'paused'
      ? { pause_requested_at: createdAtIso }
      : workflow.state === 'cancelled'
        ? { cancel_requested_at: createdAtIso }
        : {};

    workflows.push(`(
      ${sqlUuid(workflowId)},
      ${sqlUuid(input.tenantId)},
      ${sqlUuid(input.workspaceId)},
      ${sqlUuid(workflow.playbookId === 'ongoing' ? input.ongoingPlaybookId : input.plannedPlaybookId)},
      ${sqlText(workflowName)},
      ${sqlText(workflow.state)}::public.workflow_state,
      ${sqlText(workflow.lifecycle)},
      ${workflow.workflowCurrentStage ? sqlText(workflow.workflowCurrentStage) : 'NULL'},
      ${sqlJsonValue({ workflow_goal: workflow.goal })}::jsonb,
      ${sqlJsonValue(workflowMetadata)}::jsonb,
      ${sqlTimestamp(createdAtIso)},
      ${sqlTimestamp(createdAtIso)}
    )`);

    for (const stage of LOAD_STAGES) {
      stages.push(`(
        ${sqlUuid(stableUuid(index, stage.position + 10))},
        ${sqlUuid(input.tenantId)},
        ${sqlUuid(workflowId)},
        ${sqlText(stage.name)},
        ${stage.position},
        ${sqlText(stage.goal)},
        ${sqlText(resolveStageStatus(profile, stage.name))},
        ${sqlText(resolveGateStatus(profile, stage.name))},
        ${sqlTimestamp(createdAtIso)},
        ${sqlTimestamp(createdAtIso)}
      )`);
    }

    const workItemIds = Array.from({ length: workItemsPerWorkflow }, (_value, workItemIndex) => {
      const workItemId = stableUuid(index, 2_000 + workItemIndex);
      workItems.push(`(
        ${sqlUuid(workItemId)},
        ${sqlUuid(input.tenantId)},
        ${sqlUuid(workflowId)},
        ${sqlText(workItemStageName(workItemIndex))},
        ${sqlText(buildWorkItemTitle(workflow.workItemTitle, workItemIndex))},
        ${sqlText(workflow.goal)},
        ${sqlText(workflow.acceptanceCriteria)},
        ${sqlText(workflow.columnId)},
        ${sqlText(workflow.ownerRole)},
        ${workflow.blockedState ? sqlText(workflow.blockedState) : 'NULL'},
        ${workflow.blockedReason ? sqlText(workflow.blockedReason) : 'NULL'},
        ${workflow.escalationStatus ? sqlText(workflow.escalationStatus) : 'NULL'},
        ${sqlText('normal')}::task_priority,
        ${sqlText(`perf-load:${workflowId}:${workItemIndex}`)},
        ${workflow.completed ? sqlTimestamp(createdAtIso) : 'NULL'},
        ${sqlJsonValue(workflow.workItemMetadata)}::jsonb,
        ${sqlTimestamp(createdAtIso)},
        ${sqlTimestamp(createdAtIso)}
      )`);
      return workItemId;
    });

    const taskIds = Array.from({ length: tasksPerWorkflow }, (_value, taskIndex) => {
      const workItemId = workItemIds[taskIndex % workItemIds.length] ?? workItemIds[0];
      const taskId = stableUuid(index, 4_000 + taskIndex);
      const stageName = workItemStageName(taskIndex);
      tasks.push(`(
        ${sqlUuid(taskId)},
        ${sqlUuid(input.tenantId)},
        ${sqlUuid(workflowId)},
        ${sqlUuid(input.workspaceId)},
        ${sqlUuid(workItemId)},
        ${sqlText(stageName)},
        ${sqlText(buildTaskTitle(workflow.taskTitle, taskIndex))},
        ${sqlText(workflow.ownerRole)},
        ${sqlText(workflow.taskState)}::task_state,
        ${sqlTimestamp(createdAtIso)},
        '{}'::jsonb,
        ${sqlJsonValue({ description: buildTaskSummary(workflow.taskSummary, taskIndex) })}::jsonb,
        ${sqlTimestamp(createdAtIso)},
        ${sqlTimestamp(createdAtIso)},
        '{}'::jsonb
      )`);
      return taskId;
    });

    for (let turnIndex = 0; turnIndex < turnsPerWorkflow; turnIndex += 1) {
      const taskId = taskIds[turnIndex % taskIds.length] ?? taskIds[0];
      const workItemId = workItemIds[turnIndex % workItemIds.length] ?? workItemIds[0];
      logs.push(`(
        ${sqlUuid(input.tenantId)},
        ${sqlUuid(stableUuid(index, 100 + turnIndex * 2))},
        ${sqlUuid(stableUuid(index, 101 + turnIndex * 2))},
        'runtime',
        'agent_loop',
        'info',
        ${sqlText(turnIndex === 0 ? 'agent.plan' : 'agent.act')},
        'completed',
        ${sqlJsonValue({ summary: `${workflow.liveHeadline} ${turnIndex + 1}` })}::jsonb,
        ${sqlUuid(input.workspaceId)},
        ${sqlUuid(workflowId)},
        ${sqlText(workflowName)},
        ${sqlText(input.workspaceName)},
        ${sqlUuid(workItemId)},
        ${sqlText(buildTaskTitle(workflow.taskTitle, turnIndex % taskIds.length))},
        ${sqlText(workItemStageName(turnIndex))},
        FALSE,
        ${sqlText(workflow.ownerRole)},
        'runtime',
        ${sqlText(`perf-load:${workflow.ownerRole}`)},
        ${sqlText(workflow.actorName)},
        ${sqlTimestamp(createdAtIso)}
      )`);
    }

    for (let briefIndex = 0; briefIndex < briefsPerWorkflow; briefIndex += 1) {
      const briefId = stableUuid(index, 200 + briefIndex);
      const taskId = taskIds[briefIndex % taskIds.length] ?? taskIds[0];
      const workItemId = workItemIds[briefIndex % workItemIds.length] ?? workItemIds[0];
      briefs.push(`(
        ${sqlUuid(briefId)},
        ${sqlUuid(input.tenantId)},
        ${sqlUuid(workflowId)},
        ${sqlUuid(workItemId)},
        ${sqlUuid(taskId)},
        ${sqlText(`perf-brief:${workflowId}:${briefIndex}`)},
        ${sqlText(taskId)},
        'milestone',
        'workflow_timeline',
        'specialist',
        ${sqlText(workflow.actorName)},
        ${briefIndex + 1},
        'handoff',
        ${sqlJsonValue({ headline: `${workflow.briefHeadline} ${briefIndex + 1}` })}::jsonb,
        ${sqlJsonValue({
          headline: `${workflow.briefHeadline} ${briefIndex + 1}`,
          status_kind: 'handoff',
          summary: workflow.briefSummary,
        })}::jsonb,
        ${sqlJsonValue([workflowId, workItemId, taskId])}::jsonb,
        ${briefIndex + 1},
        '[]'::jsonb,
        '[]'::jsonb,
        '[]'::jsonb,
        NULL,
        'admin',
        'perf-load',
        ${sqlTimestamp(createdAtIso)},
        ${sqlTimestamp(createdAtIso)}
      )`);
    }

    if (workflow.hasDeliverable) {
      for (let deliverableIndex = 0; deliverableIndex < deliverablesPerWorkflow; deliverableIndex += 1) {
        const taskId = taskIds[deliverableIndex % taskIds.length] ?? taskIds[0];
        documents.push(`(
          ${sqlUuid(stableUuid(index, 300 + deliverableIndex))},
          ${sqlUuid(input.tenantId)},
          ${sqlUuid(workflowId)},
          ${sqlUuid(input.workspaceId)},
          ${sqlUuid(taskId)},
          ${sqlText(`deliverable-${index + 1}-${deliverableIndex + 1}`)},
          'external',
          ${sqlText(`https://example.com/perf/${workflowId}/deliverable/${deliverableIndex + 1}`)},
          NULL,
          'text/markdown',
          ${sqlText(`${workflowName} deliverable ${deliverableIndex + 1}`)},
          ${sqlText(workflow.deliverableSummary)},
          '{}'::jsonb,
          ${sqlTimestamp(createdAtIso)}
        )`);
      }
    }
  }

  return {
    baseTimeMs,
    workflows,
    stages,
    workItems,
    tasks,
    logs,
    briefs,
    documents,
  };
}

export function buildWorkflowLoadSeedSql(input: WorkflowLoadSeedInput): string {
  const plan = buildWorkflowLoadSeedPlan(input);
  if (plan.workflows.length === 0) {
    return '';
  }

  return [
    ...readExecutionLogPartitionStatements(plan.baseTimeMs, input.count),
    buildInsertStatement('public.workflows', [
      'id', 'tenant_id', 'workspace_id', 'playbook_id', 'name', 'state', 'lifecycle', 'current_stage',
      'parameters', 'metadata', 'created_at', 'updated_at',
    ], plan.workflows),
    buildInsertStatement('public.workflow_stages', [
      'id', 'tenant_id', 'workflow_id', 'name', 'position', 'goal', 'status', 'gate_status', 'created_at', 'updated_at',
    ], plan.stages),
    buildInsertStatement('public.workflow_work_items', [
      'id', 'tenant_id', 'workflow_id', 'stage_name', 'title', 'goal', 'acceptance_criteria', 'column_id',
      'owner_role', 'blocked_state', 'blocked_reason', 'escalation_status', 'priority', 'request_id',
      'completed_at', 'metadata', 'created_at', 'updated_at',
    ], plan.workItems),
    buildInsertStatement('public.tasks', [
      'id', 'tenant_id', 'workflow_id', 'workspace_id', 'work_item_id', 'stage_name', 'title', 'role', 'state',
      'state_changed_at', 'input', 'metadata', 'created_at', 'updated_at', 'context',
    ], plan.tasks),
    buildInsertStatement('public.execution_logs', [
      'tenant_id', 'trace_id', 'span_id', 'source', 'category', 'level', 'operation', 'status', 'payload',
      'workspace_id', 'workflow_id', 'workflow_name', 'workspace_name', 'work_item_id', 'task_title',
      'stage_name', 'is_orchestrator_task', 'role', 'actor_type', 'actor_id', 'actor_name', 'created_at',
    ], plan.logs),
    buildInsertStatement('public.workflow_operator_briefs', [
      'id', 'tenant_id', 'workflow_id', 'work_item_id', 'task_id', 'request_id', 'execution_context_id', 'brief_kind',
      'brief_scope', 'source_kind', 'source_role_name', 'llm_turn_count', 'status_kind', 'short_brief',
      'detailed_brief_json', 'linked_target_ids', 'sequence_number', 'related_artifact_ids',
      'related_output_descriptor_ids', 'related_intervention_ids', 'canonical_workflow_brief_id',
      'created_by_type', 'created_by_id', 'created_at', 'updated_at',
    ], plan.briefs),
    buildInsertStatement('public.workflow_documents', [
      'id', 'tenant_id', 'workflow_id', 'workspace_id', 'task_id', 'logical_name', 'source', 'location',
      'artifact_id', 'content_type', 'title', 'description', 'metadata', 'created_at',
    ], plan.documents),
  ].filter(Boolean).join('\n\n');
}

function buildInsertStatement(tableName: string, columns: string[], rows: string[]): string {
  if (rows.length === 0) {
    return '';
  }
  return `INSERT INTO ${tableName} (${columns.join(', ')})\nVALUES\n${rows.join(',\n')};`;
}

function readExecutionLogPartitionStatements(baseTimeMs: number, count: number): string[] {
  const dates = new Set<string>();
  for (let index = 0; index < Math.max(1, count); index += 1) {
    const timestamp = new Date(baseTimeMs + (count - index) * 1000);
    dates.add(timestamp.toISOString().slice(0, 10));
  }
  return [...dates].sort().map((date) => `SELECT create_execution_logs_partition(${sqlText(date)}::date);`);
}

function resolveProfile(
  index: number,
  lifecycleMode: WorkflowLoadSeedInput['lifecycleMode'] = 'mixed',
): WorkflowLoadProfile {
  const profiles: WorkflowLoadProfile[] =
    lifecycleMode === 'ongoing'
      ? ['active', 'approval', 'paused', 'escalated']
      : lifecycleMode === 'planned'
        ? ['completed', 'cancelled', 'failed']
        : ['active', 'approval', 'paused', 'completed', 'cancelled', 'failed', 'escalated'];
  return profiles[index % profiles.length] ?? 'active';
}

function resolveStageStatus(profile: WorkflowLoadProfile, stageName: string): string {
  if (profile === 'completed' || profile === 'cancelled') return 'completed';
  if (stageName === 'intake') return 'active';
  return profile === 'failed' || profile === 'escalated' ? 'blocked' : 'pending';
}

function workItemStageName(index: number): string {
  return LOAD_STAGES[index % LOAD_STAGES.length]?.name ?? LOAD_STAGES[0].name;
}

function buildWorkItemTitle(baseTitle: string, index: number): string {
  return index === 0 ? baseTitle : `${baseTitle} ${index + 1}`;
}

function buildTaskTitle(baseTitle: string, index: number): string {
  return index === 0 ? baseTitle : `${baseTitle} ${index + 1}`;
}

function buildTaskSummary(baseSummary: string, index: number): string {
  return index === 0 ? baseSummary : `${baseSummary} Step ${index + 1}.`;
}

function resolveGateStatus(profile: WorkflowLoadProfile, stageName: string): string {
  return profile === 'approval' && stageName === 'delivery' ? 'awaiting_approval' : 'not_requested';
}

function buildWorkflowShape(profile: WorkflowLoadProfile) {
  const shapes = {
    active: { lifecycle: 'ongoing', playbookId: 'ongoing', state: 'active', workflowCurrentStage: null, workItemStage: 'intake', columnId: 'doing', ownerRole: 'intake-analyst', taskState: 'in_progress', goal: 'Keep incoming work progressing.', acceptanceCriteria: 'Work remains active and attributable.', workItemTitle: 'Active intake queue', taskTitle: 'Advance the active intake queue', taskSummary: 'Specialist is working the active queue.', liveHeadline: 'Planning next active step', briefHeadline: 'Active progress brief', briefSummary: 'Work is in progress with active specialist execution.', hasDeliverable: false, deliverableSummary: '', blockedState: null, blockedReason: null, escalationStatus: null, workItemMetadata: {}, actorName: 'Intake Analyst', completed: false },
    approval: { lifecycle: 'ongoing', playbookId: 'ongoing', state: 'active', workflowCurrentStage: null, workItemStage: 'delivery', columnId: 'doing', ownerRole: 'reviewer', taskState: 'awaiting_approval', goal: 'Hold the output for operator approval.', acceptanceCriteria: 'Operator can review and decide.', workItemTitle: 'Approval review queue', taskTitle: 'Await operator approval', taskSummary: 'Output is waiting on operator review.', liveHeadline: 'Review packet ready for operator decision', briefHeadline: 'Approval packet brief', briefSummary: 'Awaiting operator approval on the current output.', hasDeliverable: true, deliverableSummary: 'Approval packet attached for operator review.', blockedState: null, blockedReason: null, escalationStatus: null, workItemMetadata: {}, actorName: 'Policy Reviewer', completed: false },
    paused: { lifecycle: 'ongoing', playbookId: 'ongoing', state: 'paused', workflowCurrentStage: null, workItemStage: 'intake', columnId: 'doing', ownerRole: 'intake-analyst', taskState: 'claimed', goal: 'Pause the current work without losing context.', acceptanceCriteria: 'Work remains paused until resumed.', workItemTitle: 'Paused review queue', taskTitle: 'Hold paused review', taskSummary: 'Work is paused with preserved context.', liveHeadline: 'Pause acknowledged for the current work', briefHeadline: 'Paused status brief', briefSummary: 'Workflow is paused and awaiting resume.', hasDeliverable: false, deliverableSummary: '', blockedState: null, blockedReason: null, escalationStatus: null, workItemMetadata: { pause_requested_at: DEFAULT_LOAD_BASE_ISO }, actorName: 'Intake Analyst', completed: false },
    completed: { lifecycle: 'planned', playbookId: 'planned', state: 'completed', workflowCurrentStage: 'delivery', workItemStage: 'delivery', columnId: 'done', ownerRole: 'publisher', taskState: 'completed', goal: 'Produce the final operator-facing deliverable.', acceptanceCriteria: 'A final deliverable is available.', workItemTitle: 'Completed final packet', taskTitle: 'Finalize the deliverable packet', taskSummary: 'The final deliverable has been completed.', liveHeadline: 'Completed final deliverable packaging', briefHeadline: 'Completion brief', briefSummary: 'Workflow completed with a final deliverable.', hasDeliverable: true, deliverableSummary: 'Final deliverable ready for download.', blockedState: null, blockedReason: null, escalationStatus: null, workItemMetadata: {}, actorName: 'Publisher', completed: true },
    cancelled: { lifecycle: 'planned', playbookId: 'planned', state: 'cancelled', workflowCurrentStage: 'delivery', workItemStage: 'delivery', columnId: 'done', ownerRole: 'reviewer', taskState: 'cancelled', goal: 'Terminate the requested work cleanly.', acceptanceCriteria: 'The item stays terminal and cancelled.', workItemTitle: 'Cancelled packet review', taskTitle: 'Cancel packet review', taskSummary: 'The work was cancelled before completion.', liveHeadline: 'Workflow cancelled after review', briefHeadline: 'Cancellation brief', briefSummary: 'Workflow was cancelled and should remain terminal.', hasDeliverable: false, deliverableSummary: '', blockedState: null, blockedReason: null, escalationStatus: null, workItemMetadata: { cancel_requested_at: DEFAULT_LOAD_BASE_ISO }, actorName: 'Reviewer', completed: true },
    failed: { lifecycle: 'planned', playbookId: 'planned', state: 'failed', workflowCurrentStage: 'delivery', workItemStage: 'delivery', columnId: 'blocked', ownerRole: 'developer', taskState: 'failed', goal: 'Surface a failed workflow needing investigation.', acceptanceCriteria: 'Failure remains visible in the rail.', workItemTitle: 'Failed implementation review', taskTitle: 'Investigate failed implementation', taskSummary: 'A failed task needs investigation.', liveHeadline: 'Failure captured for operator review', briefHeadline: 'Failure brief', briefSummary: 'Task failed and needs investigation.', hasDeliverable: false, deliverableSummary: '', blockedState: 'blocked', blockedReason: 'Execution failed during seeded load setup.', escalationStatus: null, workItemMetadata: {}, actorName: 'Developer', completed: false },
    escalated: { lifecycle: 'ongoing', playbookId: 'ongoing', state: 'active', workflowCurrentStage: null, workItemStage: 'delivery', columnId: 'blocked', ownerRole: 'policy-assessor', taskState: 'escalated', goal: 'Keep an operator-facing escalation visible.', acceptanceCriteria: 'Escalation remains actionable.', workItemTitle: 'Escalated review item', taskTitle: 'Escalate operator review', taskSummary: 'Operator guidance is required to continue.', liveHeadline: 'Escalation issued for operator intervention', briefHeadline: 'Escalation brief', briefSummary: 'Work item escalated and requires operator action.', hasDeliverable: false, deliverableSummary: '', blockedState: 'blocked', blockedReason: 'Seeded escalation requires operator guidance.', escalationStatus: 'open', workItemMetadata: {}, actorName: 'Policy Assessor', completed: false },
  } as const;
  return shapes[profile];
}

function stableUuid(index: number, slot: number): string {
  const suffix = BigInt(index + 1) * 1000n + BigInt(slot);
  return `00000000-0000-4000-8000-${suffix.toString(16).padStart(12, '0').slice(-12)}`;
}

function sqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlUuid(value: string): string {
  return `${sqlText(value)}::uuid`;
}

function sqlTimestamp(value: string): string {
  return `${sqlText(value)}::timestamptz`;
}

function sqlJsonValue(value: unknown): string {
  return sqlText(JSON.stringify(value));
}
