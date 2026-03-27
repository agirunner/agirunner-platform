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
}

export interface SeededMissionControlScenario {
  playbook: ApiRecord;
  workspace: ApiRecord;
  activeWorkflow: ApiRecord;
  blockedWorkflow: ApiRecord;
  blockedWorkItem: ApiRecord;
  failedWorkflow: ApiRecord;
}

export async function seedMissionControlScenario(): Promise<SeededMissionControlScenario> {
  await resetMissionControlState();
  const suffix = Date.now().toString(36);
  const workspace = await apiRequest<ApiRecord>('/api/v1/workspaces', {
    method: 'POST',
    body: {
      name: `Mission Control Workspace ${suffix}`,
      slug: `mission-control-${suffix}`,
      description: 'Seeded workspace for Mission Control Playwright coverage.',
    },
  });
  const playbook = await apiRequest<ApiRecord>('/api/v1/playbooks', {
    method: 'POST',
    body: {
      name: `Mission Control Flow ${suffix}`,
      slug: `mission-control-flow-${suffix}`,
      description: 'Seeded Mission Control playbook.',
      outcome: 'Ship the requested outcome',
      lifecycle: 'planned',
      definition: {
        process_instructions: 'Capture work, produce outputs, and preserve operator recovery paths.',
        lifecycle: 'planned',
        board: {
          columns: [
            { id: 'planned', label: 'Planned' },
            { id: 'doing', label: 'Doing' },
            { id: 'blocked', label: 'Blocked' },
            { id: 'done', label: 'Done' },
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

  const activeWorkflow = await createWorkflow(playbook.id, workspace.id, 'E2E In Flight Delivery', 'Ship the in-flight release brief');
  await createWorkItem(activeWorkflow.id, {
    title: 'Draft implementation brief',
    goal: 'Prepare the implementation brief.',
    acceptance_criteria: 'Brief captures the delivery plan.',
    stage_name: 'delivery',
    owner_role: 'developer',
    priority: 'high',
    notes: 'Seeded in-flight work item.',
  });

  const blockedWorkflow = await createWorkflow(playbook.id, workspace.id, 'E2E Blocked Delivery', 'Recover blocked release work');
  await apiRequest(`/api/v1/workflows/${blockedWorkflow.id}/input-packets`, {
    method: 'POST',
    body: {
      packet_kind: 'launch',
      summary: 'Seeded launch packet',
      files: [buildUploadFile('brief.md', '# Seed brief\nBlocked workflow context.\n')],
    },
  });
  const blockedWorkItem = await createWorkItem(blockedWorkflow.id, {
    title: 'Prepare blocked release brief',
    goal: 'Prepare the blocked release brief.',
    acceptance_criteria: 'Release brief is ready for review.',
    stage_name: 'delivery',
    owner_role: 'developer',
    priority: 'critical',
    notes: 'Seeded blocked work item.',
  });
  await blockWorkItem(blockedWorkItem.id, 'Waiting on rollback guidance', 'operator', 'Provide rollback guidance');
  await apiRequest(`/api/v1/workflows/${blockedWorkflow.id}/documents`, {
    method: 'POST',
    body: {
      request_id: randomUUID(),
      logical_name: 'release-brief',
      source: 'external',
      title: 'Release brief',
      description: 'Seeded release brief for Mission Control outputs.',
      url: 'https://example.com/release-brief',
    },
  });
  await insertWorkflowEvent(blockedWorkflow.id, 'workflow.output_published', {
    summary: 'Release brief published for operator review',
    logical_name: 'release-brief',
  });

  const failedWorkflow = await createWorkflow(playbook.id, workspace.id, 'E2E Recovery Candidate', 'Redrive failed validation');
  await setWorkflowState(failedWorkflow.id, 'failed');
  await insertWorkflowEvent(failedWorkflow.id, 'workflow.failed', {
    summary: 'Workflow failed after validation timeout',
    reason: 'Validation timeout',
  });

  return { playbook, workspace, activeWorkflow, blockedWorkflow, blockedWorkItem, failedWorkflow };
}

export async function listWorkflowInputPackets(workflowId: string): Promise<Array<Record<string, unknown>>> {
  return apiRequest(`/api/v1/workflows/${workflowId}/input-packets`);
}

export async function listWorkflowInterventions(workflowId: string): Promise<Array<Record<string, unknown>>> {
  return apiRequest(`/api/v1/workflows/${workflowId}/interventions`);
}

export async function listWorkflows(): Promise<Array<Record<string, unknown>>> {
  return apiRequest('/api/v1/workflows');
}

async function createWorkflow(playbookId: string, workspaceId: string, name: string, goal: string): Promise<ApiRecord> {
  return apiRequest('/api/v1/workflows', {
    method: 'POST',
    body: {
      playbook_id: playbookId,
      workspace_id: workspaceId,
      name,
      parameters: { workflow_goal: goal },
    },
  });
}

async function createWorkItem(workflowId: string, body: Record<string, unknown>): Promise<ApiRecord> {
  return apiRequest(`/api/v1/workflows/${workflowId}/work-items`, {
    method: 'POST',
    body: {
      request_id: randomUUID(),
      ...body,
    },
  });
}

async function resetMissionControlState(): Promise<void> {
  runPsql(`
    DELETE FROM public.api_keys
    WHERE tenant_id = '${DEFAULT_TENANT_ID}'
      AND key_prefix <> 'ar_admin_def';
    TRUNCATE TABLE ${RESET_TABLES.map((table) => `public.${table}`).join(', ')} RESTART IDENTITY CASCADE;
  `);
}

async function apiRequest<T>(path: string, init: { method?: string; body?: Record<string, unknown> } = {}): Promise<T> {
  const response = await fetch(`${PLATFORM_API_URL}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${ADMIN_API_KEY}`,
    },
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

async function insertWorkflowEvent(
  workflowId: string,
  eventType: string,
  data: Record<string, unknown>,
): Promise<void> {
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
