import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabasePool, DatabaseQueryable } from '../db/database.js';
import { ValidationError } from '../errors/domain-errors.js';

type ToolCategory = 'runtime' | 'vcs' | 'web' | 'language' | 'integration';

interface ToolTagRow {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
}

interface ToolSpec {
  available: string[];
  blocked: string[];
}

interface AgentToolRequirements {
  required: string[];
  optional: string[];
}

const builtInToolTags: Array<{ id: string; name: string; description: string; category: ToolCategory }> = [
  { id: 'shell_exec', name: 'Shell Exec', description: 'Execute shell commands in the task workspace', category: 'runtime' },
  { id: 'file_read', name: 'File Read', description: 'Read files from the task workspace', category: 'runtime' },
  { id: 'file_write', name: 'File Write', description: 'Write files to the task workspace', category: 'runtime' },
  { id: 'file_edit', name: 'File Edit', description: 'Edit files with search-and-replace operations', category: 'runtime' },
  { id: 'file_list', name: 'File List', description: 'List files and directories in the workspace', category: 'runtime' },
  { id: 'git_status', name: 'Git Status', description: 'Show working tree status', category: 'vcs' },
  { id: 'git_diff', name: 'Git Diff', description: 'Show changes between commits or working tree', category: 'vcs' },
  { id: 'git_log', name: 'Git Log', description: 'Show commit log history', category: 'vcs' },
  { id: 'git_commit', name: 'Git Commit', description: 'Record changes to the repository', category: 'vcs' },
  { id: 'git_push', name: 'Git Push', description: 'Push commits to remote repository', category: 'vcs' },
  { id: 'artifact_upload', name: 'Artifact Upload', description: 'Upload artifacts (files, reports) from the task workspace', category: 'runtime' },
  { id: 'artifact_list', name: 'Artifact List', description: 'List accessible workflow artifacts by task, work item, or logical path', category: 'runtime' },
  { id: 'artifact_read', name: 'Artifact Read', description: 'Read an artifact payload from the platform artifact store', category: 'runtime' },
  { id: 'memory_read', name: 'Memory Read', description: 'Read project memory for the current task', category: 'runtime' },
  { id: 'memory_write', name: 'Memory Write', description: 'Write project memory for the current task', category: 'runtime' },
  { id: 'memory_delete', name: 'Memory Delete', description: 'Delete a project memory key (orchestrator only)', category: 'runtime' },
  { id: 'create_work_item', name: 'Create Work Item', description: 'Create a workflow work item (orchestrator only)', category: 'runtime' },
  { id: 'update_work_item', name: 'Update Work Item', description: 'Update a workflow work item (orchestrator only)', category: 'runtime' },
  { id: 'create_task', name: 'Create Task', description: 'Create a specialist task from the orchestrator', category: 'runtime' },
  { id: 'create_workflow', name: 'Create Workflow', description: 'Create a child workflow from the orchestrator', category: 'runtime' },
  { id: 'request_gate_approval', name: 'Request Gate Approval', description: 'Request human approval for a playbook stage gate', category: 'runtime' },
  { id: 'advance_stage', name: 'Advance Stage', description: 'Advance the active playbook stage', category: 'runtime' },
  { id: 'complete_workflow', name: 'Complete Workflow', description: 'Complete the current workflow', category: 'runtime' },
  { id: 'approve_task', name: 'Approve Task', description: 'Approve a task waiting for manual approval', category: 'runtime' },
  { id: 'approve_task_output', name: 'Approve Task Output', description: 'Approve a task output after review', category: 'runtime' },
  { id: 'request_task_changes', name: 'Request Task Changes', description: 'Request changes on a task and return it for rework', category: 'runtime' },
  { id: 'retry_task', name: 'Retry Task', description: 'Retry a failed or escalated task', category: 'runtime' },
  { id: 'web_fetch', name: 'Web Fetch', description: 'Fetch and extract content from URLs', category: 'web' },
  { id: 'web_search', name: 'Web Search', description: 'Search the web', category: 'web' },
  { id: 'escalate', name: 'Escalate', description: 'Request escalation when stuck or task is infeasible — pauses task and routes to supervisor or human', category: 'runtime' },
];

const allowedCategories = new Set<ToolCategory>(['runtime', 'vcs', 'web', 'language', 'integration']);

const builtInToolIds = new Set(builtInToolTags.map((tag) => tag.id));

export class ToolTagService {
  constructor(private readonly pool: DatabasePool) {}

  async listToolTags(tenantId: string) {
    const result = await this.pool.query<ToolTagRow>(
      'SELECT id, name, description, category FROM tool_tags WHERE tenant_id = $1 ORDER BY created_at DESC',
      [tenantId],
    );

    const merged = new Map<string, Record<string, unknown>>();
    for (const tag of builtInToolTags) {
      merged.set(tag.id, { ...tag, is_built_in: true });
    }
    for (const row of result.rows) {
      merged.set(row.id, {
        id: row.id,
        name: row.name,
        ...(row.description ? { description: row.description } : {}),
        ...(row.category ? { category: row.category } : {}),
        is_built_in: false,
      });
    }

    return { data: [...merged.values()].sort((left, right) => String(left.id).localeCompare(String(right.id))) };
  }

  async createToolTag(identity: ApiKeyIdentity, input: { id: string; name: string; description?: string; category?: string }) {
    const normalized = normalizeToolTag(input);
    const result = await this.pool.query<ToolTagRow>(
      `INSERT INTO tool_tags (tenant_id, id, name, description, category)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, name, description, category`,
      [
        identity.tenantId,
        normalized.id,
        normalized.name,
        normalized.description ?? null,
        normalized.category ?? null,
      ],
    );
    return result.rows[0];
  }

