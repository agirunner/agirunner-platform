import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabasePool, DatabaseQueryable } from '../db/database.js';
import { ValidationError } from '../errors/domain-errors.js';

export const toolCategoryValues = [
  'files',
  'search',
  'execution',
  'git',
  'artifacts',
  'memory',
  'web',
  'workflow',
  'control',
] as const;

type ToolCategory = (typeof toolCategoryValues)[number];
export type ToolOwner = 'runtime' | 'task';

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

const builtInToolTags: Array<{
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
  owner: ToolOwner;
}> = [
  { id: 'file_read', name: 'File Read', description: 'Read files with line numbers', category: 'files', owner: 'task' },
  { id: 'file_write', name: 'File Write', description: 'Write files to the workspace', category: 'files', owner: 'task' },
  { id: 'file_edit', name: 'File Edit', description: 'Exact string replacement with uniqueness enforcement', category: 'files', owner: 'task' },
  { id: 'file_list', name: 'File List', description: 'List files and directories', category: 'files', owner: 'task' },
  { id: 'grep', name: 'Grep', description: 'Search file contents using regex patterns', category: 'search', owner: 'task' },
  { id: 'glob', name: 'Glob', description: 'Find files by glob pattern', category: 'search', owner: 'task' },
  { id: 'tool_search', name: 'Tool Search', description: 'Search for available tools by name or description', category: 'search', owner: 'runtime' },
  { id: 'shell_exec', name: 'Shell Exec', description: 'Execute shell commands with output truncation', category: 'execution', owner: 'task' },
  { id: 'git_status', name: 'Git Status', description: 'Show working tree status', category: 'git', owner: 'task' },
  { id: 'git_diff', name: 'Git Diff', description: 'Show changes between commits or working tree', category: 'git', owner: 'task' },
  { id: 'git_log', name: 'Git Log', description: 'Show commit log history', category: 'git', owner: 'task' },
  { id: 'git_commit', name: 'Git Commit', description: 'Record changes to the repository', category: 'git', owner: 'task' },
  { id: 'git_push', name: 'Git Push', description: 'Push commits to remote repository', category: 'git', owner: 'task' },
  { id: 'artifact_upload', name: 'Artifact Upload', description: 'Upload a file as a task artifact', category: 'artifacts', owner: 'task' },
  { id: 'artifact_list', name: 'Artifact List', description: 'List workflow artifacts', category: 'artifacts', owner: 'runtime' },
  { id: 'artifact_read', name: 'Artifact Read', description: 'Read an artifact from the store', category: 'artifacts', owner: 'runtime' },
  { id: 'artifact_document_read', name: 'Artifact Document Read', description: 'Read extracted document content for an artifact', category: 'artifacts', owner: 'runtime' },
  { id: 'memory_read', name: 'Memory Read', description: 'Read workspace memory', category: 'memory', owner: 'runtime' },
  { id: 'memory_search', name: 'Memory Search', description: 'Search workspace memory by key or value', category: 'memory', owner: 'runtime' },
  { id: 'memory_write', name: 'Memory Write', description: 'Write workspace memory', category: 'memory', owner: 'runtime' },
  { id: 'memory_delete', name: 'Memory Delete', description: 'Delete a workspace memory key', category: 'memory', owner: 'runtime' },
  { id: 'native_search', name: 'Native Search', description: 'Use the model provider native web search when the resolved model supports it', category: 'web', owner: 'runtime' },
  { id: 'web_fetch', name: 'Web Fetch', description: 'Fetch and extract content from URLs', category: 'web', owner: 'task' },
  { id: 'escalate', name: 'Escalate', description: 'Escalate to orchestrator or human when stuck', category: 'control', owner: 'runtime' },
  { id: 'escalate_to_human', name: 'Escalate To Human', description: 'Escalate directly to a human operator', category: 'control', owner: 'runtime' },
  { id: 'spawn_agent', name: 'Spawn Agent', description: 'Spawn a delegated sub-agent for bounded work', category: 'control', owner: 'runtime' },
  { id: 'list_work_items', name: 'List Work Items', description: 'List workflow work items', category: 'workflow', owner: 'runtime' },
  { id: 'list_workflow_tasks', name: 'List Workflow Tasks', description: 'List tasks inside the workflow context', category: 'workflow', owner: 'runtime' },
  { id: 'read_task_output', name: 'Read Task Output', description: 'Read a task output packet', category: 'workflow', owner: 'runtime' },
  { id: 'read_task_status', name: 'Read Task Status', description: 'Read current task status details', category: 'workflow', owner: 'runtime' },
  { id: 'read_task_events', name: 'Read Task Events', description: 'Read task event history', category: 'workflow', owner: 'runtime' },
  { id: 'read_escalation', name: 'Read Escalation', description: 'Read escalation state for a task or work item', category: 'workflow', owner: 'runtime' },
  { id: 'read_stage_status', name: 'Read Stage Status', description: 'Read stage progress and active work', category: 'workflow', owner: 'runtime' },
  { id: 'read_workflow_budget', name: 'Read Workflow Budget', description: 'Read workflow budget consumption and remaining budget', category: 'workflow', owner: 'runtime' },
  { id: 'update_task_input', name: 'Update Task Input', description: 'Update a queued or blocked task input payload', category: 'workflow', owner: 'runtime' },
  { id: 'create_work_item', name: 'Create Work Item', description: 'Create a workflow work item', category: 'workflow', owner: 'runtime' },
  { id: 'update_work_item', name: 'Update Work Item', description: 'Update a workflow work item', category: 'workflow', owner: 'runtime' },
  { id: 'complete_work_item', name: 'Complete Work Item', description: 'Complete a workflow work item using the playbook terminal column', category: 'workflow', owner: 'runtime' },
  { id: 'create_task', name: 'Create Task', description: 'Create a specialist task', category: 'workflow', owner: 'runtime' },
  { id: 'create_workflow', name: 'Create Workflow', description: 'Create a child workflow', category: 'workflow', owner: 'runtime' },
  { id: 'request_gate_approval', name: 'Request Gate Approval', description: 'Request human approval for a stage gate', category: 'workflow', owner: 'runtime' },
  { id: 'approve_task', name: 'Approve Task', description: 'Approve a specialist task awaiting approval', category: 'workflow', owner: 'runtime' },
  { id: 'approve_task_output', name: 'Approve Task Output', description: 'Approve a specialist task output pending assessment', category: 'workflow', owner: 'runtime' },
  { id: 'request_rework', name: 'Request Rework', description: 'Request concrete changes on a specialist task', category: 'workflow', owner: 'runtime' },
  { id: 'advance_stage', name: 'Advance Stage', description: 'Advance the active playbook stage', category: 'workflow', owner: 'runtime' },
  { id: 'complete_workflow', name: 'Complete Workflow', description: 'Complete the current workflow', category: 'workflow', owner: 'runtime' },
  { id: 'cancel_task', name: 'Cancel Task', description: 'Cancel a task', category: 'workflow', owner: 'runtime' },
  { id: 'retry_task', name: 'Retry Task', description: 'Retry a failed or escalated task', category: 'workflow', owner: 'runtime' },
  { id: 'submit_handoff', name: 'Submit Handoff', description: 'Submit the structured handoff for the current task', category: 'workflow', owner: 'runtime' },
  { id: 'read_predecessor_handoff', name: 'Read Predecessor Handoff', description: 'Read the latest predecessor handoff for the current task', category: 'workflow', owner: 'runtime' },
  { id: 'read_work_item_continuity', name: 'Read Work Item Continuity', description: 'Read compact continuity state for a workflow work item', category: 'workflow', owner: 'runtime' },
  { id: 'read_latest_handoff', name: 'Read Latest Handoff', description: 'Read the latest structured handoff for a workflow work item', category: 'workflow', owner: 'runtime' },
  { id: 'read_handoff_chain', name: 'Read Handoff Chain', description: 'Read the structured handoff chain for a workflow work item', category: 'workflow', owner: 'runtime' },
  { id: 'work_item_memory_read', name: 'Work Item Memory Read', description: 'Read work-item scoped memory', category: 'workflow', owner: 'runtime' },
  { id: 'work_item_memory_history', name: 'Work Item Memory History', description: 'Read work-item memory history', category: 'workflow', owner: 'runtime' },
  { id: 'reassign_task', name: 'Reassign Task', description: 'Reassign a task to another worker or agent', category: 'workflow', owner: 'runtime' },
  { id: 'send_task_message', name: 'Send Task Message', description: 'Send a message to an active task', category: 'workflow', owner: 'runtime' },
];

