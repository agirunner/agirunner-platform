import { randomUUID } from 'node:crypto';

import { DEFAULT_TENANT_ID } from './platform-env.js';
import {
  SEED_STAGE_DEFINITIONS,
  resolveSeedStageStatus,
  sqlJsonValue,
  sqlText,
  sqlUuid,
} from './workflows-common.js';
import type { ApiRecord } from './workflows-common.js';
import { apiRequest, runPsql } from './workflows-runtime.js';
import {
  createWorkItem,
  createWorkflowInputPacketRecord,
} from './workflows-records-db.js';

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

const DEFAULT_SEED_PLAYBOOK_ROLES = {
  planned: ['developer', 'reviewer', 'publisher'],
  ongoing: ['intake-analyst'],
} as const;

export async function createPlaybook(input: {
  name: string;
  slug: string;
  lifecycle: 'planned' | 'ongoing';
  roles?: string[];
}): Promise<ApiRecord> {
  const roles = normalizeSeedPlaybookRoles(input.roles ?? DEFAULT_SEED_PLAYBOOK_ROLES[input.lifecycle]);
  ensureSeedRolesExist(roles);
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
        roles,
        board: {
          columns: [
            { id: 'planned', label: 'Planned' },
            { id: 'doing', label: 'Doing' },
            { id: 'blocked', label: 'Blocked', is_blocked: true },
            { id: 'done', label: 'Done', is_terminal: true },
          ],
        },
        stages: SEED_STAGE_DEFINITIONS.map((stage) => ({
          name: stage.name,
          goal: stage.goal,
          involves: stage.name === 'intake' ? [roles[0]] : roles,
        })),
        parameters: [{ slug: 'workflow_goal', title: 'Workflow Goal', required: true }],
      },
    },
  });
}

function normalizeSeedPlaybookRoles(roles: readonly string[]): string[] {
  return Array.from(
    new Set(
      roles
        .map((role) => role.trim())
        .filter((role) => role.length > 0),
    ),
  );
}

function ensureSeedRolesExist(roleNames: readonly string[]): void {
  if (roleNames.length === 0) {
    return;
  }

  const valuesSql = roleNames
    .map(
      (roleName) => `(
        ${sqlUuid(randomUUID())},
        ${sqlUuid(DEFAULT_TENANT_ID)},
        ${sqlText(roleName)},
        ${sqlText(`Seeded role definition for ${roleName}.`)},
        ${sqlText(`You are the ${roleName} for deterministic dashboard workflow fixtures.`)},
        ARRAY[]::text[],
        NULL,
        NULL,
        NULL,
        5,
        true,
        1,
        NOW(),
        NOW()
      )`,
    )
    .join(',\n      ');

  runPsql(`
    INSERT INTO public.role_definitions (
      id,
      tenant_id,
      name,
      description,
      system_prompt,
      allowed_tools,
      model_preference,
      verification_strategy,
      escalation_target,
      max_escalation_depth,
      is_active,
      version,
      created_at,
      updated_at
    )
    VALUES
      ${valuesSql}
    ON CONFLICT (tenant_id, name)
    DO UPDATE SET
      is_active = true,
      updated_at = NOW();
  `);
}
