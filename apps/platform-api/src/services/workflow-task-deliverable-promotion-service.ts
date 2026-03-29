import type { DatabaseQueryable } from '../db/database.js';
import type { UpsertWorkflowDeliverableInput, WorkflowDeliverableRecord, WorkflowDeliverableService } from './workflow-deliverable-service.js';

const CANONICAL_DELIVERABLE_PACKET_KIND = 'deliverable_packet';

interface ArtifactRow {
  id: string;
  task_id: string;
  logical_path: string | null;
  content_type: string | null;
}

interface WorkItemTitleRow {
  title: string;
}

interface TaskWorkItemRow {
  work_item_id: string | null;
}

interface ExistingDescriptorRow {
  id: string;
  delivery_stage: string | null;
  state: string | null;
}

export interface WorkflowTaskDeliverablePromotionHandoff {
  id: string;
  workflow_id: string;
  work_item_id: string | null;
  task_id: string;
  role: string | null;
  summary: string;
  completion: string;
  completion_state?: string | null;
  role_data?: Record<string, unknown>;
  artifact_ids?: string[];
  created_at: string;
}

type DeliverableProgress = 'final' | 'in_progress';

export class WorkflowTaskDeliverablePromotionService {
  constructor(
    private readonly pool: DatabaseQueryable,
    private readonly deliverableService: Pick<WorkflowDeliverableService, 'upsertSystemDeliverable'>,
  ) {}

  async promoteFromHandoff(
    tenantId: string,
    handoff: WorkflowTaskDeliverablePromotionHandoff,
  ): Promise<WorkflowDeliverableRecord | null> {
    if (!shouldPromoteHandoff(handoff)) {
      return null;
    }
    const workItemId = await this.resolveWorkItemId(tenantId, handoff);
    if (!workItemId) {
      return null;
    }

    const [existingDescriptor, workItemTitle, artifacts] = await Promise.all([
      this.loadExistingDescriptor(tenantId, handoff.workflow_id, workItemId),
      this.loadWorkItemTitle(tenantId, handoff.workflow_id, workItemId),
      this.loadArtifacts(tenantId, handoff.workflow_id, handoff.artifact_ids ?? []),
    ]);

    return this.deliverableService.upsertSystemDeliverable(
      tenantId,
      handoff.workflow_id,
      buildPromotedDeliverableInput(
        handoff,
        workItemTitle,
        existingDescriptor,
        artifacts,
        workItemId,
      ),
    );
  }

  private async resolveWorkItemId(
    tenantId: string,
    handoff: WorkflowTaskDeliverablePromotionHandoff,
  ): Promise<string | null> {
    const directWorkItemId = readOptionalString(handoff.work_item_id);
    if (directWorkItemId) {
      return directWorkItemId;
    }

    const result = await this.pool.query<TaskWorkItemRow>(
      `SELECT work_item_id
         FROM tasks
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND id = $3
        LIMIT 1`,
      [tenantId, handoff.workflow_id, handoff.task_id],
    );
    return readOptionalString(result.rows[0]?.work_item_id) ?? null;
  }

  private async loadExistingDescriptor(
    tenantId: string,
    workflowId: string,
    workItemId: string,
  ): Promise<ExistingDescriptorRow | null> {
    const result = await this.pool.query<ExistingDescriptorRow>(
      `SELECT id,
              delivery_stage,
              state
         FROM workflow_output_descriptors
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND work_item_id = $3
          AND descriptor_kind IN ('deliverable_packet', 'handoff_packet')
          AND state <> 'superseded'
        ORDER BY CASE WHEN descriptor_kind = 'deliverable_packet' THEN 0 ELSE 1 END
        LIMIT 1`,
      [tenantId, workflowId, workItemId],
    );
    return result.rows[0] ?? null;
  }

  private async loadWorkItemTitle(
    tenantId: string,
    workflowId: string,
    workItemId: string,
  ): Promise<string | null> {
    const result = await this.pool.query<WorkItemTitleRow>(
      `SELECT title
         FROM workflow_work_items
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND id = $3
        LIMIT 1`,
      [tenantId, workflowId, workItemId],
    );
    return readOptionalString(result.rows[0]?.title) ?? null;
  }

