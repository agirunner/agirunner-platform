import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { dirname } from 'node:path';

import {
  ADMIN_API_KEY,
  DEFAULT_TENANT_ID,
  PLATFORM_API_CONTAINER_NAME,
  PLATFORM_API_URL,
  POSTGRES_CONTAINER_NAME,
  POSTGRES_DB,
  POSTGRES_USER,
} from './platform-env.js';
import { buildBulkWorkflowInsertSql } from './workflows-bulk-seed.js';
import { resetWorkflowsState } from './workflows-fixture-reset.js';

interface ApiRecord {
  id: string;
  name?: string;
  title?: string;
  workflow_id?: string;
  workspace_id?: string;
}

const SEED_STAGE_DEFINITIONS = [
  { name: 'intake', goal: 'Clarify the request', position: 0 },
  { name: 'delivery', goal: 'Deliver the requested output', position: 1 },
] as const;

const SEED_BOARD_COLUMNS = {
  planned: 'planned',
  active: 'doing',
  blocked: 'blocked',
  done: 'done',
} as const;

export interface SeededWorkflowsScenario {
  workspace: ApiRecord;
  plannedPlaybook: ApiRecord;
  ongoingPlaybook: ApiRecord;
  plannedWorkflow: ApiRecord;
  ongoingWorkflow: ApiRecord;
  ongoingWorkItem: ApiRecord;
  ongoingSecondaryWorkItem: ApiRecord;
  pausedWorkflow: ApiRecord;
  pausedWorkItem: ApiRecord;
  cancelledWorkflow: ApiRecord;
  cancelledWorkItem: ApiRecord;
  orchestratorOnlyWorkflow: ApiRecord;
  needsActionWorkflow: ApiRecord;
  needsActionWorkItem: ApiRecord;
  needsActionEscalationTask: ApiRecord;
  failedWorkflow: ApiRecord;
}

export interface SeededLaunchDialogScenario {
  workspaces: ApiRecord[];
  playbooks: ApiRecord[];
}

