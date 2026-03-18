import { createHash } from 'node:crypto';

import type { DatabaseQueryable } from '../db/database.js';
import { listTaskDocuments } from './document-reference-service.js';
import { normalizeInstructionDocument } from './instruction-policy.js';
import { buildOrchestratorTaskContext } from './orchestrator-task-context.js';
import { resolveRelevantHandoffs } from './predecessor-handoff-resolver.js';
import { WorkspaceMemoryScopeService } from './workspace-memory-scope-service.js';
import { sanitizeSecretLikeRecord, sanitizeSecretLikeValue } from './secret-redaction.js';
import { buildWorkflowInstructionLayer } from './workflow-instruction-layer.js';
import { loadWorkflowStageProjection } from './workflow-stage-projection.js';

const TASK_CONTEXT_SECRET_REDACTION = 'redacted://task-context-secret';
const TASK_CONTEXT_LOG_VERSION = 1;
const TASK_CONTEXT_MEMORY_INDEX_LIMIT = 100;
const TASK_CONTEXT_ARTIFACT_INDEX_LIMIT = 100;
const TASK_CONTEXT_RECENT_HANDOFF_LIMIT = 2;

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

  const [workspaceRes, workflowRes, depsRes, documents, handoffResolution] = await Promise.all([
    task.workspace_id
      ? db.query(
          `SELECT id,
                  name,
                  description,
                  repository_url,
                  settings,
                  memory
             FROM workspaces
            WHERE tenant_id = $1
              AND id = $2`,
          [tenantId, task.workspace_id],
        )
      : Promise.resolve({ rows: [] }),
    task.workflow_id
      ? db.query(
          `SELECT p.id, p.name, p.context, p.git_branch, p.parameters, p.resolved_config, p.instruction_config,
                  p.metadata,
                  p.playbook_id, p.lifecycle,
                  p.workspace_spec_version,
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
    resolveRelevantHandoffs(db, tenantId, task, TASK_CONTEXT_RECENT_HANDOFF_LIMIT),
  ]);
  const recentHandoffs = handoffResolution.handoffs;
  const predecessorHandoff = recentHandoffs[0] ?? null;

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
  const workspaceContext = await loadWorkspaceContext(
    db,
    tenantId,
    workspaceRes.rows[0] as Record<string, unknown> | undefined,
    task,
  );
  const stageProjection = workflowRow
    ? await loadWorkflowStageProjection(db, tenantId, String(workflowRow.id), {
        lifecycle: continuousWorkflowRow ? 'ongoing' : 'planned',
        definition: workflowRow.playbook_definition,
      })
    : null;
  const activeStages = stageProjection?.activeStages ?? [];
  const workflowRelations = workflowRow
    ? await loadWorkflowRelations(db, tenantId, workflowRow)
    : null;
  const parentWorkflowContext = workflowRelations?.parent?.workflow_id
    ? await loadParentWorkflowContext(db, tenantId, workflowRelations.parent.workflow_id)
    : null;
  const workspaceInstructions = await loadWorkspaceInstructions(db, tenantId, task, workflowRow);
  const platformInstructions = await loadPlatformInstructions(db, tenantId);
  const orchestratorPrompt = task.is_orchestrator_task
    ? await loadOrchestratorPrompt(db, tenantId)
    : undefined;
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
          workflowRow,
          activeStages,
          currentStage: stageProjection?.currentStage ?? null,
          workflowRelations,
          parentWorkflowContext,
        })
    : null;
  const instructionLayers = buildInstructionLayers({
    platformInstructions,
    orchestratorPrompt,
    isOrchestratorTask: Boolean(task.is_orchestrator_task),
    workspaceInstructions,
    roleConfig: asRecord(task.role_config),
    taskInput: asRecord(task.input),
    taskId: String(task.id ?? ''),
    workspaceId: asOptionalString(task.workspace_id),
    workspaceSpecVersion: asOptionalNumber(workflowRow?.workspace_spec_version),
    role: asOptionalString(task.role),
    suppressLayers: readSuppressedLayers(workflowRow?.instruction_config),
    workflowContext,
    workspace: workspaceContext ?? undefined,
    workItem,
    predecessorHandoff,
    orchestratorContext: orchestratorContext as Record<string, unknown> | undefined,
  });

  return {
    agent: sanitizeTaskContextValue(agent),
    workspace: sanitizeTaskContextValue(workspaceContext),
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
      predecessor_handoff: sanitizeTaskContextValue(predecessorHandoff),
      predecessor_handoff_resolution: sanitizeTaskContextValue(handoffResolution),
      recent_handoffs: sanitizeTaskContextValue(recentHandoffs),
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
    lifecycle: 'ongoing';
  };
  activeStages: string[];
  workflowRelations: Record<string, unknown> | null;
  parentWorkflowContext: Record<string, unknown> | null;
}) {
  return buildWorkflowContextBase(params);
}

async function buildStandardWorkflowContext(params: {
  workflowRow: Record<string, unknown>;
  activeStages: string[];
  currentStage: string | null;
  workflowRelations: Record<string, unknown> | null;
  parentWorkflowContext: Record<string, unknown> | null;
}) {
  const context = buildWorkflowContextBase(params);
  context.current_stage = params.currentStage;
  return context;
}

function isContinuousWorkflowRow(
  workflowRow: Record<string, unknown>,
): workflowRow is Record<string, unknown> & { lifecycle: 'ongoing' } {
  return workflowRow.lifecycle === 'ongoing';
}

function normalizeWorkItemStage(row: Record<string, unknown>) {
  return {
    ...row,
    stage_name: asOptionalString(row.stage_name) ?? null,
  };
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
      `SELECT id,
            stage_name,
            column_id,
            title,
            goal,
            acceptance_criteria,
            owner_role,
            next_expected_actor,
            next_expected_action,
            rework_count,
            latest_handoff.latest_handoff_completion,
            latest_handoff.unresolved_findings,
            latest_handoff.review_focus,
            latest_handoff.known_risks,
            priority,
            notes
       FROM workflow_work_items
       LEFT JOIN LATERAL (
         SELECT th.completion AS latest_handoff_completion,
                array_cat(
                  COALESCE(
                    ARRAY(SELECT jsonb_array_elements_text(COALESCE(th.remaining_items, '[]'::jsonb))),
                    ARRAY[]::text[]
                  ),
                  COALESCE(
                    ARRAY(SELECT jsonb_array_elements_text(COALESCE(th.blockers, '[]'::jsonb))),
                    ARRAY[]::text[]
                  )
                ) AS unresolved_findings,
                th.review_focus,
                th.known_risks
           FROM task_handoffs th
          WHERE th.tenant_id = workflow_work_items.tenant_id
            AND th.workflow_id = workflow_work_items.workflow_id
            AND th.work_item_id = workflow_work_items.id
          ORDER BY th.sequence DESC, th.created_at DESC
          LIMIT 1
       ) latest_handoff ON true
      WHERE tenant_id = $1
        AND id = $2`,
    [tenantId, workItemId],
  );
  const workItem = (result.rows[0] as Record<string, unknown> | undefined) ?? null;
  return workItem ? normalizeWorkItemStage(workItem) : null;
}

async function loadWorkspaceContext(
  db: DatabaseQueryable,
  tenantId: string,
  workspaceRow: Record<string, unknown> | undefined,
  task: Record<string, unknown>,
) {
  if (!workspaceRow) {
    return null;
  }

  const workspace = { ...workspaceRow };
  const workspaceId = asOptionalString(workspace.id);
  const workflowId = asOptionalString(task.workflow_id);
  const workItemId = asOptionalString(task.work_item_id) ?? null;
  const currentMemory = asRecord(workspace.memory);
  if (!workspaceId || !workflowId) {
    workspace.memory = currentMemory;
    return workspace;
  }

  const memoryScope = new WorkspaceMemoryScopeService(db as DatabaseQueryable & { query: DatabaseQueryable['query'] });
  const [visibleMemory, memoryIndex, artifactIndex] = await Promise.all([
    memoryScope.filterVisibleTaskMemory({
      tenantId,
      workspaceId,
      workflowId,
      workItemId,
      currentMemory,
    }),
    memoryScope.listVisibleTaskMemoryKeys({
      tenantId,
      workspaceId,
      workflowId,
      workItemId,
      currentMemory,
      limit: TASK_CONTEXT_MEMORY_INDEX_LIMIT,
    }),
    loadWorkspaceArtifactIndex(db, tenantId, workspaceId),
  ]);

  workspace.memory = visibleMemory;
  workspace.memory_index = memoryIndex;
  workspace.artifact_index = artifactIndex;
  return workspace;
}

async function loadWorkspaceArtifactIndex(
  db: DatabaseQueryable,
  tenantId: string,
  workspaceId: string,
) {
  const result = await db.query<{
    logical_path: string;
    task_id: string | null;
    created_at: string | null;
    total_count: number;
  }>(
    `SELECT logical_path,
            task_id,
            created_at,
            COUNT(*) OVER()::int AS total_count
       FROM workflow_artifacts
      WHERE tenant_id = $1
        AND workspace_id = $2
      ORDER BY created_at DESC, id DESC
      LIMIT $3`,
    [tenantId, workspaceId, TASK_CONTEXT_ARTIFACT_INDEX_LIMIT + 1],
  );
  const rows = result.rows.slice(0, TASK_CONTEXT_ARTIFACT_INDEX_LIMIT);
  const total = result.rows[0]?.total_count ?? 0;
  return {
    items: rows.map((row) => ({
      logical_path: row.logical_path,
      task_id: row.task_id,
      created_at: row.created_at,
    })),
    total,
    more_available: total > rows.length,
  };
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

async function loadOrchestratorPrompt(db: DatabaseQueryable, tenantId: string): Promise<string | undefined> {
  const result = await db.query<{ prompt: string }>(
    'SELECT prompt FROM orchestrator_config WHERE tenant_id = $1',
    [tenantId],
  );
  const prompt = result.rows[0]?.prompt?.trim();
  return prompt || undefined;
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

async function loadWorkspaceInstructions(
  db: DatabaseQueryable,
  tenantId: string,
  task: Record<string, unknown>,
  workflowRow?: Record<string, unknown>,
) {
  const workspaceId = asOptionalString(task.workspace_id);
  const workspaceSpecVersion = asOptionalNumber(workflowRow?.workspace_spec_version);
  if (!workspaceId || !workspaceSpecVersion || workspaceSpecVersion <= 0) {
    return undefined;
  }

  const result = await db.query<{ spec: Record<string, unknown> }>(
    `SELECT spec
       FROM workspace_spec_versions
      WHERE tenant_id = $1 AND workspace_id = $2 AND version = $3`,
    [tenantId, workspaceId, workspaceSpecVersion],
  );
  return result.rows[0]?.spec as Record<string, unknown> | undefined;
}

function buildInstructionLayers(params: {
  platformInstructions?: Record<string, unknown>;
  orchestratorPrompt?: string;
  isOrchestratorTask: boolean;
  workspaceInstructions?: Record<string, unknown>;
  roleConfig: Record<string, unknown>;
  taskInput: Record<string, unknown>;
  taskId: string;
  workspaceId?: string;
  workspaceSpecVersion?: number;
  role?: string;
  suppressLayers: string[];
  workflowContext?: Record<string, unknown> | null;
  workspace?: Record<string, unknown>;
  workItem?: Record<string, unknown> | null;
  predecessorHandoff?: Record<string, unknown> | null;
  orchestratorContext?: Record<string, unknown>;
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

  if (params.isOrchestratorTask && params.orchestratorPrompt && !suppressed.has('orchestrator')) {
    const orchestratorDocument = normalizeInstructionDocument(
      params.orchestratorPrompt,
      'orchestrator prompt',
      10_000,
    );
    if (orchestratorDocument) {
      layers.orchestrator = {
        ...orchestratorDocument,
        source: { type: 'orchestrator_config' },
      };
    }
  }

  const workspaceDocument = normalizeInstructionDocument(
    params.workspaceInstructions?.instructions,
    'workspace instructions',
    20_000,
  );
  if (workspaceDocument && !suppressed.has('workspace')) {
    layers.workspace = {
      ...workspaceDocument,
      source: {
        workspace_id: params.workspaceId ?? null,
        version: params.workspaceSpecVersion ?? 0,
      },
    };
  }

  if (!params.isOrchestratorTask) {
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
  }

  const workflowDocument = buildWorkflowInstructionLayer({
    isOrchestratorTask: params.isOrchestratorTask,
    role: params.role,
    workflow: params.workflowContext ?? null,
    workspace: params.workspace ?? null,
    taskInput: params.taskInput,
    workItem: params.workItem ?? null,
    predecessorHandoff: params.predecessorHandoff ?? null,
    orchestratorContext: params.orchestratorContext ?? null,
  });
  if (workflowDocument && !suppressed.has('workflow')) {
    layers.workflow = {
      ...workflowDocument,
      source: {
        workflow_id: params.workflowContext?.id ?? null,
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

const LAYER_HEADERS: Record<string, string> = {
  platform: '=== Platform Instructions ===',
  orchestrator: '=== Orchestrator Prompt ===',
  workflow: '=== Workflow Context ===',
  workspace: '=== Workspace Instructions ===',
  role: '=== Role Instructions ===',
};

/**
 * Flatten instruction layers into a single system prompt string.
 * The task layer is excluded — the runtime reads it separately from `input`.
 */
export function flattenInstructionLayers(
  layers: Record<string, unknown>,
): string {
  const layerOrder = 'orchestrator' in layers
    ? ['platform', 'orchestrator', 'workflow', 'workspace']
    : ['platform', 'role', 'workflow', 'workspace'];
  const sections: string[] = [];
  for (const name of layerOrder) {
    const layer = layers[name] as
      | { content?: string }
      | undefined;
    if (!layer?.content) continue;
    sections.push(`${LAYER_HEADERS[name]}\n${layer.content}`);
  }
  return sections.join('\n\n');
}

export function summarizeTaskContextAttachments(
  context: Record<string, unknown>,
): Record<string, unknown> {
  const agent = asRecord(context.agent);
  const task = asRecord(context.task);
  const workspace = asRecord(context.workspace);
  const instructionLayers = asRecord(context.instruction_layers);
  const agentProfile = asRecord(asRecord(agent.metadata).profile);
  const predecessorHandoff = asRecord(task.predecessor_handoff);
  const predecessorResolution = asRecord(task.predecessor_handoff_resolution);
  const recentHandoffs = Array.isArray(task.recent_handoffs)
    ? task.recent_handoffs as unknown[]
    : [];
  const workItem = asRecord(task.work_item);
  const memoryIndex = asRecord(workspace.memory_index);
  const artifactIndex = asRecord(workspace.artifact_index);
  const memoryKeys = Array.isArray(memoryIndex.keys)
    ? memoryIndex.keys as unknown[]
    : [];
  const artifactItems = Array.isArray(artifactIndex.items)
    ? artifactIndex.items as unknown[]
    : [];
  const documents = Array.isArray(context.documents)
    ? context.documents as unknown[]
    : [];
  const flattenedSystemPrompt = flattenInstructionLayers(instructionLayers);
  const agentProfileInstructions = readAgentProfileInstructions(agent.metadata);

  return {
    agent_profile_present: Object.keys(agentProfile).length > 0,
    agent_profile_hash: Object.keys(agentProfile).length > 0 ? hashCanonicalJson(agentProfile) : null,
    agent_profile_instructions_present: agentProfileInstructions.length > 0,
    agent_profile_instructions_hash:
      agentProfileInstructions.length > 0 ? hashCanonicalJson(agentProfileInstructions) : null,
    predecessor_handoff_present: Object.keys(predecessorHandoff).length > 0,
    predecessor_handoff_resolution_present: Object.keys(predecessorResolution).length > 0,
    predecessor_handoff_source: asOptionalString(predecessorResolution.source) ?? null,
    recent_handoff_count: recentHandoffs.length,
    work_item_continuity_present: Object.keys(workItem).length > 0,
    workspace_memory_index_present: Object.keys(memoryIndex).length > 0,
    workspace_memory_index_count: memoryKeys.length,
    workspace_memory_more_available: memoryIndex.more_available === true,
    workspace_artifact_index_present: Object.keys(artifactIndex).length > 0,
    workspace_artifact_index_count: artifactItems.length,
    workspace_artifact_more_available: artifactIndex.more_available === true,
    document_count: documents.length,
    instruction_context_version: TASK_CONTEXT_LOG_VERSION,
    instruction_layers_hash: hashCanonicalJson(instructionLayers),
    flattened_system_prompt_hash: hashCanonicalJson(flattenedSystemPrompt),
    instruction_layer_hashes: buildInstructionLayerHashes(instructionLayers),
    instruction_layer_versions: buildInstructionLayerVersions(instructionLayers),
  };
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

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function buildInstructionLayerHashes(layers: Record<string, unknown>): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const name of ['platform', 'orchestrator', 'workflow', 'workspace', 'role', 'task']) {
    const layer = asRecord(layers[name]);
    if (Object.keys(layer).length === 0) {
      continue;
    }
    hashes[name] = hashCanonicalJson(layer);
  }
  return hashes;
}

function buildInstructionLayerVersions(layers: Record<string, unknown>): Record<string, unknown> {
  const versions: Record<string, unknown> = {};
  for (const name of ['platform', 'orchestrator', 'workflow', 'workspace', 'role', 'task']) {
    const layer = asRecord(layers[name]);
    if (Object.keys(layer).length === 0) {
      continue;
    }
    const source = asRecord(layer.source);
    versions[name] = readLayerVersion(name, source);
  }
  return versions;
}

function readLayerVersion(layerName: string, source: Record<string, unknown>): unknown {
  if (layerName === 'platform' || layerName === 'workspace') {
    return asOptionalNumber(source.version) ?? null;
  }
  if (layerName === 'orchestrator') {
    return asOptionalString(source.type) ?? null;
  }
  if (layerName === 'workflow') {
    return asOptionalString(source.workflow_id) ?? null;
  }
  if (layerName === 'role') {
    return asOptionalString(source.role) ?? null;
  }
  if (layerName === 'task') {
    return asOptionalString(source.task_id) ?? null;
  }
  return null;
}

function hashCanonicalJson(value: unknown): string {
  return createHash('sha256').update(stableJsonStringify(value)).digest('hex');
}

function stableJsonStringify(value: unknown): string {
  return JSON.stringify(normalizeForStableStringify(value));
}

function normalizeForStableStringify(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeForStableStringify(entry));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right),
  );

  const normalized: Record<string, unknown> = {};
  for (const [key, entry] of entries) {
    if (entry === undefined) {
      continue;
    }
    normalized[key] = normalizeForStableStringify(entry);
  }
  return normalized;
}

const UPSTREAM_OUTPUT_MAX_BYTES = 102400;

function truncateOutput(output: unknown): unknown {
  const serialized = JSON.stringify(output);
  if (serialized.length <= UPSTREAM_OUTPUT_MAX_BYTES) {
    return output;
  }
  return { _truncated: true, _original_size: serialized.length, summary: serialized.slice(0, UPSTREAM_OUTPUT_MAX_BYTES) };
}
