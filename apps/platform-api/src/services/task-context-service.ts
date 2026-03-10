import type { DatabaseQueryable } from '../db/database.js';
import { listTaskDocuments } from './document-reference-service.js';
import { normalizeInstructionDocument } from './instruction-policy.js';

export async function buildTaskContext(
  db: DatabaseQueryable,
  tenantId: string,
  task: Record<string, unknown>,
  agentId?: string,
) {
  let agent = null;
  if (agentId) {
    const agentRes = await db.query(
      'SELECT id, name, capabilities, metadata FROM agents WHERE tenant_id = $1 AND id = $2',
      [tenantId, agentId],
    );
    agent = agentRes.rows[0] ?? null;
  } else if (task.assigned_agent_id) {
    const assignedAgentRes = await db.query(
      'SELECT id, name, capabilities, metadata FROM agents WHERE tenant_id = $1 AND id = $2',
      [tenantId, task.assigned_agent_id],
    );
    agent = assignedAgentRes.rows[0] ?? null;
  }

  const [projectRes, workflowRes, depsRes, documents] = await Promise.all([
    task.project_id
      ? db.query(
          'SELECT id, name, description, memory FROM projects WHERE tenant_id = $1 AND id = $2',
          [tenantId, task.project_id],
        )
      : Promise.resolve({ rows: [] }),
    task.workflow_id
      ? db.query(
          `SELECT p.id, p.name, p.context, p.git_branch, p.parameters, p.resolved_config, p.instruction_config,
                  p.project_spec_version,
                  t.id AS template_id, t.slug AS template_slug, t.name AS template_name,
                  t.version AS template_version, t.schema AS template_schema
           FROM workflows p
           LEFT JOIN templates t ON t.tenant_id = p.tenant_id AND t.id = p.template_id
           WHERE p.tenant_id = $1 AND p.id = $2`,
          [tenantId, task.workflow_id],
        )
      : Promise.resolve({ rows: [] }),
    (task.depends_on as string[]).length > 0
      ? db.query(
          "SELECT id, role, type, output FROM tasks WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND state = 'completed'",
          [tenantId, task.depends_on],
        )
      : Promise.resolve({ rows: [] }),
    listTaskDocuments(db, tenantId, task),
  ]);

  const upstreamOutputs = Object.fromEntries(
    depsRes.rows.map((row) => [row.role ?? row.type ?? row.id, truncateOutput(row.output ?? {})]),
  );

  const workflowRow = workflowRes.rows[0] as Record<string, unknown> | undefined;
  const templateSchema =
    (workflowRow?.template_schema as Record<string, unknown> | undefined) ?? {};
  const projectInstructions = await loadProjectInstructions(db, tenantId, task, workflowRow);
  const platformInstructions = await loadPlatformInstructions(db, tenantId);
  const templateInstructionConfig = asRecord(templateSchema.default_instruction_config);
  const instructionLayers = buildInstructionLayers({
    platformInstructions,
    projectInstructions,
    templateInstructions: asOptionalString(templateInstructionConfig.instructions),
    roleConfig: asRecord(task.role_config),
    taskInput: asRecord(task.input),
    taskId: String(task.id ?? ''),
    projectId: asOptionalString(task.project_id),
    projectSpecVersion: asOptionalNumber(workflowRow?.project_spec_version),
    role: asOptionalString(task.role),
    suppressLayers: readSuppressedLayers(workflowRow?.instruction_config),
  });
  const flatInstructions = readFlatInstructions(asRecord(task.role_config), agent?.metadata);
  const workflowContext = workflowRow
    ? {
        id: workflowRow.id,
        name: workflowRow.name,
        context: workflowRow.context,
        git_branch: workflowRow.git_branch,
        resolved_config: workflowRow.resolved_config ?? {},
        variables: workflowRow.parameters ?? {},
        template: {
          id: workflowRow.template_id,
          slug: workflowRow.template_slug,
          name: workflowRow.template_name,
          version: workflowRow.template_version,
          metadata: templateSchema.metadata ?? {},
        },
      }
    : null;

  return {
    agent,
    project: projectRes.rows[0] ?? null,
    workflow: workflowContext,
    documents,
    instructions: flatInstructions,
    instruction_layers: instructionLayers,
    task: {
      id: task.id,
      input: task.input,
      context: task.context,
      failure_mode:
        task.context && typeof task.context === 'object' && !Array.isArray(task.context)
          ? ((task.context as Record<string, unknown>).failure_mode ?? null)
          : null,
      role_config: task.role_config,
      upstream_outputs: upstreamOutputs,
    },
  };
}

async function loadPlatformInstructions(db: DatabaseQueryable, tenantId: string) {
  const result = await db.query(
    `SELECT tenant_id, version, content, format
       FROM platform_instructions
      WHERE tenant_id = $1`,
    [tenantId],
  );
  return result.rows[0] as Record<string, unknown> | undefined;
}

