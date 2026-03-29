import type { MissionControlHistoryResponse } from './mission-control-types.js';
import type { WorkflowOperatorBriefRecord } from '../workflow-operator-brief-service.js';
import type { WorkflowOperatorUpdateRecord } from '../workflow-operator-update-service.js';
import type { LogRow } from '../../logging/log-service.js';
import { filterLiveConsoleItemsForSelectedScope } from './workflow-live-console-scope.js';
import {
  buildWorkflowOperationsSnapshotVersion,
  type WorkflowLiveConsoleItem,
  type WorkflowLiveConsolePacket,
  type WorkflowWorkspacePacket,
} from './workflow-operations-types.js';
import { buildWorkflowLiveConsoleCounts } from './workflow-live-console-counts.js';
import { buildExecutionTurnItems } from './workflow-execution-log-composer.js';
import {
  compareCursorTargets,
  paginateOrderedItems,
} from './workflow-packet-cursors.js';

interface VersionSource {
  getHistory(
    tenantId: string,
    input?: { workflowId?: string; limit?: number },
  ): Promise<MissionControlHistoryResponse>;
}

interface BriefSource {
  listBriefs(
    tenantId: string,
    workflowId: string,
    input?: { workItemId?: string; taskId?: string; limit?: number; unbounded?: boolean },
  ): Promise<WorkflowOperatorBriefRecord[]>;
}

interface UpdateSource {
  listUpdates(
    tenantId: string,
    workflowId: string,
    input?: { workItemId?: string; taskId?: string; limit?: number },
  ): Promise<WorkflowOperatorUpdateRecord[]>;
}

interface VisibilityModeSource {
  getWorkflowSettings(
    tenantId: string,
    workflowId: string,
  ): Promise<{ effective_live_visibility_mode: 'standard' | 'enhanced' }>;
}

interface ExecutionTurnSource {
  query(
    tenantId: string,
    filters: {
      workflowId: string;
      workItemId?: string;
      taskId?: string;
      isOrchestratorTask?: boolean;
      cursor?: string;
      category: string[];
      operation: string[];
      order: 'desc';
      perPage: number;
    },
  ): Promise<{ data: LogRow[]; pagination?: { has_more: boolean; next_cursor: string | null } }>;
}

interface WorkflowBoardSource {
  getWorkflowBoard(tenantId: string, workflowId: string): Promise<Record<string, unknown>>;
}

const ENHANCED_EXECUTION_LOG_CATEGORIES = ['agent_loop', 'task_lifecycle'] as const;

const ENHANCED_AGENT_LOOP_OPERATIONS = [
  'agent.think',
  'agent.plan',
  'agent.act',
  'agent.observe',
  'agent.verify',
  'runtime.loop.think',
  'runtime.loop.plan',
  'runtime.loop.observe',
  'runtime.loop.verify',
] as const;

export class WorkflowLiveConsoleService {
  constructor(
    private readonly versionSource: VersionSource,
    private readonly briefSource: BriefSource,
    _deprecatedUpdateSource: UpdateSource,
    private readonly visibilityModeSource: VisibilityModeSource,
    private readonly executionTurnSource?: ExecutionTurnSource,
    private readonly workflowBoardSource?: WorkflowBoardSource,
  ) {}

