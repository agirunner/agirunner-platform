import type { DatabaseQueryable } from '../db/database.js';
import { parsePlaybookDefinition } from '../orchestration/playbook-model.js';
import { listTaskDocuments } from './document-reference-service.js';
import { normalizeInstructionDocument } from './instruction-policy.js';
import { buildOrchestratorTaskContext } from './orchestrator-task-context.js';
import { sanitizeSecretLikeRecord, sanitizeSecretLikeValue } from './secret-redaction.js';
import { currentStageNameFromStages, type WorkflowStageResponse } from './workflow-stage-service.js';

const TASK_CONTEXT_SECRET_REDACTION = 'redacted://task-context-secret';

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
          `SELECT id,
                  name,
                  description,
                  repository_url,
                  settings,
                  memory
             FROM projects
            WHERE tenant_id = $1
              AND id = $2`,
          [tenantId, task.project_id],
        )
      : Promise.resolve({ rows: [] }),
    task.workflow_id
      ? db.query(
          `SELECT p.id, p.name, p.context, p.git_branch, p.parameters, p.resolved_config, p.instruction_config,
                  p.metadata,
                  p.playbook_id, p.lifecycle,
                  p.project_spec_version,
                  pb.name AS playbook_name, pb.outcome AS playbook_outcome, pb.definition AS playbook_definition
           FROM workflows p
           LEFT JOIN playbooks pb ON pb.tenant_id = p.tenant_id AND pb.id = p.playbook_id
           WHERE p.tenant_id = $1 AND p.id = $2`,
          [tenantId, task.workflow_id],
        )
      : Promise.resolve({ rows: [] }),
    (task.depends_on as string[]).length > 0
      ? db.query(
          "SELECT id, role, title, output FROM tasks WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND state = 'completed'",
          [tenantId, task.depends_on],
        )
      : Promise.resolve({ rows: [] }),
    listTaskDocuments(db, tenantId, task),
  ]);

  const upstreamOutputs = Object.fromEntries(
    depsRes.rows.map((row) => [
      row.role ?? row.title ?? row.id,
      { task_name: row.title ?? row.role ?? row.id, output: truncateOutput(row.output ?? {}) },
    ]),
  );

  const workflowRow = workflowRes.rows[0] as Record<string, unknown> | undefined;
  const continuousWorkflowRow =
    workflowRow && isContinuousWorkflowRow(workflowRow) ? workflowRow : null;
  const workItem = await loadWorkItemContext(db, tenantId, task);
  const activeStages = workflowRow
    ? await loadWorkflowActiveStages(
        db,
        tenantId,
        String(workflowRow.id),
        workflowRow.playbook_definition,
        continuousWorkflowRow ? 'continuous' : 'standard',
      )
    : [];
  const workflowRelations = workflowRow
    ? await loadWorkflowRelations(db, tenantId, workflowRow)
    : null;
  const parentWorkflowContext = workflowRelations?.parent?.workflow_id
    ? await loadParentWorkflowContext(db, tenantId, workflowRelations.parent.workflow_id)
    : null;
  const projectInstructions = await loadProjectInstructions(db, tenantId, task, workflowRow);
  const platformInstructions = await loadPlatformInstructions(db, tenantId);
  const instructionLayers = buildInstructionLayers({
    platformInstructions,
    projectInstructions,
    roleConfig: asRecord(task.role_config),
    taskInput: asRecord(task.input),
    taskId: String(task.id ?? ''),
    projectId: asOptionalString(task.project_id),
    projectSpecVersion: asOptionalNumber(workflowRow?.project_spec_version),
    role: asOptionalString(task.role),
    suppressLayers: readSuppressedLayers(workflowRow?.instruction_config),
  });
  const flatInstructions = readFlatInstructions(asRecord(task.role_config), agent?.metadata);
  const orchestratorContext = await buildOrchestratorTaskContext(db, tenantId, task);
  const workflowContext = workflowRow
    ? continuousWorkflowRow
      ? buildContinuousWorkflowContext({
          workflowRow: continuousWorkflowRow,
          activeStages,
          workflowRelations,
          parentWorkflowContext,
        })
      : await buildStandardWorkflowContext({
          db,
          tenantId,
          workflowRow,
          activeStages,
          workflowRelations,
          parentWorkflowContext,
        })
    : null;

  return {
    agent: sanitizeTaskContextValue(agent),
    project: sanitizeTaskContextValue(projectRes.rows[0] ?? null),
    workflow: sanitizeTaskContextValue(workflowContext),
    orchestrator: sanitizeTaskContextValue(orchestratorContext),
    documents: sanitizeTaskContextValue(documents),
    instructions: sanitizeTaskContextValue(flatInstructions),
    instruction_layers: sanitizeTaskContextValue(instructionLayers),
    task: {
      id: task.id,
      input: sanitizeTaskContextValue(task.input),
      context: sanitizeTaskContextValue(task.context),
      work_item: sanitizeTaskContextValue(workItem),
      failure_mode:
        task.context && typeof task.context === 'object' && !Array.isArray(task.context)
          ? ((task.context as Record<string, unknown>).failure_mode ?? null)
          : null,
      role_config: sanitizeTaskContextValue(task.role_config),
      upstream_outputs: sanitizeTaskContextValue(upstreamOutputs),
    },
  };
}