async function loadProjectInstructions(
  db: DatabaseQueryable,
  tenantId: string,
  task: Record<string, unknown>,
  workflowRow?: Record<string, unknown>,
) {
  const projectId = asOptionalString(task.project_id);
  const projectSpecVersion = asOptionalNumber(workflowRow?.project_spec_version);
  if (!projectId || !projectSpecVersion || projectSpecVersion <= 0) {
    return undefined;
  }

  const result = await db.query<{ spec: Record<string, unknown> }>(
    `SELECT spec
       FROM project_spec_versions
      WHERE tenant_id = $1 AND project_id = $2 AND version = $3`,
    [tenantId, projectId, projectSpecVersion],
  );
  return result.rows[0]?.spec as Record<string, unknown> | undefined;
}

function buildInstructionLayers(params: {
  platformInstructions?: Record<string, unknown>;
  projectInstructions?: Record<string, unknown>;
  templateInstructions?: string;
  roleConfig: Record<string, unknown>;
  taskInput: Record<string, unknown>;
  taskId: string;
  projectId?: string;
  projectSpecVersion?: number;
  role?: string;
  suppressLayers: string[];
}) {
  const suppressed = new Set(params.suppressLayers);
  const layers: Record<string, unknown> = {};

  const platformDocument = normalizeInstructionDocument(
    params.platformInstructions
      ? {
          content: params.platformInstructions.content,
          format: params.platformInstructions.format,
        }
      : undefined,
    'platform instructions',
    10_000,
  );
  if (platformDocument && !suppressed.has('platform')) {
    layers.platform = {
      ...platformDocument,
      source: {
        tenant_id: params.platformInstructions?.tenant_id ?? null,
        version: params.platformInstructions?.version ?? 0,
      },
    };
  }

  const projectDocument = normalizeInstructionDocument(
    params.projectInstructions?.instructions,
    'project instructions',
    20_000,
  );
  if (projectDocument && !suppressed.has('project')) {
    layers.project = {
      ...projectDocument,
      source: {
        project_id: params.projectId ?? null,
        version: params.projectSpecVersion ?? 0,
      },
    };
  }

  const templateDocument = normalizeInstructionDocument(
    params.templateInstructions,
    'template instructions',
    20_000,
  );
  if (templateDocument && !suppressed.has('template')) {
    layers.template = {
      ...templateDocument,
      source: { type: 'default_instruction_config' },
    };
  }

  const roleDocument = normalizeInstructionDocument(
    params.roleConfig.system_prompt ?? params.roleConfig.instructions,
    'role instructions',
    10_000,
  );
  if (roleDocument && !suppressed.has('role')) {
    layers.role = {
      ...roleDocument,
      source: {
        role: params.role ?? null,
        task_id: params.taskId,
      },
    };
  }

  const taskDocument = normalizeInstructionDocument(
    params.taskInput.instructions,
    'task instructions',
    1_048_576,
  );
  if (taskDocument && !suppressed.has('task')) {
    layers.task = {
      ...taskDocument,
      source: {
        task_id: params.taskId,
      },
    };
  }

  return layers;
}

const LAYER_ORDER = ['platform', 'project', 'template', 'role'] as const;

const LAYER_HEADERS: Record<string, string> = {
  platform: '=== Platform Instructions ===',
  project: '=== Project Instructions ===',
  template: '=== Template Instructions ===',
  role: '=== Role Instructions ===',
};

/**
 * Flatten instruction layers into a single system prompt string.
 * The task layer is excluded — the runtime reads it separately from `input`.
 */
export function flattenInstructionLayers(
  layers: Record<string, unknown>,
): string {
  const sections: string[] = [];
  for (const name of LAYER_ORDER) {
    const layer = layers[name] as
      | { content?: string }
      | undefined;
    if (!layer?.content) continue;
    sections.push(`${LAYER_HEADERS[name]}\n${layer.content}`);
  }
  return sections.join('\n\n');
}

function readSuppressedLayers(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }
  return Array.isArray((value as Record<string, unknown>).suppress_layers)
    ? ((value as Record<string, unknown>).suppress_layers as unknown[])
        .filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function readAgentProfileInstructions(value: unknown): string {
  const metadata = asRecord(value);
  const profile = asRecord(metadata.profile);
  if (typeof profile.instructions === 'string' && profile.instructions.trim().length > 0) {
    return profile.instructions;
  }
  if (typeof metadata.instructions === 'string' && metadata.instructions.trim().length > 0) {
    return metadata.instructions;
  }
  return '';
}

function readFlatInstructions(roleConfig: Record<string, unknown>, agentMetadata: unknown): string {
  const roleInstructions = normalizeInstructionDocument(
    roleConfig.system_prompt ?? roleConfig.instructions,
    'role instructions',
    10_000,
  );
  return roleInstructions?.content ?? readAgentProfileInstructions(agentMetadata);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

const UPSTREAM_OUTPUT_MAX_BYTES = 102400;

function truncateOutput(output: unknown): unknown {
  const serialized = JSON.stringify(output);
  if (serialized.length <= UPSTREAM_OUTPUT_MAX_BYTES) {
    return output;
  }
  return { _truncated: true, _original_size: serialized.length, summary: serialized.slice(0, UPSTREAM_OUTPUT_MAX_BYTES) };
}
