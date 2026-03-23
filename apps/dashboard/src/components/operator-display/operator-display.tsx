import { useState } from 'react';

import { Badge } from '../ui/badge.js';
import { Button } from '../ui/button.js';
import { cn } from '../../lib/utils.js';

type StatusBadgeVariant = 'destructive' | 'outline' | 'secondary' | 'success' | 'warning';

export function CopyableIdBadge(props: {
  value: string | null | undefined;
  label?: string;
  className?: string;
}): JSX.Element | null {
  const [copied, setCopied] = useState(false);
  const value = props.value?.trim() ?? '';
  if (!value) {
    return null;
  }

  async function handleCopy(): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      return;
    }
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-full border border-border/70 bg-background/90 px-2 py-1 text-xs shadow-sm',
        props.className,
      )}
    >
      {props.label ? (
        <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted">
          {props.label}
        </span>
      ) : null}
      <code className="min-w-0 truncate font-mono text-[11px] text-foreground">
        {summarizeDisplayId(value)}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 px-2 text-[11px]"
        onClick={() => void handleCopy()}
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

export function RelativeTimestamp(props: {
  value: string | null | undefined;
  prefix?: string;
  className?: string;
}): JSX.Element {
  const relativeLabel = formatRelativeTimestampLabel(props.value);
  const absoluteLabel = formatAbsoluteTimestampLabel(props.value);
  return (
    <time
      className={cn('text-xs text-muted', props.className)}
      dateTime={props.value ?? undefined}
      title={absoluteLabel}
    >
      {props.prefix ? `${props.prefix} ${relativeLabel}` : relativeLabel}
    </time>
  );
}

export function OperatorStatusBadge(props: {
  status: string | null | undefined;
  className?: string;
  variant?: StatusBadgeVariant;
}): JSX.Element {
  const status = props.status?.trim() ?? '';
  return (
    <Badge
      variant={props.variant ?? statusVariantForOperatorState(status)}
      className={props.className}
    >
      {formatOperatorStatusLabel(status)}
    </Badge>
  );
}

export function summarizeDisplayId(value: string | null | undefined): string {
  if (!value) {
    return '-';
  }
  if (value.length <= 16) {
    return value;
  }
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

export function formatOperatorStatusLabel(value: string | null | undefined): string {
  const normalized = normalizeStatusKey(value);
  if (!normalized) {
    return 'Unknown';
  }
  return normalized
    .split('_')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

export function statusVariantForOperatorState(
  value: string | null | undefined,
): StatusBadgeVariant {
  switch (normalizeStatusKey(value)) {
    case 'completed':
    case 'approved':
    case 'succeeded':
      return 'success';
    case 'failed':
    case 'cancelled':
    case 'blocked':
    case 'rejected':
      return 'destructive';
    case 'awaiting_approval':
    case 'output_pending_assessment':
    case 'changes_requested':
    case 'queued':
    case 'paused':
    case 'stale':
      return 'warning';
    case 'in_progress':
    case 'running':
    case 'processing':
    case 'active':
    case 'escalated':
      return 'secondary';
    default:
      return 'outline';
  }
}

export function formatRelativeTimestampLabel(
  value: string | null | undefined,
  now = Date.now(),
): string {
  if (!value) {
    return '-';
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }
  const deltaSeconds = Math.round((now - timestamp) / 1000);
  const absSeconds = Math.abs(deltaSeconds);
  if (absSeconds < 60) {
    return deltaSeconds >= 0 ? `${absSeconds}s ago` : `in ${absSeconds}s`;
  }
  const absMinutes = Math.round(absSeconds / 60);
  if (absMinutes < 60) {
    return deltaSeconds >= 0 ? `${absMinutes}m ago` : `in ${absMinutes}m`;
  }
  const absHours = Math.round(absMinutes / 60);
  if (absHours < 24) {
    return deltaSeconds >= 0 ? `${absHours}h ago` : `in ${absHours}h`;
  }
  const absDays = Math.round(absHours / 24);
  return deltaSeconds >= 0 ? `${absDays}d ago` : `in ${absDays}d`;
}

export function formatAbsoluteTimestampLabel(value: string | null | undefined): string {
  if (!value) {
    return '-';
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? value : new Date(timestamp).toLocaleString();
}

function normalizeStatusKey(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
}
