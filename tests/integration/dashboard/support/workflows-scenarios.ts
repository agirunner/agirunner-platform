import {
  SEED_BOARD_COLUMNS,
  buildUploadFile,
} from './workflows-common.js';
import type {
  ApiRecord,
  SeededLaunchDialogScenario,
  SeededWorkflowsScenario,
} from './workflows-common.js';
import {
  appendWorkflowBrief,
  appendWorkflowEvent,
  appendWorkflowExecutionTurn,
  createPlaybook,
  createTask,
  createWorkflowDocumentRecord,
  createWorkflowInputPacketRecord,
  createWorkflowViaApi,
  createWorkItem,
} from './workflows-records.js';
import {
  apiRequest,
  blockWorkItem,
  clearWorkflowHeartbeatGuard,
  seedBulkWorkflows,
  updateAgenticSettings,
} from './workflows-runtime.js';
import {
  assertSeededScenarioIsInert,
  settleFixtureWorkflowActivations,
} from './workflows-validation.js';
import { resetWorkflowsState } from './workflows-fixture-reset.js';

export async function seedWorkflowsScenario(
  options: { bulkWorkflowCount?: number; bulkOngoingWorkflowCount?: number } = {},
): Promise<SeededWorkflowsScenario> {
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

  await seedBulkWorkflows(options.bulkWorkflowCount ?? 0, plannedPlaybook.id, workspace.id, {
    lifecycle: 'planned',
    namePrefix: 'E2E Bulk Workflow',
  });
  await seedBulkWorkflows(options.bulkOngoingWorkflowCount ?? 0, ongoingPlaybook.id, workspace.id, {
    lifecycle: 'ongoing',
    namePrefix: 'E2E Bulk Ongoing Workflow',
  });
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
  await settleFixtureWorkflowActivations();
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
