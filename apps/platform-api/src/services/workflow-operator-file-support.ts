import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { DEFAULT_ARTIFACT_CONTENT_TYPE } from '../content/storage-config.js';
import { ValidationError } from '../errors/domain-errors.js';

export interface WorkflowOperatorFileUploadInput {
  fileName: string;
  description?: string;
  contentBase64: string;
  contentType?: string;
}

export interface WorkflowOperatorStoredFileRecord {
  id: string;
  fileName: string;
  description: string | null;
  storageBackend: string;
  storageKey: string;
  contentType: string;
  sizeBytes: number;
  checksumSha256: string;
}

export function buildWorkflowOperatorFileRecordId(): string {
  return randomUUID();
}

export function sanitizeWorkflowOperatorFileName(value: string): string {
  const fileName = path.basename(value.trim());
  if (!fileName) {
    throw new ValidationError('Workflow attachment file name is required');
  }
  if (fileName.length > 255) {
    throw new ValidationError('Workflow attachment file name must be at most 255 characters');
  }
  return fileName;
}

export function sanitizeWorkflowOperatorFileDescription(value?: string): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length > 2000) {
    throw new ValidationError('Workflow attachment description must be at most 2000 characters');
  }
  return trimmed;
}

export function decodeWorkflowOperatorFilePayload(contentBase64: string, maxUploadBytes: number): Buffer {
  try {
    const payload = Buffer.from(contentBase64, 'base64');
    if (payload.length === 0) {
      throw new ValidationError('Workflow attachment payload cannot be empty');
    }
    if (payload.length > maxUploadBytes) {
      throw new ValidationError(`Workflow attachment file exceeds ${maxUploadBytes} bytes`);
    }
    return payload;
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    throw new ValidationError('Workflow attachment payload must be valid base64');
  }
}

export function resolveWorkflowOperatorFileContentType(value?: string): string {
  const contentType = value?.trim();
  return contentType && contentType.length > 0 ? contentType : DEFAULT_ARTIFACT_CONTENT_TYPE;
}

export function buildWorkflowOperatorStorageKey(params: {
  tenantId: string;
  workflowId: string;
  ownerPath: string;
  ownerId: string;
  fileId: string;
  fileName: string;
}): string {
  return [
    'tenants',
    sanitizeWorkflowOperatorStorageSegment(params.tenantId, 'Tenant'),
    'workflows',
    sanitizeWorkflowOperatorStorageSegment(params.workflowId, 'Workflow'),
    sanitizeWorkflowOperatorStorageSegment(params.ownerPath, 'Workflow file owner path'),
    sanitizeWorkflowOperatorStorageSegment(params.ownerId, 'Workflow file owner'),
    'files',
    sanitizeWorkflowOperatorStorageSegment(params.fileId, 'Workflow file'),
    params.fileName,
  ].join('/');
}

function sanitizeWorkflowOperatorStorageSegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ValidationError(`${label} storage path segment is required`);
  }
  if (trimmed === '.' || trimmed === '..' || trimmed.includes('/') || trimmed.includes('\\')) {
    throw new ValidationError(`${label} storage path segment is invalid`);
  }
  return trimmed;
}
