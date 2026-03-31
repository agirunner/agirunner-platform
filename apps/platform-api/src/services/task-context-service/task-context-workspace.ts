import type { DatabaseQueryable } from '../../db/database.js';
import { WorkspaceMemoryScopeService } from '../workspace-memory-scope-service.js';
import { asOptionalString, asRecord, formatDateValue, asOptionalNumber } from './task-context-utils.js';
import {
  TASK_CONTEXT_ARTIFACT_INDEX_LIMIT,
  TASK_CONTEXT_MEMORY_INDEX_LIMIT,
} from './task-context-constants.js';

export async function loadWorkItemContext(
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
            metadata,
            latest_handoff.latest_handoff_completion,
            latest_handoff.latest_handoff_resolution,
            latest_handoff.unresolved_findings,
            latest_handoff.focus_areas,
            latest_handoff.known_risks,
            priority,
            notes
       FROM workflow_work_items
       LEFT JOIN LATERAL (
         SELECT th.completion AS latest_handoff_completion,
                th.resolution AS latest_handoff_resolution,
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
                th.focus_areas,
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
  if (!workItem) {
    return null;
  }
  const normalized = normalizeWorkItemStage(workItem);
  const continuity = asRecord(asRecord(normalized.metadata).orchestrator_finish_state);
  if (Object.keys(continuity).length > 0) {
    normalized.continuity = continuity;
  }
  return normalized;
}

export async function loadWorkspaceContext(
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

  const memoryScope = new WorkspaceMemoryScopeService(
    db as DatabaseQueryable & { query: DatabaseQueryable['query'] },
  );
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

export async function loadOrchestratorPrompt(
  db: DatabaseQueryable,
  tenantId: string,
): Promise<string | undefined> {
  const result = await db.query<{ prompt: string }>(
    'SELECT prompt FROM orchestrator_config WHERE tenant_id = $1',
    [tenantId],
  );
  const prompt = result.rows[0]?.prompt?.trim();
  return prompt || undefined;
}

export async function loadPlatformInstructions(db: DatabaseQueryable, tenantId: string) {
  const result = await db.query(
    `SELECT tenant_id, version, content, format
       FROM platform_instructions
      WHERE tenant_id = $1`,
    [tenantId],
  );
  return result.rows[0] as Record<string, unknown> | undefined;
}

export async function loadWorkspaceInstructions(
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

async function loadWorkspaceArtifactIndex(
  db: DatabaseQueryable,
  tenantId: string,
  workspaceId: string,
) {
  const result = await db.query<{
    id: string;
    logical_path: string;
    task_id: string | null;
    content_type: string | null;
    created_at: string | null;
    total_count: number;
  }>(
    `SELECT id,
            logical_path,
            task_id,
            content_type,
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
      artifact_id: row.id,
      logical_path: row.logical_path,
      task_id: row.task_id,
      content_type: row.content_type,
      created_at: row.created_at,
    })),
    total,
    more_available: total > rows.length,
  };
}

function normalizeWorkItemStage(row: Record<string, unknown>): Record<string, unknown> & {
  stage_name: string | null;
  continuity?: Record<string, unknown>;
} {
  return {
    ...row,
    stage_name: asOptionalString(row.stage_name) ?? null,
  };
}
