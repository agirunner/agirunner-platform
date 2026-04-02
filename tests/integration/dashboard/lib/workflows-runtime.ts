import { execFileSync } from 'node:child_process';

import {
  ADMIN_API_KEY,
  DEFAULT_TENANT_ID,
  PLATFORM_API_URL,
  POSTGRES_CONTAINER_NAME,
  POSTGRES_DB,
  POSTGRES_USER,
} from './platform-env.js';
import { prunePlatformWorkflowArtifactDirectories } from './platform-artifacts.js';
import {
  buildBulkWorkflowHeartbeatGuardInsertSql,
  buildBulkWorkflowInsertSql,
} from './workflows-bulk-seed.js';
import { sqlText, sqlUuid } from './workflows-common.js';

export function runPsql(sql: string): string {
  return execFileSync(
    'docker',
    [
      'exec',
      '-i',
      POSTGRES_CONTAINER_NAME,
      'psql',
      '-t',
      '-A',
      '-F',
      '|',
      '-U',
      POSTGRES_USER,
      '-d',
      POSTGRES_DB,
      '-c',
      sql,
    ],
    { encoding: 'utf8' },
  );
}

export async function apiRequest<T>(
  path: string,
  init: { method?: string; body?: Record<string, unknown> } = {},
): Promise<T> {
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

export async function updateAgenticSettings(mode: 'standard' | 'enhanced'): Promise<void> {
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

export async function seedBulkWorkflows(
  count: number,
  playbookId: string,
  workspaceId: string,
  options: {
    lifecycle?: 'planned' | 'ongoing';
    namePrefix?: string;
  } = {},
): Promise<void> {
  const sql = buildBulkWorkflowInsertSql({
    tenantId: DEFAULT_TENANT_ID,
    workspaceId,
    playbookId,
    count,
    lifecycle: options.lifecycle,
    namePrefix: options.namePrefix,
  });
  if (!sql) {
    return;
  }
  runPsql(sql);
  const guardSql = buildBulkWorkflowHeartbeatGuardInsertSql({
    tenantId: DEFAULT_TENANT_ID,
    workspaceId,
    playbookId,
    count,
    lifecycle: options.lifecycle,
    namePrefix: options.namePrefix,
  });
  if (guardSql) {
    runPsql(guardSql);
  }
}

export async function blockWorkItem(
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

export async function setWorkflowState(workflowId: string, state: string): Promise<void> {
  runPsql(`
    UPDATE public.workflows
       SET state = ${sqlText(state)}::workflow_state,
           updated_at = NOW()
     WHERE id = ${sqlText(workflowId)};
  `);
}

export async function setWorkflowCurrentStage(workflowId: string, stageName: string): Promise<void> {
  runPsql(`
    UPDATE public.workflows
       SET current_stage = ${sqlText(stageName)},
           updated_at = NOW()
     WHERE id = ${sqlText(workflowId)};
  `);
}

export async function clearWorkflowHeartbeatGuard(workflowId: string): Promise<void> {
  runPsql(`
    DELETE FROM public.tasks
     WHERE tenant_id = ${sqlUuid(DEFAULT_TENANT_ID)}
       AND workflow_id = ${sqlUuid(workflowId)}
       AND metadata->>'seeded_heartbeat_guard' = 'true';
  `);
}

export function ensureNonLiveRuntimeQuiesced(): void {
  const NON_LIVE_RUNTIME_CONTAINERS = [
    'orchestrator-primary-0',
    'orchestrator-primary-1',
    'agirunner-platform-container-manager-1',
  ] as const;
  const runningContainers = execFileSync(
    'docker',
    ['ps', '--format', '{{.Names}}'],
    { encoding: 'utf8' },
  )
    .split('\n')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const containersToStop = NON_LIVE_RUNTIME_CONTAINERS.filter((name) =>
    runningContainers.includes(name),
  );
  if (containersToStop.length === 0) {
    return;
  }
  execFileSync('docker', ['stop', ...containersToStop], { stdio: 'pipe' });
}

export function pruneOrphanedWorkflowArtifactDirectories(tenantId: string, keepIds: string[]): void {
  prunePlatformWorkflowArtifactDirectories(tenantId, keepIds);
}

function isRevisionConflict(error: unknown): boolean {
  return error instanceof Error && error.message.includes('Agentic settings revision is stale');
}