const allowedCategories = new Set<ToolCategory>(toolCategoryValues);

const builtInToolIds = new Set(builtInToolTags.map((tag) => tag.id));
const builtInToolOwners = new Map(builtInToolTags.map((tag) => [tag.id, tag.owner]));

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
    guardNotBuiltIn(normalized.id);
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

export function resolveBuiltInToolOwner(toolId: string): ToolOwner | null {
  return builtInToolOwners.get(toolId) ?? null;
}

export function validateWorkspaceToolTags(spec: Record<string, unknown>): void {
  const tools = readWorkspaceToolTags(spec);
  ensureNoDuplicates(tools.available, 'tools.available');
  ensureNoDuplicates(tools.blocked, 'tools.blocked');
}

export function readWorkspaceToolTags(spec: Record<string, unknown>): ToolSpec {
  const tools = asRecord(spec.tools);
  return {
    available: normalizeToolIds(tools.available),
    blocked: normalizeToolIds(tools.blocked),
  };
}

export async function resolveWorkspaceToolTags(
  db: DatabaseQueryable,
  tenantId: string,
  workspaceId: string | null | undefined,
): Promise<ToolSpec> {
  if (!workspaceId) {
    return { available: [], blocked: [] };
  }

  const workspaceResult = await db.query<{ current_spec_version: number }>(
    'SELECT current_spec_version FROM workspaces WHERE tenant_id = $1 AND id = $2',
    [tenantId, workspaceId],
  );
  if (!workspaceResult.rowCount || workspaceResult.rows[0].current_spec_version === 0) {
    return { available: [], blocked: [] };
  }

  const specRow = await db.query<{ spec: Record<string, unknown> }>(
    `SELECT spec
       FROM workspace_spec_versions
      WHERE tenant_id = $1
        AND workspace_id = $2
        AND version = $3`,
    [tenantId, workspaceId, workspaceResult.rows[0].current_spec_version],
  );
  if (!specRow.rowCount) {
    return { available: [], blocked: [] };
  }

  return readWorkspaceToolTags(asRecord(specRow.rows[0].spec));
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
  workspaceTools: ToolSpec,
  agentTools: AgentToolRequirements,
): { matches: boolean; matched: string[]; unavailable_optional: string[] } {
  if (workspaceTools.available.length === 0 && workspaceTools.blocked.length === 0) {
    return { matches: true, matched: [], unavailable_optional: [] };
  }

  const available = new Set(workspaceTools.available);
  const blocked = new Set(workspaceTools.blocked);
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