export async function seedWorkflowsScenario(options: { bulkWorkflowCount?: number } = {}): Promise<SeededWorkflowsScenario> {
  await resetWorkflowsState();
  await updateAgenticSettings('enhanced');
  const suffix = Date.now().toString(36);
  const workspaceName = `Workflows Workspace ${suffix}`;
  const workspace = await apiRequest<ApiRecord>('/api/v1/workspaces', {
    method: 'POST',
    body: {
      name: workspaceName,
      slug: `workflows-${suffix}`,
      description: 'Seeded workspace for workflows Playwright coverage.',
    },
  });
  const plannedPlaybook = await createPlaybook({
    name: `Planned Workflows ${suffix}`,
    slug: `planned-workflows-${suffix}`,
    lifecycle: 'planned',
  });
  const ongoingPlaybook = await createPlaybook({
    name: `Ongoing Workflows ${suffix}`,
    slug: `ongoing-workflows-${suffix}`,
    lifecycle: 'ongoing',
  });

  const plannedWorkflow = await createWorkflowViaApi({
    name: 'E2E Planned Terminal Brief',
    playbookId: plannedPlaybook.id,
    workspaceId: workspace.id,
    lifecycle: 'planned',
    state: 'completed',
    currentStage: 'delivery',
    parameters: { workflow_goal: 'Publish a terminal brief with deliverables.' },
  });
  await createWorkItem(plannedWorkflow.id, {
    title: 'Publish terminal brief',
    goal: 'Finalize the workflow outcome brief.',
    acceptance_criteria: 'A final deliverable is available.',
    stage_name: 'delivery',
    column_id: SEED_BOARD_COLUMNS.done,
    owner_role: 'publisher',
    priority: 'high',
    completed_at: new Date().toISOString(),
  });
  await createWorkflowDocumentRecord({
    workflowId: plannedWorkflow.id,
    workspaceId: workspace.id,
    logicalName: 'terminal-brief',
    source: 'external',
    title: 'Terminal brief',
    description: 'Seeded final deliverable for workflow observations.',
    location: 'https://example.com/terminal-brief',
  });
  await appendWorkflowEvent(plannedWorkflow.id, 'workflow.output_published', {
    headline: 'Historical record',
    summary: 'Terminal brief published to the deliverables panel.',
  });

  const ongoingWorkflow = await createWorkflowViaApi({
    name: 'E2E Ongoing Intake',
    playbookId: ongoingPlaybook.id,
    workspaceId: workspace.id,
    lifecycle: 'ongoing',
    state: 'active',
    seedHeartbeatGuard: true,
    parameters: { workflow_goal: 'Keep intake work active with live workflow updates.' },
  });
  const ongoingWorkItem = await createWorkItem(ongoingWorkflow.id, {
    title: 'Triage intake queue',
    goal: 'Keep new intake work moving.',
    acceptance_criteria: 'Intake work remains active.',
    stage_name: 'intake',
    column_id: SEED_BOARD_COLUMNS.active,
    owner_role: 'intake-analyst',
    priority: 'high',
  });
  await createTask({
    workflowId: ongoingWorkflow.id,
    workspaceId: workspace.id,
    workItemId: ongoingWorkItem.id,
    stageName: 'intake',
    title: 'Triage intake queue',
    role: 'intake-analyst',
    state: 'in_progress',
    description: 'Seeded in-flight specialist task for deterministic live-console coverage.',
  });
  await clearWorkflowHeartbeatGuard(ongoingWorkflow.id);
  await appendWorkflowExecutionTurn({
    workflowId: ongoingWorkflow.id,
    workflowName: 'E2E Ongoing Intake',
    workspaceId: workspace.id,
    workspaceName,
    workItemId: ongoingWorkItem.id,
    taskTitle: 'Triage intake queue',
    stageName: 'intake',
    role: 'intake-analyst',
    actorName: 'Intake Analyst',
    headline: 'Initial execution burst',
  });
  await appendWorkflowBrief({
    workflowId: ongoingWorkflow.id,
    workItemId: ongoingWorkItem.id,
    executionContextId: ongoingWorkItem.id,
    headline: 'Shift handoff',
    summary: 'Workflow Created',
    sourceKind: 'specialist',
    sourceRoleName: 'Intake Analyst',
  });
  await appendWorkflowEvent(ongoingWorkflow.id, 'workflow.created', {
    headline: 'Initial execution burst',
    summary: 'Fresh workflow work entered the live console.',
  });
  await appendWorkflowEvent(ongoingWorkflow.id, 'workflow.handoff_recorded', {
    headline: 'Shift handoff',
    summary: 'Workflow Created',
  });
  const ongoingSecondaryWorkItem = await createWorkItem(ongoingWorkflow.id, {
    title: 'Triage overflow queue',
    goal: 'Keep overflow intake work moving.',
    acceptance_criteria: 'Overflow intake remains attributable in scoped operator history.',
    stage_name: 'intake',
    column_id: SEED_BOARD_COLUMNS.active,
    owner_role: 'intake-analyst',
    priority: 'high',
  });
  const ongoingSecondaryTask = await createTask({
    workflowId: ongoingWorkflow.id,
    workspaceId: workspace.id,
    workItemId: ongoingSecondaryWorkItem.id,
    stageName: 'intake',
    title: 'Triage overflow queue',
    role: 'intake-analyst',
    state: 'in_progress',
    description: 'Seeded overflow intake task for scoped brief attribution coverage.',
  });
  await appendWorkflowBrief({
    workflowId: ongoingWorkflow.id,
    executionContextId: ongoingSecondaryTask.id,
    headline: 'Overflow queue brief',
    summary: 'Task-linked brief for the overflow intake work item.',
    sourceKind: 'specialist',
    sourceRoleName: 'Intake Analyst',
    linkedTargetIds: [ongoingWorkflow.id, ongoingSecondaryTask.id],
  });

  const pausedWorkflow = await createWorkflowViaApi({
    name: 'E2E Paused Intake Review',
    playbookId: ongoingPlaybook.id,
    workspaceId: workspace.id,
    lifecycle: 'ongoing',
    state: 'paused',
    parameters: { workflow_goal: 'Keep the intake review paused without dropping it back to planned.' },
  });
  const pausedWorkItem = await createWorkItem(pausedWorkflow.id, {
    title: 'Paused intake review',
    goal: 'Hold the intake review in its current active lane.',
    acceptance_criteria: 'The work item remains paused until resumed.',
    stage_name: 'intake',
    column_id: SEED_BOARD_COLUMNS.active,
    owner_role: 'intake-analyst',
    priority: 'high',
    metadata: {
      pause_requested_at: new Date().toISOString(),
    },
  });

  const cancelledWorkflow = await createWorkflowViaApi({
    name: 'E2E Cancelled Packet Review',
    playbookId: plannedPlaybook.id,
    workspaceId: workspace.id,
    lifecycle: 'planned',
    state: 'cancelled',
    currentStage: 'delivery',
    parameters: { workflow_goal: 'Keep cancelled work terminal and out of planned.' },
  });
  const cancelledWorkItem = await createWorkItem(cancelledWorkflow.id, {
    title: 'Cancelled packet review',
    goal: 'Ensure cancelled work stays terminal.',
    acceptance_criteria: 'The cancelled work item is visibly terminal.',
    stage_name: 'delivery',
    column_id: SEED_BOARD_COLUMNS.active,
    owner_role: 'reviewer',
    priority: 'high',
    completed_at: new Date().toISOString(),
    metadata: {
      cancel_requested_at: new Date().toISOString(),
    },
  });

  const orchestratorOnlyWorkflow = await createWorkflowViaApi({
    name: 'E2E Orchestrator Setup',
    playbookId: ongoingPlaybook.id,
    workspaceId: workspace.id,
    lifecycle: 'ongoing',
    state: 'active',
    seedHeartbeatGuard: true,
    parameters: { workflow_goal: 'Surface orchestrator-only routing without fake board work.' },
  });

  const needsActionWorkflow = await createWorkflowViaApi({
    name: 'E2E Needs Action Delivery',
    playbookId: plannedPlaybook.id,
    workspaceId: workspace.id,
    lifecycle: 'planned',
    state: 'active',
    currentStage: 'delivery',
    seedHeartbeatGuard: true,
    parameters: { workflow_goal: 'Surface operator action in the workflows workbench.' },
  });
  await createWorkflowInputPacketRecord({
    workflowId: needsActionWorkflow.id,
    packetKind: 'launch',
    summary: 'Seeded launch packet',
    files: [buildUploadFile('brief.md', '# Seed brief\nBlocked workflow context.\n')],
  });
  const blockedWorkItem = await createWorkItem(needsActionWorkflow.id, {
    title: 'Prepare blocked release brief',
    goal: 'Prepare the blocked release brief.',
    acceptance_criteria: 'Release brief is ready for review.',
    stage_name: 'delivery',
    column_id: SEED_BOARD_COLUMNS.blocked,
    owner_role: 'developer',
    priority: 'critical',
    notes: 'Seeded blocked work item.',
  });
  await blockWorkItem(
    blockedWorkItem.id,
    'Waiting on rollback guidance',
    'operator',
    'Provide rollback guidance',
    { escalationStatus: 'open' },
  );
  const needsActionEscalationTask = await createTask({
    workflowId: needsActionWorkflow.id,
    workspaceId: workspace.id,
    workItemId: blockedWorkItem.id,
    stageName: 'delivery',
    title: 'Resolve replay mismatch before handoff',
    role: 'developer',
    state: 'escalated',
    description: 'Persisted handoff exists and the release summary is already written.',
    metadata: {
      escalation_reason: 'submit_handoff replay mismatch conflict',
      escalation_context: 'Persisted handoff exists and the release summary is already written.',
      escalation_work_so_far:
        'Reviewed the current attempt, compared request ids, and identified the replay mismatch.',
      escalation_context_packet: {
        conflicting_request_ids: {
          submitted_request_id: 'handoff:seeded-submitted',
          persisted_request_id: 'handoff:seeded-persisted',
          current_attempt_request_id: 'handoff:seeded-current-attempt',
        },
        existing_handoff: {
          summary: 'Release summary is already persisted for operator review.',
          request_id: 'handoff:seeded-persisted',
          completion_state: 'full',
        },
        task_contract_satisfied_by_persisted_handoff: true,
      },
    },
  });
  await createTask({
    workflowId: needsActionWorkflow.id,
    workspaceId: workspace.id,
    workItemId: blockedWorkItem.id,
    stageName: 'delivery',
    title: 'Hold release packet while operator guidance is pending',
    role: 'developer',
    state: 'claimed',
    description: 'Seeded active specialist claim to keep deterministic workflows idle-free without dispatching runtime work.',
  });
  await clearWorkflowHeartbeatGuard(needsActionWorkflow.id);
  await createWorkflowDocumentRecord({
    workflowId: needsActionWorkflow.id,
    workspaceId: workspace.id,
    logicalName: 'release-brief',
    source: 'external',
    title: 'Release brief',
    description: 'Seeded release brief for workflows deliverables.',
    location: 'https://example.com/release-brief',
  });
  await appendWorkflowEvent(needsActionWorkflow.id, 'workflow.blocked', {
    headline: 'Operator attention required',
    summary: 'Historical record',
  });

  const failedWorkflow = await createWorkflowViaApi({
    name: 'E2E Redrive Candidate',
    playbookId: plannedPlaybook.id,
    workspaceId: workspace.id,
    lifecycle: 'planned',
    state: 'failed',
    parameters: { workflow_goal: 'Recover the failed validation workflow.' },
  });
  await appendWorkflowEvent(failedWorkflow.id, 'workflow.failed', {
    headline: 'Validation run failed',
    summary: 'Workflow failed after validation timeout.',
  });

  await seedBulkWorkflows(options.bulkWorkflowCount ?? 0, plannedPlaybook.id, workspace.id);
  const scenario = {
    workspace,
    plannedPlaybook,
    ongoingPlaybook,
    plannedWorkflow,
    ongoingWorkflow,
    ongoingWorkItem,
    ongoingSecondaryWorkItem,
    pausedWorkflow,
    pausedWorkItem,
    cancelledWorkflow,
    cancelledWorkItem,
    orchestratorOnlyWorkflow,
    needsActionWorkflow,
    needsActionWorkItem: blockedWorkItem,
    needsActionEscalationTask,
    failedWorkflow,
  };
  clearFixtureWorkflowActivations();
  assertSeededScenarioIsInert();
  return scenario;
}