  async getLiveConsole(
    tenantId: string,
    workflowId: string,
    input: { limit?: number; workItemId?: string; taskId?: string; after?: string } = {},
  ): Promise<WorkflowLiveConsolePacket> {
    const limit = input.limit ?? 50;
    const [version, briefs, workflowSettings, workflowBoard] = await Promise.all([
      this.versionSource.getHistory(tenantId, {
        workflowId,
        limit: 1,
      }),
      this.briefSource.listBriefs(tenantId, workflowId, {
        workItemId: input.workItemId,
        taskId: input.taskId,
        unbounded: true,
      }),
      this.visibilityModeSource.getWorkflowSettings(tenantId, workflowId),
      shouldFilterSelectedScope(input) && this.workflowBoardSource
        ? this.workflowBoardSource.getWorkflowBoard(tenantId, workflowId)
        : Promise.resolve(null),
    ]);
    const executionTurns = await this.listExecutionTurns(
      tenantId,
      workflowId,
      input,
      workflowSettings.effective_live_visibility_mode,
    );

    const items = [...briefs.map(toBriefItem), ...executionTurns].sort(sortNewestFirst);
    const scopedItems = shouldFilterSelectedScope(input)
      ? filterLiveConsoleItemsForSelectedScope(
          items,
          toSelectedScope(input),
          readWorkflowWorkItemIds(workflowBoard),
        )
      : items;
    const page = paginateOrderedItems(scopedItems, limit, input.after, (item) => ({
      timestamp: item.created_at,
      id: item.item_id,
    }));

    return {
      generated_at: version.version.generatedAt,
      latest_event_id: version.version.latestEventId,
      snapshot_version: buildWorkflowOperationsSnapshotVersion(version.version.latestEventId),
      items: page.items,
      total_count: scopedItems.length,
      counts: buildWorkflowLiveConsoleCounts(scopedItems),
      next_cursor: page.nextCursor,
      live_visibility_mode: workflowSettings.effective_live_visibility_mode,
    };
  }

  private async listExecutionTurns(
    tenantId: string,
    workflowId: string,
    input: { workItemId?: string; taskId?: string },
    mode: 'standard' | 'enhanced',
  ): Promise<WorkflowLiveConsoleItem[]> {
    if (mode !== 'enhanced' || !this.executionTurnSource) {
      return [];
    }
    const [agentLoopRows, llmRows] = await Promise.all([
      this.fetchRelevantExecutionRows(tenantId, {
        workflowId,
        workItemId: input.workItemId,
        taskId: input.taskId,
        category: [...ENHANCED_EXECUTION_LOG_CATEGORIES],
        operation: [...ENHANCED_AGENT_LOOP_OPERATIONS],
        order: 'desc',
        perPage: 500,
      }),
      this.fetchRelevantExecutionRows(tenantId, {
        workflowId,
        workItemId: input.workItemId,
        taskId: input.taskId,
        category: ['llm'],
        operation: ['llm.chat_stream'],
        order: 'desc',
        perPage: 500,
      }),
    ]);
    const rows = [...agentLoopRows, ...llmRows].sort(sortLogRowsNewestFirst);
    return buildExecutionTurnItems(rows);
  }

  private async fetchRelevantExecutionRows(
    tenantId: string,
    filters: {
      workflowId: string;
      workItemId?: string;
      taskId?: string;
      category: string[];
      operation: string[];
      order: 'desc';
      perPage: number;
    },
  ): Promise<LogRow[]> {
    const scopedRows = await this.fetchExecutionRows(tenantId, filters);
    if (!filters.workItemId && !filters.taskId) {
      return scopedRows;
    }
    const orchestratorRows = await this.fetchExecutionRows(tenantId, {
      ...filters,
      workItemId: undefined,
      taskId: undefined,
      isOrchestratorTask: true,
    });
    return dedupeExecutionRows([...scopedRows, ...orchestratorRows]);
  }

  private async fetchExecutionRows(
    tenantId: string,
    filters: {
      workflowId: string;
      workItemId?: string;
      taskId?: string;
      isOrchestratorTask?: boolean;
      category: string[];
      operation: string[];
      order: 'desc';
      perPage: number;
    },
  ): Promise<LogRow[]> {
    if (!this.executionTurnSource) {
      return [];
    }
    const rows: LogRow[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await this.executionTurnSource.query(tenantId, {
        ...filters,
        cursor,
      });
      rows.push(...page.data);
      if (!page.pagination?.has_more || !page.pagination.next_cursor) {
        break;
      }
      cursor = page.pagination.next_cursor;
    }
    return rows;
  }
}

function dedupeExecutionRows(rows: LogRow[]): LogRow[] {
  const uniqueRows = new Map<string, LogRow>();
  for (const row of rows) {
    uniqueRows.set(row.id, row);
  }
  return [...uniqueRows.values()];
}

