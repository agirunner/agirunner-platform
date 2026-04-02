const DEFAULT_BULK_WORKFLOW_BASE_ISO = '2026-01-01T00:00:00.000Z';

export interface WorkflowBulkSeedInput {
  tenantId: string;
  workspaceId: string;
  playbookId: string;
  count: number;
  baseIso?: string;
  lifecycle?: 'planned' | 'ongoing';
  namePrefix?: string;
}

export function buildBulkWorkflowInsertSql(input: WorkflowBulkSeedInput): string {
  if (input.count <= 0) {
    return '';
  }

  const baseTimeMs = Date.parse(input.baseIso ?? DEFAULT_BULK_WORKFLOW_BASE_ISO);
  const values = Array.from({ length: input.count }, (_, index) =>
    buildBulkWorkflowValueRow({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      playbookId: input.playbookId,
      lifecycle: input.lifecycle ?? 'planned',
      namePrefix: input.namePrefix ?? readDefaultBulkWorkflowPrefix(input.lifecycle ?? 'planned'),
      index,
      createdAtIso: new Date(baseTimeMs + (input.count - index) * 1000).toISOString(),
    }),
  ).join(',\n');

  return `
    INSERT INTO public.workflows (
      id,
      tenant_id,
      workspace_id,
      playbook_id,
      name,
      state,
      lifecycle,
      current_stage,
      parameters,
      metadata,
      created_at,
      updated_at
    )
    VALUES
    ${values};
  `;
}

export function buildBulkWorkflowHeartbeatGuardInsertSql(input: WorkflowBulkSeedInput): string {
  if (input.count <= 0 || (input.lifecycle ?? 'planned') !== 'ongoing') {
    return '';
  }

  const namePrefix = input.namePrefix ?? readDefaultBulkWorkflowPrefix('ongoing');
  return `
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
    SELECT
      gen_random_uuid(),
      w.tenant_id,
      w.id,
      NULL,
      w.workspace_id,
      'Seed heartbeat guard',
      'seed-guard',
      COALESCE(w.current_stage, 'delivery'),
      'normal'::task_priority,
      'claimed'::task_state,
      w.updated_at,
      '{}'::jsonb,
      '{}'::jsonb,
      '{"seeded_heartbeat_guard":true}'::jsonb,
      w.created_at,
      w.updated_at
    FROM public.workflows w
    WHERE w.tenant_id = ${sqlUuid(input.tenantId)}
      AND w.workspace_id = ${sqlUuid(input.workspaceId)}
      AND w.playbook_id = ${sqlUuid(input.playbookId)}
      AND w.lifecycle = 'ongoing'
      AND w.name LIKE ${sqlText(`${namePrefix} %`)}
      AND NOT EXISTS (
        SELECT 1
        FROM public.tasks t
        WHERE t.workflow_id = w.id
          AND t.metadata->>'seeded_heartbeat_guard' = 'true'
      );
  `;
}

interface WorkflowBulkWorkflowRowInput {
  tenantId: string;
  workspaceId: string;
  playbookId: string;
  lifecycle: 'planned' | 'ongoing';
  namePrefix: string;
  index: number;
  createdAtIso: string;
}

function buildBulkWorkflowValueRow(input: WorkflowBulkWorkflowRowInput): string {
  const state = readBulkWorkflowState(input.lifecycle, input.index);
  return `(
      gen_random_uuid(),
      ${sqlUuid(input.tenantId)},
      ${sqlUuid(input.workspaceId)},
      ${sqlUuid(input.playbookId)},
      ${sqlText(`${input.namePrefix} ${String(input.index).padStart(4, '0')}`)},
      ${sqlText(state)}::public.workflow_state,
      ${sqlText(input.lifecycle)},
      ${readBulkWorkflowCurrentStageValue(input.lifecycle)},
      ${sqlJsonValue({ workflow_goal: `Keep workflow ${input.index} visible in the workflows rail.` })}::jsonb,
      '{}'::jsonb,
      ${sqlTimestamp(input.createdAtIso)},
      ${sqlTimestamp(input.createdAtIso)}
    )`;
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

function readBulkWorkflowState(
  lifecycle: 'planned' | 'ongoing',
  index: number,
): 'completed' | 'cancelled' | 'failed' | 'active' {
  if (lifecycle === 'ongoing') {
    return 'active';
  }
  switch (index % 3) {
    case 1:
      return 'cancelled';
    case 2:
      return 'failed';
    default:
      return 'completed';
  }
}

function readBulkWorkflowCurrentStageValue(lifecycle: 'planned' | 'ongoing'): string {
  return lifecycle === 'ongoing' ? 'NULL' : sqlText('delivery');
}

function readDefaultBulkWorkflowPrefix(lifecycle: 'planned' | 'ongoing'): string {
  return lifecycle === 'ongoing' ? 'E2E Bulk Ongoing Workflow' : 'E2E Bulk Workflow';
}