export async function seedLaunchDialogScenario(options: {
  playbookCount?: number;
  workspaceCount?: number;
} = {}): Promise<SeededLaunchDialogScenario> {
  await resetWorkflowsState();
  const suffix = Date.now().toString(36);
  const playbookCount = Math.max(options.playbookCount ?? 26, 2);
  const workspaceCount = Math.max(options.workspaceCount ?? 26, 2);

  const workspaces = await Promise.all(
    Array.from({ length: workspaceCount }, async (_, index) =>
      apiRequest<ApiRecord>('/api/v1/workspaces', {
        method: 'POST',
        body: {
          name: `Launch Workspace ${index + 1} ${suffix}`,
          slug: `workflows-launch-${suffix}-${String(index + 1).padStart(2, '0')}`,
          description: 'Seeded workspace for launch-dialog selector coverage.',
        },
      }),
    ),
  );

  const playbooks = await Promise.all(
    Array.from({ length: playbookCount }, async (_, index) => {
      const lifecycle = index % 2 === 0 ? 'planned' : 'ongoing';
      const prefix = lifecycle === 'planned' ? 'planned-workflows' : 'ongoing-workflows';
      return createPlaybook({
        name: `Launch Playbook ${index + 1} ${suffix}`,
        slug: `${prefix}-launch-${suffix}-${String(index + 1).padStart(2, '0')}`,
        lifecycle,
      });
    }),
  );

  return { workspaces, playbooks };
}

