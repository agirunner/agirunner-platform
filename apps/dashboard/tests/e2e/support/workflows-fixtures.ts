import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import {
  ADMIN_API_KEY,
  DEFAULT_TENANT_ID,
  PLATFORM_API_URL,
  POSTGRES_CONTAINER_NAME,
  POSTGRES_DB,
  POSTGRES_USER,
} from './platform-env.js';

const RESET_TABLES = [
  'agents',
  'container_images',
  'events',
  'execution_logs',
  'fleet_events',
  'integration_actions',
  'integration_adapter_deliveries',
  'integration_adapters',
  'integration_resource_links',
  'oauth_states',
  'orchestrator_config',
  'orchestrator_grants',
  'orchestrator_task_messages',
  'platform_instructions',
  'playbooks',
  'workspace_artifact_files',
  'workspace_spec_versions',
  'workspaces',
  'role_definitions',
  'runtime_heartbeats',
  'scheduled_work_item_trigger_invocations',
  'scheduled_work_item_triggers',
  'task_handoffs',
  'tasks',
  'task_tool_results',
  'tool_tags',
  'user_identities',
  'users',
  'webhook_deliveries',
  'webhook_work_item_trigger_invocations',
  'webhook_work_item_triggers',
  'webhooks',
  'worker_actual_state',
  'worker_desired_state',
  'worker_signals',
  'workers',
  'workflow_activations',
  'workflow_artifacts',
  'workflow_documents',
  'workflow_input_packet_files',
  'workflow_input_packets',
  'workflow_intervention_files',
  'workflow_interventions',
  'workflow_steering_messages',
  'workflow_steering_sessions',
  'workflow_stage_gates',
  'workflow_stages',
  'workflow_tool_results',
  'workflow_work_items',
  'workflows',
] as const;

interface ApiRecord {
  id: string;
  name?: string;
  title?: string;
  workflow_id?: string;
  workspace_id?: string;
}

export interface SeededWorkflowsScenario {
  workspace: ApiRecord;
  plannedPlaybook: ApiRecord;
  ongoingPlaybook: ApiRecord;
  plannedWorkflow: ApiRecord;
  ongoingWorkflow: ApiRecord;
  needsActionWorkflow: ApiRecord;
  failedWorkflow: ApiRecord;
}

export async function seedWorkflowsScenario(options: { bulkWorkflowCount?: number } = {}): Promise<SeededWorkflowsScenario> {
  await resetWorkflowsState();
  await updateAgenticSettings('enhanced');
  const suffix = Date.now().toString(36);
  const workspace = await apiRequest<ApiRecord>('/api/v1/workspaces', {
    method: 'POST',
    body: {
      name: `Workflows Workspace ${suffix}`,
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
    parameters: { workflow_goal: 'Publish a terminal brief with deliverables.' },
  });
  await createWorkItem(plannedWorkflow.id, {
    title: 'Publish terminal brief',
    goal: 'Finalize the workflow outcome brief.',
    acceptance_criteria: 'A final deliverable is available.',
    stage_name: 'delivery',
    owner_role: 'publisher',
    priority: 'high',
  });
  await apiRequest(`/api/v1/workflows/${plannedWorkflow.id}/documents`, {
    method: 'POST',
    body: {
      request_id: randomUUID(),
      logical_name: 'terminal-brief',
      source: 'external',
      title: 'Terminal brief',
      description: 'Seeded final deliverable for workflow observations.',
      url: 'https://example.com/terminal-brief',
    },
  });
  await setWorkflowState(plannedWorkflow.id, 'completed');
  await appendWorkflowEvent(plannedWorkflow.id, 'workflow.output_published', {
    headline: 'Historical record',
    summary: 'Terminal brief published to the deliverables panel.',
  });

  const ongoingWorkflow = await createWorkflowViaApi({
    name: 'E2E Ongoing Intake',
    playbookId: ongoingPlaybook.id,
    workspaceId: workspace.id,
    parameters: { workflow_goal: 'Keep intake work active with live workflow updates.' },
  });
  await createWorkItem(ongoingWorkflow.id, {
    title: 'Triage intake queue',
    goal: 'Keep new intake work moving.',
    acceptance_criteria: 'Intake work remains active.',
    stage_name: 'intake',
    owner_role: 'intake-analyst',
    priority: 'high',
  });
  await appendWorkflowEvent(ongoingWorkflow.id, 'workflow.created', {
    headline: 'Initial execution burst',
    summary: 'Fresh workflow work entered the live console.',
  });
  await appendWorkflowEvent(ongoingWorkflow.id, 'workflow.handoff_recorded', {
    headline: 'Shift handoff',
    summary: 'Workflow Created',
  });

  const needsActionWorkflow = await createWorkflowViaApi({
    name: 'E2E Needs Action Delivery',
    playbookId: plannedPlaybook.id,
    workspaceId: workspace.id,
    parameters: { workflow_goal: 'Surface operator action in the workflows workbench.' },
  });
  await apiRequest(`/api/v1/workflows/${needsActionWorkflow.id}/input-packets`, {
    method: 'POST',
    body: {
      packet_kind: 'launch',
      summary: 'Seeded launch packet',
      files: [buildUploadFile('brief.md', '# Seed brief\nBlocked workflow context.\n')],
    },
  });
  const blockedWorkItem = await createWorkItem(needsActionWorkflow.id, {
    title: 'Prepare blocked release brief',
    goal: 'Prepare the blocked release brief.',
    acceptance_criteria: 'Release brief is ready for review.',
    stage_name: 'delivery',
    owner_role: 'developer',
    priority: 'critical',
    notes: 'Seeded blocked work item.',
  });
  await blockWorkItem(blockedWorkItem.id, 'Waiting on rollback guidance', 'operator', 'Provide rollback guidance');
  await apiRequest(`/api/v1/workflows/${needsActionWorkflow.id}/documents`, {
    method: 'POST',
    body: {
      request_id: randomUUID(),
      logical_name: 'release-brief',
      source: 'external',
      title: 'Release brief',
      description: 'Seeded release brief for workflows deliverables.',
      url: 'https://example.com/release-brief',
    },
  });
  await appendWorkflowEvent(needsActionWorkflow.id, 'workflow.blocked', {
    headline: 'Operator attention required',
    summary: 'Historical record',
  });

  const failedWorkflow = await createWorkflowViaApi({
    name: 'E2E Redrive Candidate',
    playbookId: plannedPlaybook.id,
    workspaceId: workspace.id,
    parameters: { workflow_goal: 'Recover the failed validation workflow.' },
  });
  await setWorkflowState(failedWorkflow.id, 'failed');
  await appendWorkflowEvent(failedWorkflow.id, 'workflow.failed', {
    headline: 'Validation run failed',
    summary: 'Workflow failed after validation timeout.',
  });

  await seedBulkWorkflows(options.bulkWorkflowCount ?? 0, plannedPlaybook.id, workspace.id);
  return { workspace, plannedPlaybook, ongoingPlaybook, plannedWorkflow, ongoingWorkflow, needsActionWorkflow, failedWorkflow };
}

export async function createWorkflowViaApi(input: {
  name: string;
  playbookId: string;
  workspaceId: string;
  parameters: Record<string, unknown>;
}): Promise<ApiRecord> {
  return apiRequest('/api/v1/workflows', {
    method: 'POST',
    body: {
      playbook_id: input.playbookId,
      workspace_id: input.workspaceId,
      name: input.name,
      parameters: input.parameters,
    },
  });
}

export async function listWorkflowInputPackets(workflowId: string): Promise<Array<Record<string, unknown>>> {
  return apiRequest(`/api/v1/workflows/${workflowId}/input-packets`);
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
      ${sqlJson({ workflow_id: workflowId, ...data })}::jsonb
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
        stages: [
          { name: 'intake', goal: 'Clarify the request' },
          { name: 'delivery', goal: 'Deliver the requested output' },
        ],
        parameters: [{ slug: 'workflow_goal', title: 'Workflow Goal', required: true }],
      },
    },
  });
}

