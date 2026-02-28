import type { DatabaseQueryable } from '../db/database.js';

export async function buildTaskContext(
  db: DatabaseQueryable,
  tenantId: string,
  task: Record<string, unknown>,
  agentId?: string,
) {
  let agent = null;
  if (agentId) {
    const agentRes = await db.query('SELECT id, name, capabilities, metadata FROM agents WHERE tenant_id = $1 AND id = $2', [tenantId, agentId]);
    agent = agentRes.rows[0] ?? null;
  } else if (task.assigned_agent_id) {
    const assignedAgentRes = await db.query(
      'SELECT id, name, capabilities, metadata FROM agents WHERE tenant_id = $1 AND id = $2',
      [tenantId, task.assigned_agent_id],
    );
    agent = assignedAgentRes.rows[0] ?? null;
  }

  const [projectRes, pipelineRes, depsRes] = await Promise.all([
    task.project_id
      ? db.query('SELECT id, name, description, memory FROM projects WHERE tenant_id = $1 AND id = $2', [tenantId, task.project_id])
      : Promise.resolve({ rows: [] }),
    task.pipeline_id
      ? db.query(
          `SELECT p.id, p.name, p.context, p.git_branch, p.parameters,
                  t.id AS template_id, t.slug AS template_slug, t.name AS template_name,
                  t.version AS template_version, t.schema AS template_schema
           FROM pipelines p
           LEFT JOIN templates t ON t.tenant_id = p.tenant_id AND t.id = p.template_id
           WHERE p.tenant_id = $1 AND p.id = $2`,
          [tenantId, task.pipeline_id],
        )
      : Promise.resolve({ rows: [] }),
    (task.depends_on as string[]).length > 0
      ? db.query(
          "SELECT id, role, type, output FROM tasks WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND state = 'completed'",
          [tenantId, task.depends_on],
        )
      : Promise.resolve({ rows: [] }),
  ]);

  const upstreamOutputs = Object.fromEntries(depsRes.rows.map((row) => [row.role ?? row.type ?? row.id, row.output ?? {}]));

  const pipelineRow = pipelineRes.rows[0] as Record<string, unknown> | undefined;
  const templateSchema = (pipelineRow?.template_schema as Record<string, unknown> | undefined) ?? {};
  const pipelineContext = pipelineRow
    ? {
        id: pipelineRow.id,
        name: pipelineRow.name,
        context: pipelineRow.context,
        git_branch: pipelineRow.git_branch,
        variables: pipelineRow.parameters ?? {},
        template: {
          id: pipelineRow.template_id,
          slug: pipelineRow.template_slug,
          name: pipelineRow.template_name,
          version: pipelineRow.template_version,
          metadata: templateSchema.metadata ?? {},
        },
      }
    : null;

  return {
    agent,
    project: projectRes.rows[0] ?? null,
    pipeline: pipelineContext,
    task: {
      id: task.id,
      input: task.input,
      role_config: task.role_config,
      upstream_outputs: upstreamOutputs,
    },
  };
}