export async function createWorkflowViaApi(input: {
  name: string;
  playbookId: string;
  workspaceId: string;
  lifecycle?: 'planned' | 'ongoing';
  state?: 'pending' | 'active' | 'paused' | 'completed' | 'failed' | 'cancelled';
  currentStage?: string;
  parameters: Record<string, unknown>;
  seedHeartbeatGuard?: boolean;
}): Promise<ApiRecord> {
  const workflowId = randomUUID();
  const lifecycle = input.lifecycle ?? 'planned';
  const state = input.state ?? 'pending';
  runPsql(`
    INSERT INTO public.workflows (
      id,
      tenant_id,
      workspace_id,
      playbook_id,
      playbook_version,
      name,
      state,
      lifecycle,
      current_stage,
      parameters,
      metadata,
      created_at,
      updated_at
    )
    VALUES (
      ${sqlUuid(workflowId)},
      ${sqlUuid(DEFAULT_TENANT_ID)},
      ${sqlUuid(input.workspaceId)},
      ${sqlUuid(input.playbookId)},
      1,
      ${sqlText(input.name)},
      ${sqlText(state)}::workflow_state,
      ${sqlText(lifecycle)},
      ${input.currentStage ? sqlText(input.currentStage) : 'NULL'},
      ${sqlJsonValue(input.parameters)}::jsonb,
      '{}'::jsonb,
      NOW(),
      NOW()
    );

    ${input.seedHeartbeatGuard ? `
    INSERT INTO public.tasks (
      id,
      tenant_id,
      workflow_id,
      work_item_id,
      workspace_id,
      title,
      role,
      stage_name,
      priority,
      state,
      state_changed_at,
      input,
      context,
      metadata,
      created_at,
      updated_at
    )
    VALUES (
      ${sqlUuid(randomUUID())},
      ${sqlUuid(DEFAULT_TENANT_ID)},
      ${sqlUuid(workflowId)},
      NULL,
      ${sqlUuid(input.workspaceId)},
      'Seed heartbeat guard',
      'seed-guard',
      ${input.currentStage ? sqlText(input.currentStage) : sqlText('delivery')},
      'normal'::task_priority,
      'claimed'::task_state,
      NOW(),
      '{}'::jsonb,
      '{}'::jsonb,
      ${sqlJsonValue({ seeded_heartbeat_guard: true })}::jsonb,
      NOW(),
      NOW()
    );` : ''}

    INSERT INTO public.workflow_stages (
      id,
      tenant_id,
      workflow_id,
      name,
      position,
      goal,
      status,
      gate_status,
      created_at,
      updated_at
    )
    VALUES
      ${SEED_STAGE_DEFINITIONS.map((stage) => `(
        ${sqlUuid(randomUUID())},
        ${sqlUuid(DEFAULT_TENANT_ID)},
        ${sqlUuid(workflowId)},
        ${sqlText(stage.name)},
        ${stage.position},
        ${sqlText(stage.goal)},
        ${sqlText(resolveSeedStageStatus({ lifecycle, state, currentStage: input.currentStage }, stage.name))},
        'not_requested',
        NOW(),
        NOW()
      )`).join(',\n      ')};
  `);
  return { id: workflowId, name: input.name };
}

export async function listWorkflowInputPackets(workflowId: string): Promise<Array<Record<string, unknown>>> {
  return apiRequest(`/api/v1/workflows/${workflowId}/input-packets`);
}

export async function createSeededWorkflowWorkItem(
  workflowId: string,
  body: Record<string, unknown>,
): Promise<ApiRecord> {
  return createWorkItem(workflowId, body);
}

export async function createSeededWorkflowInputPacket(input: {
  workflowId: string;
  workItemId?: string;
  packetKind: string;
  summary: string;
  structuredInputs: Record<string, unknown>;
  files?: Array<{
    fileName: string;
    content: string;
    contentType?: string;
  }>;
}): Promise<void> {
  return createWorkflowInputPacketRecord({
    workflowId: input.workflowId,
    workItemId: input.workItemId,
    packetKind: input.packetKind,
    summary: input.summary,
    structuredInputs: input.structuredInputs,
    files: (input.files ?? []).map((file) => ({
      fileName: file.fileName,
      content: file.content,
      contentType: file.contentType ?? 'text/plain',
    })),
  });
}