function buildWorkflowContextBase(params: {
  workflowRow: Record<string, unknown>;
  activeStages: string[];
  workflowRelations: Record<string, unknown> | null;
  parentWorkflowContext: Record<string, unknown> | null;
}) {
  const context: Record<string, unknown> = {
    id: params.workflowRow.id,
    name: params.workflowRow.name,
    lifecycle: params.workflowRow.lifecycle ?? null,
    active_stages: params.activeStages,
    context: params.workflowRow.context,
    git_branch: params.workflowRow.git_branch,
    resolved_config: sanitizeSecretLikeRecord(params.workflowRow.resolved_config, {
      redactionValue: TASK_CONTEXT_SECRET_REDACTION,
      allowSecretReferences: false,
    }),
    variables: sanitizeSecretLikeRecord(params.workflowRow.parameters, {
      redactionValue: TASK_CONTEXT_SECRET_REDACTION,
      allowSecretReferences: false,
    }),
    playbook: params.workflowRow.playbook_id
      ? {
          id: params.workflowRow.playbook_id,
          name: params.workflowRow.playbook_name ?? null,
          outcome: params.workflowRow.playbook_outcome ?? null,
          definition: params.workflowRow.playbook_definition ?? {},
        }
      : null,
    relations: params.workflowRelations,
    parent_workflow: params.parentWorkflowContext,
  };
  return context;
}

function buildContinuousWorkflowContext(params: {
  workflowRow: Record<string, unknown> & {
    lifecycle: 'continuous';
  };
  activeStages: string[];
  workflowRelations: Record<string, unknown> | null;
  parentWorkflowContext: Record<string, unknown> | null;
}) {
  return buildWorkflowContextBase(params);
}

async function buildStandardWorkflowContext(params: {
  db: DatabaseQueryable;
  tenantId: string;
  workflowRow: Record<string, unknown>;
  activeStages: string[];
  workflowRelations: Record<string, unknown> | null;
  parentWorkflowContext: Record<string, unknown> | null;
}) {
  const context = buildWorkflowContextBase(params);
  context.current_stage = await loadWorkflowCurrentStage(
    params.db,
    params.tenantId,
    String(params.workflowRow.id),
  );
  return context;
}

function isContinuousWorkflowRow(
  workflowRow: Record<string, unknown>,
): workflowRow is Record<string, unknown> & { lifecycle: 'continuous' } {
  return workflowRow.lifecycle === 'continuous';
}

