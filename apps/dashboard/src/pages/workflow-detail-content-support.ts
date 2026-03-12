import type { DashboardResolvedDocumentReference } from '../lib/api.js';

export interface ProjectMemoryEntryPacket {
  typeLabel: string;
  summary: string;
  detail: string;
  badges: string[];
  hasStructuredDetail: boolean;
}

export interface DocumentReferencePacket {
  summary: string;
  detail: string;
  badges: string[];
  locationLabel: string | null;
  hasMetadata: boolean;
}

export function describeProjectMemoryEntry(value: unknown): ProjectMemoryEntryPacket {
  if (value === null || value === undefined || value === '') {
    return {
      typeLabel: 'Empty',
      summary: 'No stored value',
      detail: 'This memory key exists without a payload yet.',
      badges: [],
      hasStructuredDetail: false,
    };
  }

  if (typeof value === 'string') {
    return {
      typeLabel: 'Text',
      summary: truncateText(value, 96),
      detail: `${value.length} characters of reusable operator context.`,
      badges: [],
      hasStructuredDetail: false,
    };
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return {
      typeLabel: typeof value === 'number' ? 'Number' : 'Flag',
      summary: String(value),
      detail: 'Scalar memory value available to future board runs.',
      badges: [],
      hasStructuredDetail: false,
    };
  }

  if (Array.isArray(value)) {
    const preview = value
      .slice(0, 4)
      .map((entry) => summarizeArrayEntry(entry))
      .filter((entry) => entry.length > 0);
    return {
      typeLabel: 'List',
      summary: `${value.length} item${value.length === 1 ? '' : 's'} recorded`,
      detail:
        preview.length > 0
          ? `Includes ${preview.join(', ')}.`
          : 'List-style memory payload for downstream reuse.',
      badges: preview,
      hasStructuredDetail: true,
    };
  }

  const record = asRecord(value);
  const keys = Object.keys(record);
  const nestedKeys = keys.filter((key) => isComplexValue(record[key]));
  return {
    typeLabel: 'Structured',
    summary: `${keys.length} field${keys.length === 1 ? '' : 's'} captured`,
    detail:
      nestedKeys.length > 0
        ? `${nestedKeys.length} nested section${nestedKeys.length === 1 ? '' : 's'} available for drill-down.`
        : 'Flat structured memory payload ready for operator review.',
    badges: keys.slice(0, 4).map((key) => humanizeKey(key)),
    hasStructuredDetail: true,
  };
}

export function describeDocumentReference(
  document: DashboardResolvedDocumentReference,
): DocumentReferencePacket {
  const badges = [humanizeKey(document.source), humanizeKey(document.scope)];
  if (document.task_id) {
    badges.push(`Task ${document.task_id}`);
  }
  if (document.artifact?.content_type) {
    badges.push(document.artifact.content_type);
  }
  return {
    summary: describeDocumentSource(document),
    detail:
      document.description?.trim().length
        ? document.description
        : 'Reference packet available to the orchestrator and specialists during board execution.',
    badges,
    locationLabel: describeDocumentLocation(document),
    hasMetadata: Object.keys(document.metadata ?? {}).length > 0,
  };
}

function summarizeArrayEntry(value: unknown): string {
  if (typeof value === 'string') {
    return truncateText(value, 24);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `${value.length} nested item${value.length === 1 ? '' : 's'}`;
  }
  const keys = Object.keys(asRecord(value));
  return keys.length > 0 ? humanizeKey(keys[0]) : '';
}

function humanizeKey(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function truncateText(value: string, limit: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= limit) {
    return trimmed;
  }
  return `${trimmed.slice(0, limit - 1)}…`;
}

function describeDocumentSource(document: DashboardResolvedDocumentReference): string {
  if (document.title?.trim().length) {
    return document.title;
  }
  if (document.source === 'artifact' && document.artifact?.logical_path) {
    return document.artifact.logical_path;
  }
  if (document.path?.trim().length) {
    return document.path;
  }
  if (document.url?.trim().length) {
    return document.url;
  }
  return document.logical_name;
}

function describeDocumentLocation(
  document: DashboardResolvedDocumentReference,
): string | null {
  if (document.repository && document.path) {
    return `${document.repository}:${document.path}`;
  }
  if (document.artifact?.logical_path) {
    return document.artifact.logical_path;
  }
  if (document.url) {
    return document.url;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isComplexValue(value: unknown): boolean {
  return Array.isArray(value) || Object.keys(asRecord(value)).length > 0;
}
