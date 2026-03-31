import { describeArtifactPreview } from '../artifact-service.js';
import { sanitizeSecretLikeRecord } from '../secret-redaction.js';
import type {
  WorkspaceArtifactExplorerRecord,
  WorkspaceArtifactExplorerRow,
  WorkspaceArtifactTaskFilterOption,
  WorkspaceArtifactWorkItemFilterOption,
  WorkspaceArtifactWorkflowFilterOption,
} from './workspace-artifact-explorer-types.js';

const ARTIFACT_METADATA_SECRET_REDACTION = 'redacted://artifact-metadata-secret';

export function mapArtifactRow(
  row: WorkspaceArtifactExplorerRow,
  previewMaxBytes: number,
): WorkspaceArtifactExplorerRecord {
  const preview = describeArtifactPreview(
    row.content_type,
    readInteger(row.size_bytes),
    previewMaxBytes,
  );
  return {
    id: row.id,
    workflow_id: row.workflow_id,
    task_id: row.task_id,
    logical_path: row.logical_path,
    content_type: row.content_type,
    size_bytes: readInteger(row.size_bytes),
    created_at: row.created_at.toISOString(),
    download_url: `/api/v1/tasks/${row.task_id}/artifacts/${row.id}`,
    metadata: sanitizeArtifactMetadata(row.metadata ?? {}),
    workflow_name: row.workflow_name,
    workflow_state: row.workflow_state,
    work_item_id: row.work_item_id,
    work_item_title: row.work_item_title,
    stage_name: row.stage_name,
    role: row.role,
    task_title: row.task_title,
    task_state: row.task_state,
    preview_eligible: preview.isPreviewEligible,
    preview_mode: preview.previewMode,
  };
}

export function readInteger(value: number | string | null | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

export function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .map((entry) => entry.trim());
}

export function readWorkflowOptions(value: unknown): WorkspaceArtifactWorkflowFilterOption[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const candidate = asRecord(entry);
    const id = readString(candidate.id);
    const name = readString(candidate.name);
    if (!id || !name) {
      return [];
    }
    return [{ id, name }];
  });
}

export function readWorkItemOptions(value: unknown): WorkspaceArtifactWorkItemFilterOption[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const candidate = asRecord(entry);
    const id = readString(candidate.id);
    const title = readString(candidate.title);
    if (!id || !title) {
      return [];
    }
    return [{
      id,
      title,
      workflow_id: readNullableString(candidate.workflow_id),
      stage_name: readNullableString(candidate.stage_name),
    }];
  });
}

export function readTaskOptions(value: unknown): WorkspaceArtifactTaskFilterOption[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const candidate = asRecord(entry);
    const id = readString(candidate.id);
    const title = readString(candidate.title);
    if (!id || !title) {
      return [];
    }
    return [{
      id,
      title,
      workflow_id: readNullableString(candidate.workflow_id),
      work_item_id: readNullableString(candidate.work_item_id),
      stage_name: readNullableString(candidate.stage_name),
    }];
  });
}

function sanitizeArtifactMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return sanitizeSecretLikeRecord(metadata, {
    redactionValue: ARTIFACT_METADATA_SECRET_REDACTION,
  });
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}
