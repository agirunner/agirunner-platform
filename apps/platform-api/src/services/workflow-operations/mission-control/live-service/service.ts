import type { DatabasePool } from '../../../../db/database.js';
import { composeMissionControlOutputDescriptor } from '../output-descriptors.js';
import type {
  MissionControlLiveResponse,
  MissionControlOutputDescriptor,
  MissionControlReadModelVersion,
  MissionControlWorkflowCard,
} from '../types.js';
import {
  buildAttentionItems,
  buildWorkflowCard,
  buildWorkflowCardSections,
  emptySignals,
  normalizeLifecycleFilter,
  pushOutput,
} from './presentation.js';
import {
  countWorkflowRows,
  getLatestEventId,
  loadWorkflowOutputRows,
  loadWorkflowRows,
  loadWorkflowSignals,
} from './queries.js';

export class MissionControlLiveService {
  constructor(private readonly pool: DatabasePool) {}

  async countWorkflows(
    tenantId: string,
    input: {
      lifecycleFilter?: 'all' | 'ongoing' | 'planned';
      playbookId?: string;
      updatedWithin?: 'all' | '24h' | '7d' | '30d';
      search?: string;
      needsActionOnly?: boolean;
    } = {},
  ): Promise<number> {
    return countWorkflowRows(this.pool, tenantId, {
      lifecycleFilter: normalizeLifecycleFilter(input.lifecycleFilter),
      playbookId: input.playbookId,
      updatedWithin: input.updatedWithin ?? 'all',
      search: input.search,
      needsActionOnly: input.needsActionOnly,
    });
  }

  async getLive(
    tenantId: string,
    input: {
      page?: number;
      perPage?: number;
      lifecycleFilter?: 'all' | 'ongoing' | 'planned';
      playbookId?: string;
      updatedWithin?: 'all' | '24h' | '7d' | '30d';
      search?: string;
      needsActionOnly?: boolean;
    } = {},
  ): Promise<MissionControlLiveResponse> {
    const version = await this.buildVersion(tenantId);
    const workflows = await this.listWorkflowCards(tenantId, {
      page: input.page ?? 1,
      perPage: input.perPage ?? 100,
      lifecycleFilter: normalizeLifecycleFilter(input.lifecycleFilter),
      playbookId: input.playbookId,
      updatedWithin: input.updatedWithin ?? 'all',
      search: input.search,
      needsActionOnly: input.needsActionOnly,
      version,
    });
    return {
      version,
      sections: buildWorkflowCardSections(workflows),
      attentionItems: buildAttentionItems(workflows),
    };
  }

  async listWorkflowCards(
    tenantId: string,
    input: {
      workflowIds?: string[];
      page?: number;
      perPage?: number;
      lifecycleFilter?: 'all' | 'ongoing' | 'planned';
      playbookId?: string;
      updatedWithin?: 'all' | '24h' | '7d' | '30d';
      search?: string;
      needsActionOnly?: boolean;
      version?: MissionControlReadModelVersion;
    } = {},
  ): Promise<MissionControlWorkflowCard[]> {
    const version = input.version ?? (await this.buildVersion(tenantId));
    const workflows = await loadWorkflowRows(this.pool, tenantId, input);
    const workflowIds = workflows.map((workflow) => workflow.id);
    const [signals, outputs] = await Promise.all([
      loadWorkflowSignals(this.pool, tenantId, workflowIds),
      this.listWorkflowOutputDescriptors(tenantId, workflowIds, 1),
    ]);

    return workflows.map((workflow) =>
      buildWorkflowCard(
        workflow,
        signals.get(workflow.id) ?? emptySignals(workflow.id),
        outputs.get(workflow.id) ?? [],
        version,
      ),
    );
  }

  async listWorkflowOutputDescriptors(
    tenantId: string,
    workflowIds: string[],
    limitPerWorkflow = 1,
  ): Promise<Map<string, MissionControlOutputDescriptor[]>> {
    const result = new Map<string, MissionControlOutputDescriptor[]>();
    if (workflowIds.length === 0) return result;

    const { artifactRows, documentRows } = await loadWorkflowOutputRows(
      this.pool,
      tenantId,
      workflowIds,
      limitPerWorkflow,
    );

    for (const row of artifactRows) {
      pushOutput(result, row.workflow_id, composeMissionControlOutputDescriptor({
        kind: 'artifact',
        id: `artifact:${row.artifact_id}`,
        artifactId: row.artifact_id,
        taskId: row.task_id,
        workItemId: row.work_item_id,
        stageName: row.stage_name,
        logicalPath: row.logical_path,
        contentType: row.content_type,
        sizeBytes: row.size_bytes,
        status: resolveArtifactOutputStatus(row),
      }));
    }

    for (const row of documentRows) {
      pushOutput(result, row.workflow_id, composeMissionControlOutputDescriptor({
        kind: 'workflow_document',
        id: `document:${row.document_id}`,
        workflowId: row.workflow_id,
        documentId: row.document_id,
        logicalName: row.logical_name,
        title: row.title,
        source: row.source,
        location: row.location,
        artifactId: row.artifact_id,
        status: 'approved',
      }));
    }

    return result;
  }

  async getLatestEventId(tenantId: string): Promise<number | null> {
    return getLatestEventId(this.pool, tenantId);
  }

  private async buildVersion(tenantId: string): Promise<MissionControlReadModelVersion> {
    const latestEventId = await this.getLatestEventId(tenantId);
    return {
      generatedAt: new Date().toISOString(),
      latestEventId,
      token: latestEventId === null ? 'mission-control:empty' : `mission-control:${latestEventId}`,
    };
  }
}

function resolveArtifactOutputStatus(row: {
  workflow_state: string | null;
  work_item_completed_at: Date | string | null;
  task_state: string | null;
}): 'draft' | 'under_review' | 'approved' | 'final' {
  if (readOptionalString(row.workflow_state) === 'completed' || row.work_item_completed_at != null) {
    return 'final';
  }
  const taskState = readOptionalString(row.task_state);
  if (taskState === 'output_pending_assessment' || taskState === 'awaiting_approval') {
    return 'under_review';
  }
  if (taskState === 'completed') {
    return 'approved';
  }
  return 'draft';
}

function readOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
