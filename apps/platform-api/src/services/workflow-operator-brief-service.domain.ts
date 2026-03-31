import {
  sanitizeLinkedIdList,
  sanitizeOptionalText,
} from './workflow-operator-record-sanitization.js';
import type {
  ArtifactRow,
  WorkflowOperatorBriefRow,
} from './workflow-operator-brief-service.types.js';
import type { WorkflowOperatorBriefRecord } from './workflow-operator-brief-service.js';

export function deriveDefaultBriefScope(
  executionContext: { workItemId?: string | null; taskId?: string | null },
  payload: { linkedDeliverables?: Array<unknown> },
  statusKind: string | null,
): string {
  if (Array.isArray(payload.linkedDeliverables) && payload.linkedDeliverables.length > 0) {
    return 'deliverable_context';
  }
  if (
    (executionContext.workItemId || executionContext.taskId)
    && isDeliverableOutcomeStatus(statusKind)
  ) {
    return 'deliverable_context';
  }
  if (executionContext.workItemId || executionContext.taskId) {
    return 'work_item_handoff';
  }
  return 'workflow_timeline';
}

export function isDeliverableOutcomeStatus(statusKind: string | null): boolean {
  return statusKind === 'completed' || statusKind === 'final' || statusKind === 'approved';
}

export function resolveEffectiveStatusKind(
  inputStatusKind: string | undefined,
  detailedBriefJson: Record<string, unknown>,
  briefScope: string,
): string {
  return (
    sanitizeOptionalText(inputStatusKind) ??
    sanitizeOptionalText(asRecord(detailedBriefJson).status_kind) ??
    deriveDefaultStatusKind(briefScope)
  );
}

function deriveDefaultStatusKind(briefScope: string): string {
  return briefScope === 'work_item_handoff' ? 'handoff' : 'in_progress';
}

