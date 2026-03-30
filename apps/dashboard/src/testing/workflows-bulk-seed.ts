const DEFAULT_BULK_WORKFLOW_BASE_ISO = '2026-01-01T00:00:00.000Z';

export interface WorkflowBulkSeedInput {
  tenantId: string;
  workspaceId: string;
  playbookId: string;
  count: number;
  baseIso?: string;
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
      parameters,
      metadata,
      created_at,
      updated_at
    )
    VALUES
    ${values};
  `;
}

interface WorkflowBulkWorkflowRowInput {
  tenantId: string;
  workspaceId: string;
  playbookId: string;
  index: number;
  createdAtIso: string;
}

function buildBulkWorkflowValueRow(input: WorkflowBulkWorkflowRowInput): string {
  return `(
      gen_random_uuid(),
      ${sqlUuid(input.tenantId)},
      ${sqlUuid(input.workspaceId)},
      ${sqlUuid(input.playbookId)},
      ${sqlText(`E2E Bulk Workflow ${String(input.index).padStart(4, '0')}`)},
      'pending'::public.workflow_state,
      'planned',
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