export async function listWorkflows(): Promise<Array<Record<string, unknown>>> {
  return apiRequest('/api/v1/workflows');
}

export async function appendWorkflowEvent(workflowId: string, eventType: string, data: Record<string, unknown>): Promise<void> {
  runPsql(`
    INSERT INTO public.events (tenant_id, type, entity_type, entity_id, actor_type, actor_id, data)
    VALUES (
      '${DEFAULT_TENANT_ID}',
      ${sqlText(eventType)},
      'workflow',
      ${sqlText(workflowId)}::uuid,
      'admin',
      'playwright',
      ${sqlJsonValue({ workflow_id: workflowId, ...data })}::jsonb
    );
  `);
}

export async function appendWorkflowExecutionTurn(input: {
  workflowId: string;
  workflowName: string;
  workspaceId: string;
  workspaceName: string;
  workItemId: string;
  taskTitle: string;
  stageName: string;
  role: string;
  actorName: string;
  headline: string;
}): Promise<void> {
  runPsql(`
    SELECT create_execution_logs_partition(CURRENT_DATE);

    INSERT INTO public.execution_logs (
      tenant_id, trace_id, span_id,
      source, category, level, operation, status, payload,
      workspace_id, workflow_id, workflow_name, workspace_name,
      work_item_id, task_title, stage_name, is_orchestrator_task,
      role, actor_type, actor_id, actor_name,
      created_at
    )
    VALUES (
      '${DEFAULT_TENANT_ID}'::uuid,
      '${randomUUID()}'::uuid,
      '${randomUUID()}'::uuid,
      'runtime',
      'agent_loop',
      'info',
      'agent.plan',
      'completed',
      ${sqlJsonValue({ summary: input.headline })}::jsonb,
      ${sqlUuid(input.workspaceId)},
      ${sqlUuid(input.workflowId)},
      ${sqlText(input.workflowName)},
      ${sqlText(input.workspaceName)},
      ${sqlUuid(input.workItemId)},
      ${sqlText(input.taskTitle)},
      ${sqlText(input.stageName)},
      FALSE,
      ${sqlText(input.role)},
      'runtime',
      ${sqlText(`playwright:${input.role}`)},
      ${sqlText(input.actorName)},
      NOW()
    );
  `);
}

async function appendWorkflowBrief(input: {
  workflowId: string;
  workItemId?: string;
  taskId?: string;
  executionContextId: string;
  headline: string;
  summary: string;
  sourceKind: string;
  sourceRoleName: string;
  linkedTargetIds?: string[];
}): Promise<void> {
  const requestId = `playwright-brief:${input.workflowId}:${input.executionContextId}:${createHash('sha1')
    .update(input.headline)
    .digest('hex')
    .slice(0, 12)}`;
  runPsql(`
    INSERT INTO public.workflow_operator_briefs (
      id, tenant_id, workflow_id, work_item_id, task_id,
      request_id, execution_context_id,
      brief_kind, brief_scope, source_kind, source_role_name, llm_turn_count, status_kind,
      short_brief, detailed_brief_json, linked_target_ids, sequence_number,
      related_artifact_ids, related_output_descriptor_ids, related_intervention_ids,
      canonical_workflow_brief_id, created_by_type, created_by_id, created_at, updated_at
    )
    VALUES (
      '${randomUUID()}'::uuid,
      '${DEFAULT_TENANT_ID}'::uuid,
      ${sqlUuid(input.workflowId)},
      ${input.workItemId ? sqlUuid(input.workItemId) : 'NULL'},
      ${input.taskId ? sqlUuid(input.taskId) : 'NULL'},
      ${sqlText(requestId)},
      ${sqlText(input.executionContextId)},
      'milestone',
      'workflow_timeline',
      ${sqlText(input.sourceKind)},
      ${sqlText(input.sourceRoleName)},
      NULL,
      'handoff',
      ${sqlJsonValue({ headline: input.headline })}::jsonb,
      ${sqlJsonValue({
        headline: input.headline,
        status_kind: 'handoff',
        summary: input.summary,
      })}::jsonb,
      ${sqlJsonValue(input.linkedTargetIds ?? [input.workflowId, input.workItemId].filter(Boolean))}::jsonb,
      1,
      '[]'::jsonb,
      '[]'::jsonb,
      '[]'::jsonb,
      NULL,
      'admin',
      'playwright',
      NOW(),
      NOW()
    );
  `);
}

