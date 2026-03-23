import type { DashboardEventRecord } from '../../lib/api.js';
import { describeTimelineEvent } from './workflow-history-card.js';
import { formatRelativeTimestamp } from './workflow-detail-presentation.js';

export interface WorkItemHistoryMetric {
  label: string;
  value: string;
  detail: string;
}

export interface WorkItemHistoryOverview {
  focusLabel: string;
  focusTone: 'secondary' | 'warning' | 'destructive' | 'success';
  focusDetail: string;
  metrics: WorkItemHistoryMetric[];
}

export interface WorkItemHistoryPacket {
  id: string;
  headline: string;
  summary: string | null;
  scopeSummary: string | null;
  emphasisLabel: string;
  emphasisTone: 'secondary' | 'warning' | 'destructive' | 'success';
  signalBadges: string[];
  stageName: string | null;
  workItemId: string | null;
  taskId: string | null;
  actor: string | null;
  createdAtLabel: string;
  createdAtTitle: string;
  payload: DashboardEventRecord['data'];
}

export function buildWorkItemHistoryOverview(
  events: DashboardEventRecord[],
): WorkItemHistoryOverview {
  if (events.length === 0) {
    return {
      focusLabel: 'No operator activity yet',
      focusTone: 'secondary',
      focusDetail: 'Activity packets will appear here once work-item events start landing.',
      metrics: [],
    };
  }

  const packets = events.map(buildWorkItemHistoryPacket);
  const latest = packets[0];
  const attentionCount = packets.filter(
    (packet) => packet.emphasisTone === 'warning' || packet.emphasisTone === 'destructive',
  ).length;
  const stageCount = new Set(packets.map((packet) => packet.stageName).filter(Boolean)).size;
  const stepCount = new Set(packets.map((packet) => packet.taskId).filter(Boolean)).size;

  return {
    focusLabel: latest.emphasisLabel,
    focusTone: latest.emphasisTone,
    focusDetail:
      latest.scopeSummary
      ?? latest.summary
      ?? 'Latest activity is ready for operator review.',
    metrics: [
      {
        label: 'Activity packets',
        value: String(packets.length),
        detail: 'Newest activity is listed first for rapid review.',
      },
      {
        label: 'Attention signals',
        value: String(attentionCount),
        detail: 'Warnings and failures that may need operator follow-up.',
      },
      {
        label: 'Linked stages',
        value: String(stageCount),
        detail: 'Distinct board stages represented in this history slice.',
      },
      {
        label: 'Linked steps',
        value: String(stepCount),
        detail: 'Specialist steps referenced by the recorded activity.',
      },
    ],
  };
}

export function buildWorkItemHistoryPacket(event: DashboardEventRecord): WorkItemHistoryPacket {
  const descriptor = describeTimelineEvent(event);

  return {
    id: event.id,
    headline: coerceDisplayText(descriptor.headline, humanizeEventType(event.type)),
    summary: coerceOptionalDisplayText(descriptor.summary),
    scopeSummary: coerceOptionalDisplayText(descriptor.scopeSummary),
    emphasisLabel: coerceDisplayText(descriptor.emphasisLabel, 'Recorded activity'),
    emphasisTone: descriptor.emphasisTone,
    signalBadges: coerceDisplayList(descriptor.signalBadges),
    stageName: coerceOptionalDisplayText(descriptor.stageName),
    workItemId: coerceOptionalDisplayText(descriptor.workItemId),
    taskId: coerceOptionalDisplayText(descriptor.taskId),
    actor: coerceOptionalDisplayText(descriptor.actor),
    createdAtLabel: formatRelativeTimestamp(event.created_at),
    createdAtTitle: formatTimestamp(event.created_at),
    payload: event.data,
  };
}

function formatTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? value : new Date(timestamp).toLocaleString();
}

function coerceDisplayList(values: readonly unknown[]): string[] {
  return values
    .map((value) => coerceOptionalDisplayText(value))
    .filter((value): value is string => Boolean(value));
}

function coerceDisplayText(value: unknown, fallback: string): string {
  return coerceOptionalDisplayText(value) ?? fallback;
}

function coerceOptionalDisplayText(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    const values = coerceDisplayList(value);
    return values.length > 0 ? values.join(', ') : null;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return (
      coerceOptionalDisplayText(record.label) ??
      coerceOptionalDisplayText(record.title) ??
      coerceOptionalDisplayText(record.name) ??
      coerceOptionalDisplayText(record.summary) ??
      coerceOptionalDisplayText(record.message) ??
      coerceOptionalDisplayText(record.id) ??
      coerceOptionalDisplayText(record.count) ??
      null
    );
  }
  return null;
}

function humanizeEventType(eventType: string): string {
  return eventType
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
