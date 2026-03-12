import { useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Filter } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '../../lib/utils.js';
import type { LogEntry } from '../../lib/api.js';
import { buildWorkflowDetailPermalink } from '../../pages/workflow-detail-permalinks.js';
import { Button } from '../ui/button.js';
import { LogEntryDetailLlm } from './log-entry-detail-llm.js';
import { LogEntryDetailTool } from './log-entry-detail-tool.js';
import { LogEntryDetailConfig } from './log-entry-detail-config.js';
import { LogEntryDetailAuth } from './log-entry-detail-auth.js';
import { LogEntryDetailApi } from './log-entry-detail-api.js';
import { LogEntryDetailContainer } from './log-entry-detail-container.js';
import { LogEntryDetailTask } from './log-entry-detail-task.js';
import { LogEntryDetailAgent } from './log-entry-detail-agent.js';

export interface LogEntryDetailProps {
  entry: LogEntry;
  onFilterTrace?: (traceId: string) => void;
}

function CategoryDetail({ entry }: { entry: LogEntry }): JSX.Element | null {
  const payload = entry.payload;
  if (!payload) return null;

  switch (entry.category) {
    case 'llm':
      return <LogEntryDetailLlm payload={payload} />;
    case 'tool':
      return <LogEntryDetailTool payload={payload} />;
    case 'config':
      return <LogEntryDetailConfig payload={payload} />;
    case 'auth':
      return <LogEntryDetailAuth payload={payload} />;
    case 'api':
      return <LogEntryDetailApi payload={payload} />;
    case 'container':
    case 'runtime_lifecycle':
      return <LogEntryDetailContainer payload={payload} />;
    case 'task_lifecycle':
      return <LogEntryDetailTask payload={payload} />;
    case 'agent_loop':
      return <LogEntryDetailAgent payload={payload} />;
    default:
      return null;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatActorType(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, ' ');
}

const RUNTIME_PREFIX = 'agirunner-runtime-';
const KEY_PREFIX_RE = /^(?:Key|Worker|Agent|User)\s+ar_/;

function resolveActorLabel(entry: LogEntry): string {
  if (entry.actor_name) {
    if (KEY_PREFIX_RE.test(entry.actor_name)) {
      return entry.actor_name.split(' ')[0];
    }
    if (entry.actor_name.startsWith(RUNTIME_PREFIX)) {
      return entry.actor_type ? formatActorType(entry.actor_type) : 'Runtime Worker';
    }
    if (!UUID_RE.test(entry.actor_name)) {
      return entry.actor_name;
    }
  }
  return entry.actor_type ? formatActorType(entry.actor_type) : 'Unknown';
}

const DETAIL_CATEGORY_LABELS: Record<string, string> = {
  llm: 'LLM',
  tool: 'Tool',
  agent_loop: 'Agent Loop',
  task_lifecycle: 'Execution Step Lifecycle',
  runtime_lifecycle: 'Runtime Lifecycle',
  container: 'Container',
  api: 'API',
  config: 'Config',
  auth: 'Auth',
};

function formatDetailTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <>
      <div className="text-muted-foreground whitespace-nowrap py-0.5">{label}</div>
      <div className="py-0.5">{children}</div>
    </>
  );
}