async function loadWorkflowActiveStages(
  db: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
  definition: unknown,
  lifecycle: 'continuous' | 'standard',
): Promise<string[]> {
  const result =
    lifecycle === 'continuous'
      ? await loadContinuousWorkflowActiveStages(db, tenantId, workflowId)
      : await loadStandardWorkflowActiveStages(db, tenantId, workflowId);
  return orderStageNamesByDefinition(result.rows.map((row) => row.stage_name), definition);
}

async function loadContinuousWorkflowActiveStages(
  db: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
) {
  return db.query<{ stage_name: string }>(
    `SELECT DISTINCT wi.stage_name
       FROM workflow_work_items wi
      WHERE wi.tenant_id = $1
        AND wi.workflow_id = $2
        AND wi.completed_at IS NULL
        AND wi.stage_name IS NOT NULL
      ORDER BY wi.stage_name ASC`,
    [tenantId, workflowId],
  );
}

async function loadStandardWorkflowActiveStages(
  db: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
) {
  return db.query<{ stage_name: string }>(
    `SELECT DISTINCT stage_name
       FROM (
         SELECT wi.stage_name
           FROM workflow_work_items wi
          WHERE wi.tenant_id = $1
            AND wi.workflow_id = $2
            AND wi.completed_at IS NULL
         UNION
         SELECT ws.name AS stage_name
           FROM workflow_stages ws
          WHERE ws.tenant_id = $1
            AND ws.workflow_id = $2
            AND ws.gate_status IN ('awaiting_approval', 'changes_requested', 'rejected')
       ) AS active_stage_names
      WHERE stage_name IS NOT NULL
      ORDER BY stage_name ASC`,
    [tenantId, workflowId],
  );
}

async function loadWorkflowCurrentStage(
  db: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
): Promise<string | null> {
  const result = await db.query<WorkflowStageResponse>(
    `SELECT id,
            name,
            position,
            goal,
            guidance,
            human_gate,
            status,
            false AS is_active,
            gate_status,
            iteration_count,
            summary,
            started_at,
            completed_at,
            0::int AS open_work_item_count,
            0::int AS total_work_item_count
       FROM workflow_stages
      WHERE tenant_id = $1
        AND workflow_id = $2
      ORDER BY position ASC`,
    [tenantId, workflowId],
  );
  return currentStageNameFromStages(result.rows);
}

async function loadWorkItemContext(
  db: DatabaseQueryable,
  tenantId: string,
  task: Record<string, unknown>,
) {
  const workItemId = asOptionalString(task.work_item_id);
  if (!workItemId) {
    return null;
  }

  const result = await db.query(
    `SELECT id, stage_name, column_id, title, goal, acceptance_criteria, owner_role, priority, notes
       FROM workflow_work_items
      WHERE tenant_id = $1
        AND id = $2`,
    [tenantId, workItemId],
  );
  return (result.rows[0] as Record<string, unknown> | undefined) ?? null;
}