async function createWorkItem(workflowId: string, body: Record<string, unknown>): Promise<ApiRecord> {
  return apiRequest(`/api/v1/workflows/${workflowId}/work-items`, {
    method: 'POST',
    body: { request_id: randomUUID(), ...body },
  });
}

async function seedBulkWorkflows(count: number, playbookId: string, workspaceId: string): Promise<void> {
  const requests = Array.from({ length: count }, (_, index) =>
    createWorkflowViaApi({
      name: `E2E Bulk Workflow ${String(index).padStart(4, '0')}`,
      playbookId,
      workspaceId,
      parameters: { workflow_goal: `Keep workflow ${index} visible in the workflows rail.` },
    }),
  );
  for (let index = 0; index < requests.length; index += 40) {
    await Promise.all(requests.slice(index, index + 40));
  }
}

async function updateAgenticSettings(mode: 'standard' | 'enhanced'): Promise<void> {
  const current = await apiRequest<{ revision: number }>('/api/v1/agentic-settings');
  await apiRequest('/api/v1/agentic-settings', {
    method: 'PATCH',
    body: { live_visibility_mode_default: mode, settings_revision: current.revision },
  });
}

async function resetWorkflowsState(): Promise<void> {
  runPsql(`
    DELETE FROM public.api_keys WHERE tenant_id = '${DEFAULT_TENANT_ID}' AND key_prefix <> 'ar_admin_def';
    TRUNCATE TABLE ${RESET_TABLES.map((table) => `public.${table}`).join(', ')} RESTART IDENTITY CASCADE;
  `);
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

async function blockWorkItem(workItemId: string, reason: string, actor: string, action: string): Promise<void> {
  runPsql(`
    UPDATE public.workflow_work_items
       SET blocked_state = 'blocked',
           blocked_reason = ${sqlText(reason)},
           next_expected_actor = ${sqlText(actor)},
           next_expected_action = ${sqlText(action)},
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

function runPsql(sql: string): void {
  execFileSync(
    'docker',
    ['exec', '-i', POSTGRES_CONTAINER_NAME, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', POSTGRES_USER, '-d', POSTGRES_DB],
    { input: sql, encoding: 'utf8' },
  );
}

function buildUploadFile(fileName: string, content: string): Record<string, string> {
  return {
    file_name: fileName,
    content_base64: Buffer.from(content, 'utf8').toString('base64'),
    content_type: 'text/markdown',
  };
}

function sqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlJson(value: Record<string, unknown>): string {
  return sqlText(JSON.stringify(value));
}
