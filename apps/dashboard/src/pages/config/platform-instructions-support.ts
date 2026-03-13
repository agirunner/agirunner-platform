import type {
  DashboardPlatformInstructionRecord,
  DashboardPlatformInstructionVersionRecord,
} from '../../lib/api.js';

type PlatformInstructionDocument =
  | DashboardPlatformInstructionRecord
  | DashboardPlatformInstructionVersionRecord;

export interface PlatformInstructionSummaryCard {
  label: string;
  value: string;
  detail: string;
}

export interface PlatformInstructionDraftStatus {
  tone: 'ready' | 'warning' | 'neutral';
  title: string;
  detail: string;
}

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

export function buildPlatformInstructionSummaryCards(
  currentInstruction: DashboardPlatformInstructionRecord,
  versions: DashboardPlatformInstructionVersionRecord[],
  editorContent: string,
  hasUnsavedChanges: boolean,
): PlatformInstructionSummaryCard[] {
  const draftLineCount = countLines(editorContent);
  const draftWordCount = countWords(editorContent);
  return [
    {
      label: 'Active baseline',
      value: `v${currentInstruction.version}`,
      detail: currentInstruction.updated_at
        ? `Last saved ${formatTimestamp(currentInstruction.updated_at)}`
        : 'No saved timestamp recorded yet.',
    },
    {
      label: 'History depth',
      value: `${versions.length} saved version${versions.length === 1 ? '' : 's'}`,
      detail:
        versions.length > 1
          ? `${versions.length - 1} restore point${versions.length - 1 === 1 ? '' : 's'} available beyond the live version.`
          : 'Only the current version is recorded so far.',
    },
    {
      label: 'Draft posture',
      value: hasUnsavedChanges ? 'Unsaved changes' : 'Current draft clean',
      detail:
        draftWordCount === 0
          ? 'Draft is empty.'
          : `${draftWordCount} words across ${draftLineCount} line${draftLineCount === 1 ? '' : 's'}.`,
    },
  ];
}

export function buildPlatformInstructionDraftStatus(
  currentInstruction: DashboardPlatformInstructionRecord,
  editorContent: string,
  hasUnsavedChanges: boolean,
): PlatformInstructionDraftStatus {
  const trimmed = editorContent.trim();
  if (hasUnsavedChanges && trimmed.length === 0) {
    return {
      tone: 'warning',
      title: 'Draft will clear the live baseline.',
      detail: 'Save only when you intentionally want an empty platform-instructions version.',
    };
  }
  if (hasUnsavedChanges) {
    return {
      tone: 'ready',
      title: 'Draft is ready to save.',
      detail: `Saving writes a new version after v${currentInstruction.version}.`,
    };
  }
  if (trimmed.length === 0) {
    return {
      tone: 'neutral',
      title: 'No active instructions in the editor.',
      detail: 'Draft baseline guidance here or restore a saved version.',
    };
  }
  return {
    tone: 'neutral',
    title: 'Editor matches the current saved version.',
    detail: 'No unsaved draft changes detected.',
  };
}

function formatTimestamp(timestamp: string): string {
  return new Date(timestamp).toLocaleString();
}

function countLines(value: string): number {
  if (!value.trim()) {
    return 0;
  }
  return value.split(/\r?\n/).length;
}

function countWords(value: string): number {
  const words = value.trim().match(/\S+/g);
  return words ? words.length : 0;
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