async function loadWorkflowRelations(
  db: DatabaseQueryable,
  tenantId: string,
  workflowRow: Record<string, unknown>,
) {
  const metadata = asRecord(workflowRow.metadata);
  const parentId = asOptionalString(metadata.parent_workflow_id);
  const childIds = readWorkflowIdArray(metadata.child_workflow_ids);
  const relatedIds = [...new Set([...(parentId ? [parentId] : []), ...childIds])];
  if (relatedIds.length === 0) {
    return {
      parent: null,
      children: [],
      latest_child_workflow_id: asOptionalString(metadata.latest_child_workflow_id) ?? null,
      child_status_counts: { total: 0, active: 0, completed: 0, failed: 0, cancelled: 0 },
    };
  }

  const relatedRes = await db.query(
    `SELECT w.id, w.name, w.state, w.playbook_id, w.created_at, w.started_at, w.completed_at,
            pb.name AS playbook_name
       FROM workflows w
       LEFT JOIN playbooks pb
         ON pb.tenant_id = w.tenant_id
        AND pb.id = w.playbook_id
      WHERE w.tenant_id = $1
        AND w.id = ANY($2::uuid[])`,
    [tenantId, relatedIds],
  );
  const relatedById = new Map(
    relatedRes.rows.map((row) => [String((row as Record<string, unknown>).id), row as Record<string, unknown>]),
  );
  const children = childIds.map((childId) => toWorkflowRelationRef(childId, relatedById.get(childId)));
  return {
    parent: parentId ? toWorkflowRelationRef(parentId, relatedById.get(parentId)) : null,
    children,
    latest_child_workflow_id: asOptionalString(metadata.latest_child_workflow_id) ?? null,
    child_status_counts: {
      total: children.length,
      active: children.filter((child) => child.state === 'pending' || child.state === 'active' || child.state === 'paused').length,
      completed: children.filter((child) => child.state === 'completed').length,
      failed: children.filter((child) => child.state === 'failed').length,
      cancelled: children.filter((child) => child.state === 'cancelled').length,
    },
  };
}

async function loadParentWorkflowContext(
  db: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
) {
  const result = await db.query(
    `SELECT id, name, state, context, parameters, resolved_config, metadata, started_at, completed_at
       FROM workflows
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1`,
    [tenantId, workflowId],
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) {
    return null;
  }
  const metadata = asRecord(row.metadata);
  return {
    id: row.id,
    name: row.name,
    state: row.state,
    context: row.context ?? {},
    variables: row.parameters ?? {},
    resolved_config: row.resolved_config ?? {},
    started_at: row.started_at ?? null,
    completed_at: row.completed_at ?? null,
    run_summary: asRecord(metadata.run_summary),
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

const LAYER_ORDER = ['platform', 'project', 'role'] as const;

const LAYER_HEADERS: Record<string, string> = {
  platform: '=== Platform Instructions ===',
  project: '=== Project Instructions ===',
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

function sanitizeTaskContextValue(value: unknown): unknown {
  return sanitizeSecretLikeValue(value, {
    redactionValue: TASK_CONTEXT_SECRET_REDACTION,
    allowSecretReferences: false,
  });
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

function readWorkflowIdArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    : [];
}

function toWorkflowRelationRef(workflowId: string, row?: Record<string, unknown>) {
  return {
    workflow_id: workflowId,
    name: asOptionalString(row?.name) ?? null,
    state: asOptionalString(row?.state) ?? 'unknown',
    playbook_id: asOptionalString(row?.playbook_id) ?? null,
    playbook_name: asOptionalString(row?.playbook_name) ?? null,
    created_at: row?.created_at ?? null,
    started_at: row?.started_at ?? null,
    completed_at: row?.completed_at ?? null,
    is_terminal: ['completed', 'failed', 'cancelled'].includes(asOptionalString(row?.state) ?? ''),
    link: `/workflows/${workflowId}`,
  };
}

function orderStageNamesByDefinition(stageNames: string[], definition: unknown): string[] {
  if (stageNames.length <= 1) {
    return stageNames;
  }
  const stageOrder = readPlaybookStageOrder(definition);
  if (stageOrder.length === 0) {
    return stageNames;
  }
  const remaining = new Set(stageNames);
  const ordered: string[] = [];
  for (const stageName of stageOrder) {
    if (!remaining.has(stageName)) {
      continue;
    }
    ordered.push(stageName);
    remaining.delete(stageName);
  }
  for (const stageName of stageNames) {
    if (!remaining.has(stageName)) {
      continue;
    }
    ordered.push(stageName);
    remaining.delete(stageName);
  }
  return ordered;
}

function readPlaybookStageOrder(definition: unknown): string[] {
  try {
    return parsePlaybookDefinition(definition).stages.map((stage) => stage.name);
  } catch {
    return [];
  }
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