function toBriefItem(brief: WorkflowOperatorBriefRecord): WorkflowLiveConsoleItem {
  const shortBrief = asRecord(brief.short_brief);
  const detailedBrief = asRecord(brief.detailed_brief_json);
  return {
    item_id: brief.id,
    item_kind: 'milestone_brief',
    source_kind: brief.source_kind,
    source_label: readSourceLabel(brief.source_role_name, brief.source_kind),
    headline: readHeadline(shortBrief, detailedBrief, 'Workflow brief'),
    summary: readSummary(detailedBrief, shortBrief),
    created_at: brief.created_at,
    work_item_id: brief.work_item_id,
    task_id: brief.task_id,
    linked_target_ids: buildLinkedTargetIds(brief),
    scope_binding: 'record',
  };
}

function buildLinkedTargetIds(record: WorkflowOperatorBriefRecord): string[] {
  const storedTargets = readStringArray(record.linked_target_ids);
  if (storedTargets.length > 0) {
    return storedTargets;
  }
  return [record.workflow_id, record.work_item_id, record.task_id].filter(isNonEmptyString);
}

function readHeadline(
  shortBrief: Record<string, unknown>,
  detailedBrief: Record<string, unknown>,
  fallback: string,
): string {
  return (
    readOptionalString(shortBrief.headline) ??
    readOptionalString(detailedBrief.headline) ??
    fallback
  );
}

function readSummary(
  detailedBrief: Record<string, unknown>,
  shortBrief: Record<string, unknown>,
): string {
  return (
    readOptionalString(detailedBrief.summary) ??
    readOptionalString(shortBrief.delta_label) ??
    readOptionalString(shortBrief.status_label) ??
    readOptionalString(shortBrief.headline) ??
    'Workflow brief'
  );
}

function readRequiredString(value: unknown, fallback: string): string {
  return readOptionalString(value) ?? fallback;
}

function readOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readSourceLabel(sourceRoleName: string | null, sourceKind: string): string {
  const roleName = readOptionalString(sourceRoleName);
  if (roleName) {
    return shouldHumanizeSourceLabel(roleName) ? humanizeToken(roleName) : roleName;
  }
  return humanizeToken(sourceKind);
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isNonEmptyString);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function sortLogRowsNewestFirst(left: LogRow, right: LogRow): number {
  return compareCursorTargets(
    { timestamp: left.created_at, id: left.id },
    { timestamp: right.created_at, id: right.id },
  );
}

function sortNewestFirst(left: WorkflowLiveConsoleItem, right: WorkflowLiveConsoleItem): number {
  return compareCursorTargets(
    { timestamp: left.created_at, id: left.item_id },
    { timestamp: right.created_at, id: right.item_id },
  );
}

function shouldFilterSelectedScope(input: { workItemId?: string; taskId?: string }): boolean {
  return typeof input.taskId === 'string' || typeof input.workItemId === 'string';
}

function toSelectedScope(input: {
  workItemId?: string;
  taskId?: string;
}): WorkflowWorkspacePacket['selected_scope'] {
  if (input.taskId) {
    return {
      scope_kind: 'selected_task',
      work_item_id: input.workItemId ?? null,
      task_id: input.taskId,
    };
  }
  return {
    scope_kind: 'selected_work_item',
    work_item_id: input.workItemId ?? null,
    task_id: null,
  };
}

function readWorkflowWorkItemIds(board: Record<string, unknown> | null): string[] {
  if (!board) {
    return [];
  }
  const workItems = board.work_items;
  if (!Array.isArray(workItems)) {
    return [];
  }
  return workItems
    .map((item) => asRecord(item).id)
    .filter(isNonEmptyString);
}

function shouldHumanizeSourceLabel(value: string): boolean {
  return /^[a-z0-9][a-z0-9 _-]*$/.test(value) && value === value.toLowerCase();
}

function humanizeToken(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}