function TraceContextSection({ entry }: { entry: LogEntry }): JSX.Element {
  const role =
    entry.role ??
    (typeof entry.payload?.role === 'string' && entry.payload.role !== ''
      ? entry.payload.role
      : null);
  const stageName = entry.stage_name && entry.stage_name !== '' ? entry.stage_name : null;

  return (
    <div className="rounded-md border border-border p-4">
      <h4 className="mb-3 text-sm font-semibold">Trace & Context</h4>
      <div className="grid max-w-lg grid-cols-[auto_1fr] gap-x-6 gap-y-0 text-sm">
        <DetailRow label="Timestamp">
          <span className="font-mono text-xs">{formatDetailTimestamp(entry.created_at)}</span>
        </DetailRow>
        <DetailRow label="Level">
          <span className="inline-block rounded px-1 py-px text-[10px] leading-tight uppercase font-mono font-medium">
            {entry.level}
          </span>
        </DetailRow>
        <DetailRow label="Category">
          {DETAIL_CATEGORY_LABELS[entry.category] ?? entry.category}
        </DetailRow>
        <DetailRow label="Operation">
          <span className="font-medium">{entry.operation}</span>
        </DetailRow>
        <DetailRow label="Status">{entry.status}</DetailRow>
        <DetailRow label="Duration">
          <span className="font-mono text-xs">{formatDuration(entry.duration_ms)}</span>
        </DetailRow>
        {(entry.project_name || entry.project_id) && (
          <DetailRow label="Project">
            {entry.project_name ?? (
              <span className="font-mono text-xs text-muted-foreground/60">{entry.project_id}</span>
            )}
          </DetailRow>
        )}
        {(entry.workflow_name || entry.workflow_id) && (
          <DetailRow label="Board">
            {entry.workflow_name ?? (
              <span className="font-mono text-xs text-muted-foreground/60">
                {entry.workflow_id}
              </span>
            )}
          </DetailRow>
        )}
        {entry.task_id && (
          <DetailRow label="Step ID">
            <span className="font-mono text-xs">{entry.task_id}</span>
          </DetailRow>
        )}
        {entry.work_item_id && (
          <DetailRow label="Work Item ID">
            <span className="font-mono text-xs">{entry.work_item_id}</span>
          </DetailRow>
        )}
        {entry.task_title && (
          <DetailRow label="Step Title">
            <span className="font-medium">{entry.task_title}</span>
          </DetailRow>
        )}
        {stageName && (
          <DetailRow label="Stage">
            <span className="font-medium">{stageName}</span>
          </DetailRow>
        )}
        {entry.activation_id && (
          <DetailRow label="Activation ID">
            <span className="font-mono text-xs">{entry.activation_id}</span>
          </DetailRow>
        )}
        {entry.is_orchestrator_task && (
          <DetailRow label="Step Kind">
            <span className="font-medium">Orchestrator</span>
          </DetailRow>
        )}
        {role && (
          <DetailRow label="Role">
            <span className="font-medium">{role as string}</span>
          </DetailRow>
        )}
        <DetailRow label="Actor">
          <span className="text-muted-foreground">{formatActorType(entry.actor_type)}</span>
          {' · '}
          {resolveActorLabel(entry)}
        </DetailRow>
        {entry.actor_id && (
          <DetailRow label="Actor ID">
            <span
              className={cn(
                'font-mono text-xs',
                UUID_RE.test(entry.actor_id) && 'text-muted-foreground/60',
              )}
            >
              {entry.actor_id}
            </span>
          </DetailRow>
        )}
        <DetailRow label="Trace ID">
          <span className="font-mono text-xs">{entry.trace_id}</span>
        </DetailRow>
        <DetailRow label="Span ID">
          <span className="font-mono text-xs">{entry.span_id}</span>
        </DetailRow>
      </div>
    </div>
  );
}

function ErrorSection({ error }: { error: NonNullable<LogEntry['error']> }): JSX.Element {
  return (
    <div className="rounded-md border border-red-600/40 bg-red-950/20 p-4">
      <h4 className="mb-2 text-sm font-semibold text-red-400">Error</h4>
      {error.code && <div className="mb-1 font-mono text-xs text-red-300">{error.code}</div>}
      <div className="text-sm text-red-200">{error.message}</div>
    </div>
  );
}

function PayloadSection({ payload }: { payload: Record<string, unknown> }): JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="rounded-md border border-border p-4">
      <button
        type="button"
        className="flex w-full items-center gap-1 text-sm font-semibold"
        onClick={() => setIsExpanded((prev) => !prev)}
      >
        {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        Raw Payload
      </button>
      {isExpanded && (
        <pre className="mt-2 max-h-80 overflow-auto rounded bg-card p-3 text-xs">
          {JSON.stringify(payload, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function LogEntryDetail({ entry, onFilterTrace }: LogEntryDetailProps): JSX.Element {
  const [isCopied, setIsCopied] = useState(false);

  function handleCopyJson(): void {
    void navigator.clipboard.writeText(JSON.stringify(entry, null, 2)).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 1500);
    });
  }

  function handleFilterTrace(): void {
    onFilterTrace?.(entry.trace_id);
  }

  const workflowPermalink = entry.workflow_id
    ? buildWorkflowLink(entry)
    : null;

  return (
    <div className={cn('space-y-4 px-4 pb-4')}>
      <TraceContextSection entry={entry} />

      <CategoryDetail entry={entry} />

      {entry.error && <ErrorSection error={entry.error} />}

      {entry.payload && <PayloadSection payload={entry.payload} />}

      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={handleCopyJson}>
          <Copy className="mr-1 h-3 w-3" />
          {isCopied ? 'Copied' : 'Copy as JSON'}
        </Button>
        {onFilterTrace && (
          <Button variant="outline" size="sm" onClick={handleFilterTrace}>
            <Filter className="mr-1 h-3 w-3" />
            Filter to this trace
          </Button>
        )}
        {workflowPermalink ? (
          <Button variant="outline" size="sm" asChild>
            <Link to={workflowPermalink}>Open workflow context</Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function buildWorkflowLink(entry: LogEntry): string {
  return buildWorkflowDetailPermalink(entry.workflow_id as string, {
    workItemId: entry.work_item_id ?? null,
    activationId: entry.activation_id ?? null,
    gateStageName:
      entry.stage_name && !entry.work_item_id && !entry.activation_id ? entry.stage_name : null,
  });
}
