import type {
  DashboardPlatformInstructionRecord,
  DashboardPlatformInstructionVersionRecord,
} from '../../lib/api.js';

type PlatformInstructionDocument =
  | DashboardPlatformInstructionRecord
  | DashboardPlatformInstructionVersionRecord;

function isHistoricalVersion(
  document: PlatformInstructionDocument,
): document is DashboardPlatformInstructionVersionRecord {
  return 'created_at' in document;
}

export function chooseComparedPlatformInstructionVersion(
  versions: DashboardPlatformInstructionVersionRecord[],
  currentVersion: number,
): DashboardPlatformInstructionVersionRecord | null {
  return versions.find((version) => version.version !== currentVersion) ?? versions[0] ?? null;
}

export function buildPlatformInstructionVersionLabel(
  version: DashboardPlatformInstructionVersionRecord,
  currentVersion: number,
): string {
  const parts = [`v${version.version}`];
  if (version.version === currentVersion) {
    parts.push('current');
  }
  if (version.created_at) {
    parts.push(formatTimestamp(version.created_at));
  }
  return parts.join(' • ');
}

export function renderPlatformInstructionSnapshot(
  document: PlatformInstructionDocument | null,
): string {
  if (!document) {
    return 'No platform instructions recorded.';
  }
  return [
    `Version: v${document.version}`,
    `Format: ${document.format ?? 'text'}`,
    `Saved: ${readDocumentTimestamp(document)}`,
    `Updated by: ${readDocumentActor(document)}`,
  ].join('\n');
}

function formatTimestamp(timestamp: string): string {
  return new Date(timestamp).toLocaleString();
}

function readDocumentTimestamp(document: PlatformInstructionDocument): string {
  if (isHistoricalVersion(document)) {
    return document.created_at ? formatTimestamp(document.created_at) : 'never';
  }
  return document.updated_at ? formatTimestamp(document.updated_at) : 'never';
}

function readDocumentActor(document: PlatformInstructionDocument): string {
  if (isHistoricalVersion(document)) {
    return document.created_by_type && document.created_by_id
      ? `${document.created_by_type}:${document.created_by_id}`
      : 'unknown';
  }
  return document.updated_by_type && document.updated_by_id
    ? `${document.updated_by_type}:${document.updated_by_id}`
    : 'unknown';
}