async function createPlaybook(input: { name: string; slug: string; lifecycle: 'planned' | 'ongoing' }): Promise<ApiRecord> {
  return apiRequest('/api/v1/playbooks', {
    method: 'POST',
    body: {
      name: input.name,
      slug: input.slug,
      description: `Seeded ${input.lifecycle} playbook for Workflows Playwright coverage.`,
      outcome: 'Ship the requested outcome',
      lifecycle: input.lifecycle,
      definition: {
        process_instructions: 'Capture work, produce outputs, and preserve operator recovery paths.',
        lifecycle: input.lifecycle,
        board: {
          columns: [
            { id: 'planned', label: 'Planned' },
            { id: 'doing', label: 'Doing' },
            { id: 'blocked', label: 'Blocked', is_blocked: true },
            { id: 'done', label: 'Done', is_terminal: true },
          ],
        },
        stages: SEED_STAGE_DEFINITIONS.map((stage) => ({ name: stage.name, goal: stage.goal })),
        parameters: [{ slug: 'workflow_goal', title: 'Workflow Goal', required: true }],
      },
    },
  });
}

async function createWorkflowDocumentRecord(input: {
  workflowId: string;
  workspaceId: string;
  logicalName: string;
  source: 'external' | 'artifact' | 'repository';
  title: string;
  description: string;
  location: string;
}): Promise<void> {
  runPsql(`
    INSERT INTO public.workflow_documents (
      id,
      tenant_id,
      workflow_id,
      workspace_id,
      task_id,
      logical_name,
      source,
      location,
      artifact_id,
      content_type,
      title,
      description,
      metadata,
      created_at
    )
    VALUES (
      ${sqlUuid(randomUUID())},
      ${sqlUuid(DEFAULT_TENANT_ID)},
      ${sqlUuid(input.workflowId)},
      ${sqlUuid(input.workspaceId)},
      NULL,
      ${sqlText(input.logicalName)},
      ${sqlText(input.source)},
      ${sqlText(input.location)},
      NULL,
      NULL,
      ${sqlText(input.title)},
      ${sqlText(input.description)},
      '{}'::jsonb,
      NOW()
    );
  `);
}

async function createWorkflowInputPacketRecord(input: {
  workflowId: string;
  workItemId?: string;
  packetKind: string;
  summary: string;
  structuredInputs?: Record<string, unknown>;
  files: WorkflowPacketSeedFile[];
}): Promise<void> {
  const packetId = randomUUID();
  runPsql(`
    INSERT INTO public.workflow_input_packets (
      id,
      tenant_id,
      workflow_id,
      work_item_id,
      request_id,
      source_intervention_id,
      source_attempt_id,
      packet_kind,
      source,
      summary,
      structured_inputs,
      metadata,
      created_by_kind,
      created_by_type,
      created_by_id,
      created_at,
      updated_at
    )
    VALUES (
      ${sqlUuid(packetId)},
      ${sqlUuid(DEFAULT_TENANT_ID)},
      ${sqlUuid(input.workflowId)},
      ${input.workItemId ? sqlUuid(input.workItemId) : 'NULL'},
      ${sqlText(`playwright-packet:${packetId}`)},
      NULL,
      NULL,
      ${sqlText(input.packetKind)},
      'operator',
      ${sqlText(input.summary)},
      ${sqlJsonValue(input.structuredInputs ?? {})}::jsonb,
      '{}'::jsonb,
      'operator',
      'admin',
      'playwright',
      NOW(),
      NOW()
    );
  `);

  for (const file of input.files) {
    createWorkflowInputPacketFileRecord({
      workflowId: input.workflowId,
      packetId,
      file,
    });
  }
}

async function createWorkItem(workflowId: string, body: Record<string, unknown>): Promise<ApiRecord> {
  const workItemId = randomUUID();
  runPsql(`
    INSERT INTO public.workflow_work_items (
      id,
      tenant_id,
      workflow_id,
      stage_name,
      title,
      goal,
      acceptance_criteria,
      column_id,
      owner_role,
      priority,
      notes,
      request_id,
      completed_at,
      metadata,
      created_at,
      updated_at
    )
    VALUES (
      ${sqlUuid(workItemId)},
      ${sqlUuid(DEFAULT_TENANT_ID)},
      ${sqlUuid(workflowId)},
      ${sqlText(String(body.stage_name ?? 'delivery'))},
      ${sqlText(String(body.title ?? 'Untitled work item'))},
      ${body.goal ? sqlText(String(body.goal)) : 'NULL'},
      ${body.acceptance_criteria ? sqlText(String(body.acceptance_criteria)) : 'NULL'},
      ${sqlText(String(body.column_id ?? SEED_BOARD_COLUMNS.planned))},
      ${body.owner_role ? sqlText(String(body.owner_role)) : 'NULL'},
      ${sqlText(String(body.priority ?? 'normal'))}::task_priority,
      ${body.notes ? sqlText(String(body.notes)) : 'NULL'},
      ${sqlText(randomUUID())},
      ${body.completed_at ? `${sqlText(String(body.completed_at))}::timestamptz` : 'NULL'},
      ${sqlJsonValue(body.metadata ?? {})}::jsonb,
      NOW(),
      NOW()
    );
  `);
  return { id: workItemId, title: String(body.title ?? 'Untitled work item'), workflow_id: workflowId };
}