export function withDefaultStatusKind(
  detailedBriefJson: Record<string, unknown>,
  statusKind: string,
): Record<string, unknown> {
  const record = asRecord(detailedBriefJson);
  if (sanitizeOptionalText(record.status_kind)) {
    return record;
  }
  return {
    ...record,
    status_kind: statusKind,
  };
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export function shouldMaterializeDeliverablePacket(brief: WorkflowOperatorBriefRow): boolean {
  if (brief.brief_scope !== 'deliverable_context') {
    return false;
  }
  if (!isDeliverableOutcomeStatus(sanitizeOptionalText(brief.status_kind))) {
    return false;
  }
  if (isChildScopedOrchestratorDeliverableBrief(brief)) {
    return false;
  }
  return true;
}

export function isChildScopedOrchestratorDeliverableBrief(brief: WorkflowOperatorBriefRow): boolean {
  if (!isOrchestratorBrief(brief)) {
    return false;
  }
  return Boolean(
    sanitizeOptionalText(brief.work_item_id)
    || sanitizeOptionalText(brief.task_id)
    || isWorkflowScopedOrchestratorBriefLinkedToChildScope(brief),
  );
}

export function isWorkflowScopedOrchestratorBriefLinkedToChildScope(brief: WorkflowOperatorBriefRow): boolean {
  if (sanitizeOptionalText(brief.work_item_id)) {
    return false;
  }
  if (!isOrchestratorBrief(brief)) {
    return false;
  }
  const workflowId = sanitizeOptionalText(brief.workflow_id);
  return sanitizeLinkedIdList(brief.linked_target_ids).some((targetId) => targetId !== workflowId);
}

export function isOrchestratorBrief(brief: WorkflowOperatorBriefRow): boolean {
  return isOrchestratorRole(brief.source_kind) || isOrchestratorRole(brief.source_role_name);
}

export function isOrchestratorRole(value: string | null | undefined): boolean {
  return sanitizeOptionalText(value)?.toLowerCase() === 'orchestrator';
}

export function readBriefHeadline(brief: WorkflowOperatorBriefRow): string {
  return sanitizeOptionalText(asRecord(brief.detailed_brief_json).headline)
    ?? sanitizeOptionalText(asRecord(brief.short_brief).headline)
    ?? 'Workflow deliverable packet';
}

export function readBriefSummary(brief: WorkflowOperatorBriefRow): string | undefined {
  return sanitizeOptionalText(asRecord(brief.detailed_brief_json).summary)
    ?? sanitizeOptionalText(asRecord(brief.short_brief).headline)
    ?? undefined;
}

export function buildBriefPreviewSummary(brief: WorkflowOperatorBriefRow): string {
  const parts = [
    readBriefHeadline(brief),
    sanitizeOptionalText(asRecord(brief.detailed_brief_json).summary),
    brief.source_role_name ? `Produced by: ${brief.source_role_name}` : null,
  ];
  return parts.filter((part): part is string => typeof part === 'string' && part.length > 0).join('\n\n');
}

export function buildInlinePreviewCapabilities(): Record<string, unknown> {
  return {
    can_inline_preview: true,
    can_download: false,
    can_open_external: false,
    can_copy_path: false,
    preview_kind: 'structured_summary',
  };
}

export function buildInlineSummaryTarget(): Record<string, unknown> {
  return {
    target_kind: 'inline_summary',
    label: 'Review completion packet',
  };
}

export function buildArtifactPreviewCapabilities(artifact: ArtifactRow): Record<string, unknown> {
  const contentType = sanitizeOptionalText(artifact.content_type) ?? '';
  return {
    can_inline_preview: true,
    can_download: true,
    can_open_external: false,
    can_copy_path: Boolean(sanitizeOptionalText(artifact.logical_path)),
    preview_kind: contentType.includes('markdown')
      ? 'markdown'
      : contentType.includes('json')
        ? 'json'
        : 'text',
  };
}

export function buildArtifactTarget(artifact: ArtifactRow, primary: boolean): Record<string, unknown> {
  return {
    target_kind: 'artifact',
    label: primary ? 'Open artifact' : 'Artifact',
    url: `/api/v1/tasks/${encodeURIComponent(artifact.task_id)}/artifacts/${encodeURIComponent(artifact.id)}/preview`,
    path: sanitizeOptionalText(artifact.logical_path),
    artifact_id: artifact.id,
    size_bytes: artifact.size_bytes,
  };
}

export function toWorkflowOperatorBriefRecord(row: WorkflowOperatorBriefRow): WorkflowOperatorBriefRecord {
  return {
    id: row.id,
    workflow_id: row.workflow_id,
    work_item_id: row.work_item_id,
    task_id: row.task_id,
    request_id: row.request_id,
    execution_context_id: row.execution_context_id,
    brief_kind: row.brief_kind,
    brief_scope: row.brief_scope,
    source_kind: row.source_kind,
    source_role_name: row.source_role_name,
    llm_turn_count: row.llm_turn_count ?? null,
    status_kind: row.status_kind,
    short_brief: row.short_brief ?? {},
    detailed_brief_json: row.detailed_brief_json ?? {},
    linked_target_ids: row.linked_target_ids ?? [],
    sequence_number: row.sequence_number,
    related_artifact_ids: row.related_artifact_ids ?? [],
    related_output_descriptor_ids: row.related_output_descriptor_ids ?? [],
    related_intervention_ids: row.related_intervention_ids ?? [],
    canonical_workflow_brief_id: row.canonical_workflow_brief_id,
    created_by_type: row.created_by_type,
    created_by_id: row.created_by_id,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export function serializeJsonb(value: unknown): string {
  return JSON.stringify(value);
}

export function sanitizeOptionalPositiveInteger(value: number | undefined): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return null;
  }
  return value;
}

export function normalizeNullableText(value: string | null | undefined): string | null {
  return sanitizeOptionalText(value) ?? null;
}