  async updateToolTag(
    identity: ApiKeyIdentity,
    toolId: string,
    input: { name?: string; description?: string; category?: string },
  ) {
    guardNotBuiltIn(toolId);
    const fields: string[] = [];
    const values: unknown[] = [identity.tenantId, toolId];
    let paramIndex = 3;

    if (input.name !== undefined) {
      const trimmed = input.name.trim();
      if (!trimmed) {
        throw new ValidationError('Tool tag name cannot be empty');
      }
      fields.push(`name = $${paramIndex++}`);
      values.push(trimmed);
    }
    if (input.description !== undefined) {
      fields.push(`description = $${paramIndex++}`);
      values.push(input.description.trim() || null);
    }
    if (input.category !== undefined) {
      if (input.category && !allowedCategories.has(input.category as ToolCategory)) {
        throw new ValidationError('Tool tag category is invalid');
      }
      fields.push(`category = $${paramIndex++}`);
      values.push(input.category || null);
    }

    if (fields.length === 0) {
      throw new ValidationError('At least one field is required');
    }

    const result = await this.pool.query<ToolTagRow>(
      `UPDATE tool_tags SET ${fields.join(', ')}
       WHERE tenant_id = $1 AND id = $2
       RETURNING id, name, description, category`,
      values,
    );

    if (!result.rowCount) {
      throw new ValidationError('Tool not found');
    }
    return result.rows[0];
  }

  async deleteToolTag(identity: ApiKeyIdentity, toolId: string): Promise<void> {
    guardNotBuiltIn(toolId);
    const result = await this.pool.query(
      'DELETE FROM tool_tags WHERE tenant_id = $1 AND id = $2',
      [identity.tenantId, toolId],
    );
    if (!result.rowCount) {
      throw new ValidationError('Tool not found');
    }
  }
}

export function validateProjectToolTags(spec: Record<string, unknown>): void {
  const tools = readProjectToolTags(spec);
  ensureNoDuplicates(tools.available, 'tools.available');
  ensureNoDuplicates(tools.blocked, 'tools.blocked');
}

export function readProjectToolTags(spec: Record<string, unknown>): ToolSpec {
  const tools = asRecord(spec.tools);
  return {
    available: normalizeToolIds(tools.available),
    blocked: normalizeToolIds(tools.blocked),
  };
}

export async function resolveProjectToolTags(
  db: DatabaseQueryable,
  tenantId: string,
  projectId: string | null | undefined,
): Promise<ToolSpec> {
  if (!projectId) {
    return { available: [], blocked: [] };
  }

  const project = await db.query<{ current_spec_version: number }>(
    'SELECT current_spec_version FROM projects WHERE tenant_id = $1 AND id = $2',
    [tenantId, projectId],
  );
  if (!project.rowCount || project.rows[0].current_spec_version === 0) {
    return { available: [], blocked: [] };
  }

  const specRow = await db.query<{ spec: Record<string, unknown> }>(
    `SELECT spec
       FROM project_spec_versions
      WHERE tenant_id = $1
        AND project_id = $2
        AND version = $3`,
    [tenantId, projectId, project.rows[0].current_spec_version],
  );
  if (!specRow.rowCount) {
    return { available: [], blocked: [] };
  }

  return readProjectToolTags(asRecord(specRow.rows[0].spec));
}

export function readAgentToolRequirements(agent: Record<string, unknown>): AgentToolRequirements {
  const metadata = asRecord(agent.metadata);
  const tools = asRecord(metadata.tools);
  return {
    required: normalizeToolIds(tools.required),
    optional: normalizeToolIds(tools.optional),
  };
}

export function computeToolMatch(
  projectTools: ToolSpec,
  agentTools: AgentToolRequirements,
): { matches: boolean; matched: string[]; unavailable_optional: string[] } {
  if (projectTools.available.length === 0 && projectTools.blocked.length === 0) {
    return { matches: true, matched: [], unavailable_optional: [] };
  }

  const available = new Set(projectTools.available);
  const blocked = new Set(projectTools.blocked);
  const matches = agentTools.required.every(
    (tool) => !blocked.has(tool) && (available.size === 0 || available.has(tool)),
  );
  const matched = [...new Set([...agentTools.required, ...agentTools.optional])].filter(
    (tool) => !blocked.has(tool) && (available.size === 0 || available.has(tool)),
  );
  const unavailableOptional = agentTools.optional.filter(
    (tool) => blocked.has(tool) || (available.size > 0 && !available.has(tool)),
  );

  return {
    matches,
    matched,
    unavailable_optional: unavailableOptional,
  };
}

function guardNotBuiltIn(toolId: string): void {
  if (builtInToolIds.has(toolId)) {
    throw new ValidationError('Built-in tools cannot be modified');
  }
}

function normalizeToolTag(input: { id: string; name: string; description?: string; category?: string }) {
  const id = input.id.trim();
  const name = input.name.trim();
  if (!id) {
    throw new ValidationError('Tool tag id is required');
  }
  if (!name) {
    throw new ValidationError('Tool tag name is required');
  }
  if (input.category && !allowedCategories.has(input.category as ToolCategory)) {
    throw new ValidationError('Tool tag category is invalid');
  }
  return {
    id,
    name,
    description: input.description?.trim() || undefined,
    category: input.category as ToolCategory | undefined,
  };
}

function normalizeToolIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0))];
}

function ensureNoDuplicates(values: string[], fieldName: string) {
  if (new Set(values).size !== values.length) {
    throw new ValidationError(`${fieldName} contains duplicate tool tags`);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}