  private async loadArtifacts(
    tenantId: string,
    workflowId: string,
    artifactIds: string[],
  ): Promise<ArtifactRow[]> {
    if (artifactIds.length === 0) {
      return [];
    }
    const result = await this.pool.query<ArtifactRow>(
      `SELECT id, task_id, logical_path, content_type
         FROM workflow_artifacts
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND id = ANY($3::uuid[])
        ORDER BY created_at ASC`,
      [tenantId, workflowId, artifactIds],
    );
    const order = new Map(artifactIds.map((artifactId, index) => [artifactId, index]));
    return [...result.rows].sort(
      (left, right) =>
        (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.id) ?? Number.MAX_SAFE_INTEGER),
    );
  }
}

function shouldPromoteHandoff(handoff: WorkflowTaskDeliverablePromotionHandoff): boolean {
  const completionState = normalizeCompletionState(
    readOptionalString(handoff.completion_state) ?? readOptionalString(handoff.completion),
  );
  return completionState !== null && FINAL_COMPLETION_STATES.has(completionState) && !isOrchestratorRole(handoff.role);
}

function buildPromotedDeliverableInput(
  handoff: WorkflowTaskDeliverablePromotionHandoff,
  workItemTitle: string | null,
  existingDescriptor: ExistingDescriptorRow | null,
  artifacts: ArtifactRow[],
  workItemId: string,
): UpsertWorkflowDeliverableInput {
  const progress = resolveDeliverableProgress(handoff, existingDescriptor);
  const artifactTargets = artifacts.map((artifact, index) =>
    buildArtifactTarget(artifact, index === 0),
  );
  const primaryTarget = artifactTargets[0] ?? {
    target_kind: 'inline_summary',
    label: progress === 'final' ? 'Review completion packet' : 'Review handoff packet',
  };
  const previewSummary = buildPreviewSummary(handoff);
  return {
    descriptorId: existingDescriptor?.id,
    workItemId,
    descriptorKind: CANONICAL_DELIVERABLE_PACKET_KIND,
    deliveryStage: progress,
    title: `${workItemTitle ?? 'Work item'} ${progress === 'final' ? 'completion' : 'handoff'} packet`,
    state: progress === 'final' ? 'final' : 'draft',
    summaryBrief: handoff.summary,
    previewCapabilities: artifacts.length > 0
      ? buildArtifactPreviewCapabilities(artifacts[0])
      : {
          can_inline_preview: true,
          can_download: false,
          can_open_external: false,
          can_copy_path: false,
          preview_kind: 'structured_summary',
        },
    primaryTarget,
    secondaryTargets: artifactTargets.slice(1),
    contentPreview: {
      summary: previewSummary,
    },
  };
}

function resolveDeliverableProgress(
  handoff: WorkflowTaskDeliverablePromotionHandoff,
  existingDescriptor: ExistingDescriptorRow | null,
): DeliverableProgress {
  if (
    readOptionalString(existingDescriptor?.delivery_stage) === 'final'
    || readOptionalString(existingDescriptor?.state) === 'final'
  ) {
    return 'final';
  }
  return 'final';
}

function buildPreviewSummary(handoff: WorkflowTaskDeliverablePromotionHandoff): string {
  const completionText = readOptionalString(handoff.completion);
  const detailLines = [
    handoff.summary,
    completionText && completionText !== 'full' ? completionText : null,
    readOptionalString(handoff.role) ? `Produced by: ${humanizeToken(handoff.role ?? '')}` : null,
  ];
  return detailLines.filter((line): line is string => Boolean(line)).join('\n\n');
}

function buildArtifactPreviewCapabilities(artifact: ArtifactRow): Record<string, unknown> {
  const contentType = readOptionalString(artifact.content_type) ?? '';
  return {
    can_inline_preview: true,
    can_download: true,
    can_open_external: false,
    can_copy_path: Boolean(readOptionalString(artifact.logical_path)),
    preview_kind: contentType.includes('markdown')
      ? 'markdown'
      : contentType.includes('json')
        ? 'json'
        : 'text',
  };
}

function buildArtifactTarget(artifact: ArtifactRow, primary: boolean): Record<string, unknown> {
  return {
    target_kind: 'artifact',
    label: primary ? 'Open artifact' : 'Artifact',
    url: `/api/v1/tasks/${encodeURIComponent(artifact.task_id)}/artifacts/${encodeURIComponent(artifact.id)}/preview`,
    path: readOptionalString(artifact.logical_path),
    artifact_id: artifact.id,
  };
}

function readOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const FINAL_COMPLETION_STATES = new Set(['approved', 'completed', 'final', 'full']);

function normalizeCompletionState(value: string | null): string | null {
  return value ? value.trim().toLowerCase() : null;
}

function humanizeToken(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function isOrchestratorRole(value: string | null): boolean {
  return readOptionalString(value)?.toLowerCase() === 'orchestrator';
}