async function createTask(input: {
  workflowId: string;
  workspaceId: string;
  workItemId: string;
  stageName: string;
  title: string;
  role: string;
  state: 'claimed' | 'in_progress' | 'escalated' | 'awaiting_approval' | 'output_pending_assessment' | 'failed';
  description?: string;
  input?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}): Promise<ApiRecord> {
  const taskId = randomUUID();
  runPsql(`
    INSERT INTO public.tasks (
      id,
      tenant_id,
      workflow_id,
      workspace_id,
      work_item_id,
      stage_name,
      title,
      role,
      state,
      state_changed_at,
      input,
      metadata,
      created_at,
      updated_at,
      context
    )
    VALUES (
      ${sqlUuid(taskId)},
      ${sqlUuid(DEFAULT_TENANT_ID)},
      ${sqlUuid(input.workflowId)},
      ${sqlUuid(input.workspaceId)},
      ${sqlUuid(input.workItemId)},
      ${sqlText(input.stageName)},
      ${sqlText(input.title)},
      ${sqlText(input.role)},
      ${sqlText(input.state)}::task_state,
      NOW(),
      ${sqlJsonValue(input.input ?? {})}::jsonb,
      ${sqlJsonValue({
        ...(input.metadata ?? {}),
        ...(input.description ? { description: input.description } : {}),
      })}::jsonb,
      NOW(),
      NOW(),
      '{}'::jsonb
    );
  `);
  return { id: taskId, title: input.title, workflow_id: input.workflowId };
}

async function seedBulkWorkflows(count: number, playbookId: string, workspaceId: string): Promise<void> {
  const sql = buildBulkWorkflowInsertSql({
    tenantId: DEFAULT_TENANT_ID,
    workspaceId,
    playbookId,
    count,
  });
  if (!sql) {
    return;
  }
  runPsql(sql);
}

async function updateAgenticSettings(mode: 'standard' | 'enhanced'): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const current = await apiRequest<{ revision: number }>('/api/v1/agentic-settings');
    try {
      await apiRequest('/api/v1/agentic-settings', {
        method: 'PATCH',
        body: { live_visibility_mode_default: mode, settings_revision: current.revision },
      });
      return;
    } catch (error) {
      if (attempt === 1 || !isRevisionConflict(error)) {
        throw error;
      }
    }
  }
}

async function apiRequest<T>(path: string, init: { method?: string; body?: Record<string, unknown> } = {}): Promise<T> {
  const response = await fetch(`${PLATFORM_API_URL}${path}`, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${ADMIN_API_KEY}` },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  if (!response.ok) {
    throw new Error(`API request failed ${init.method ?? 'GET'} ${path}: ${response.status} ${await response.text()}`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  const payload = (await response.json()) as { data: T };
  return payload.data;
}

async function blockWorkItem(
  workItemId: string,
  reason: string,
  actor: string,
  action: string,
  options: { escalationStatus?: 'open' | 'resolved' } = {},
): Promise<void> {
  runPsql(`
    UPDATE public.workflow_work_items
       SET blocked_state = 'blocked',
           blocked_reason = ${sqlText(reason)},
           next_expected_actor = ${sqlText(actor)},
           next_expected_action = ${sqlText(action)},
           escalation_status = ${options.escalationStatus ? sqlText(options.escalationStatus) : 'NULL'},
           updated_at = NOW()
     WHERE id = ${sqlText(workItemId)};
  `);
}

async function setWorkflowState(workflowId: string, state: string): Promise<void> {
  runPsql(`
    UPDATE public.workflows
       SET state = ${sqlText(state)}::workflow_state,
           updated_at = NOW()
     WHERE id = ${sqlText(workflowId)};
  `);
}

async function setWorkflowCurrentStage(workflowId: string, stageName: string): Promise<void> {
  runPsql(`
    UPDATE public.workflows
       SET current_stage = ${sqlText(stageName)},
           updated_at = NOW()
     WHERE id = ${sqlText(workflowId)};
  `);
}

async function clearWorkflowHeartbeatGuard(workflowId: string): Promise<void> {
  runPsql(`
    DELETE FROM public.tasks
     WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
       AND workflow_id = ${sqlUuid(workflowId)}
       AND metadata->>'seeded_heartbeat_guard' = 'true';
  `);
}

function runPsql(sql: string): void {
  execFileSync(
    'docker',
    ['exec', '-i', POSTGRES_CONTAINER_NAME, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', POSTGRES_USER, '-d', POSTGRES_DB],
    { input: sql, encoding: 'utf8' },
  );
}

function createWorkflowInputPacketFileRecord(input: {
  workflowId: string;
  packetId: string;
  file: WorkflowPacketSeedFile;
}): void {
  const fileId = randomUUID();
  const payload = Buffer.from(input.file.content, 'utf8');
  const storageKey = buildSeedWorkflowOperatorStorageKey({
    workflowId: input.workflowId,
    packetId: input.packetId,
    fileId,
    fileName: input.file.fileName,
  });
  const checksumSha256 = createHash('sha256').update(payload).digest('hex');
  writeSeededArtifactObject(storageKey, payload, input.file.contentType);
  runPsql(`
    INSERT INTO public.workflow_input_packet_files (
      id,
      tenant_id,
      workflow_id,
      packet_id,
      file_name,
      description,
      storage_backend,
      storage_key,
      content_type,
      size_bytes,
      checksum_sha256,
      created_at
    )
    VALUES (
      ${sqlUuid(fileId)},
      ${sqlUuid(DEFAULT_TENANT_ID)},
      ${sqlUuid(input.workflowId)},
      ${sqlUuid(input.packetId)},
      ${sqlText(input.file.fileName)},
      NULL,
      'local',
      ${sqlText(storageKey)},
      ${sqlText(input.file.contentType)},
      ${payload.byteLength},
      ${sqlText(checksumSha256)},
      NOW()
    );
  `);
}

function assertSeededScenarioIsInert(): void {
  const activationCount = countFixtureWorkflowActivations();
  if (activationCount !== 0) {
    throw new Error(`Deterministic workflow seed created ${activationCount} workflow activations.`);
  }

  const runtimeNames = listSpecialistRuntimeContainers();
  if (runtimeNames.length > 0) {
    throw new Error(
      `Deterministic workflow seed started specialist runtime containers: ${runtimeNames.join(', ')}`,
    );
  }
}

function clearFixtureWorkflowActivations(): void {
  runPsql(`
    DELETE FROM public.workflow_activations
     WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
       AND workflow_id IN (
         SELECT id
           FROM public.workflows
          WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
            AND COALESCE(name, '') LIKE 'E2E %'
       );
  `);
}

function countFixtureWorkflowActivations(): number {
  const sql = `
    SELECT COUNT(*)
      FROM workflow_activations wa
      JOIN workflows w ON w.id = wa.workflow_id
     WHERE w.tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
       AND w.name LIKE 'E2E %';
  `;
  const output = execFileSync(
    'docker',
    [
      'exec',
      '-i',
      POSTGRES_CONTAINER_NAME,
      'psql',
      '-t',
      '-A',
      '-U',
      POSTGRES_USER,
      '-d',
      POSTGRES_DB,
      '-c',
      sql,
    ],
    { encoding: 'utf8' },
  ).trim();
  return Number.parseInt(output, 10);
}

function listSpecialistRuntimeContainers(): string[] {
  const output = execFileSync(
    'docker',
    ['ps', '--format', '{{.Names}}'],
    { encoding: 'utf8' },
  ).trim();
  return output
    .split('\n')
    .map((name) => name.trim())
    .filter((name) => name.startsWith('runtime-speciali-'));
}

interface WorkflowPacketSeedFile {
  fileName: string;
  content: string;
  contentType: string;
}

function buildUploadFile(fileName: string, content: string): WorkflowPacketSeedFile {
  return {
    fileName,
    content,
    contentType: 'text/markdown',
  };
}

function buildSeedWorkflowOperatorStorageKey(input: {
  workflowId: string;
  packetId: string;
  fileId: string;
  fileName: string;
}): string {
  return [
    'tenants',
    DEFAULT_TENANT_ID,
    'workflows',
    input.workflowId,
    'input-packets',
    input.packetId,
    'files',
    input.fileId,
    input.fileName,
  ].join('/');
}

function writeSeededArtifactObject(storageKey: string, payload: Buffer, contentType: string): void {
  const containerPath = `/artifacts/${storageKey}`;
  execFileSync(
    'docker',
    [
      'exec',
      '-i',
      PLATFORM_API_CONTAINER_NAME,
      'sh',
      '-lc',
      [
        'set -e',
        `mkdir -p ${shellQuote(dirname(containerPath))}`,
        `cat > ${shellQuote(containerPath)}`,
        `printf %s ${shellQuote(contentType)} > ${shellQuote(`${containerPath}.content-type`)}`,
      ].join(' && '),
    ],
    { input: payload },
  );
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

function sqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlUuid(value: string): string {
  return `${sqlText(value)}::uuid`;
}

function resolveSeedStageStatus(
  workflow: { lifecycle: 'planned' | 'ongoing'; state: string; currentStage?: string },
  stageName: string,
): 'pending' | 'active' | 'completed' | 'blocked' {
  if (workflow.state === 'completed') {
    return 'completed';
  }
  if (workflow.lifecycle === 'ongoing') {
    if (workflow.state === 'paused' && workflow.currentStage === stageName) {
      return 'active';
    }
    return stageName === 'intake' ? 'active' : 'pending';
  }
  if (workflow.currentStage === stageName && (workflow.state === 'active' || workflow.state === 'paused')) {
    return 'active';
  }
  if (workflow.currentStage === stageName && workflow.state === 'failed') {
    return 'blocked';
  }
  return workflow.currentStage === 'delivery' && stageName === 'intake'
    ? 'completed'
    : 'pending';
}

function sqlJson(value: Record<string, unknown>): string {
  return sqlJsonValue(value);
}

function sqlJsonValue(value: unknown): string {
  return sqlText(JSON.stringify(value));
}

function isRevisionConflict(error: unknown): boolean {
  return error instanceof Error && error.message.includes('Agentic settings revision is stale');
}
