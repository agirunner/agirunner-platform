import { useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Filter } from 'lucide-react';
import { Link } from 'react-router-dom';
import { describeGenericExecutionBackendSurface, describeGenericToolOwnerSurface } from '../../lib/operator-surfaces.js';
import { cn } from '../../lib/utils.js';
import type { LogEntry } from '../../lib/api.js';
import { buildWorkflowDetailPermalink } from '../../pages/workflow-detail/workflow-detail-permalinks.js';
import { Button } from '../ui/button.js';
import { LogEntryDetailLlm } from './log-entry-detail-llm.js';
import { LogEntryDetailTool } from './log-entry-detail-tool.js';
import { LogEntryDetailConfig } from './log-entry-detail-config.js';
import { LogEntryDetailAuth } from './log-entry-detail-auth.js';
import { LogEntryDetailApi } from './log-entry-detail-api.js';
import { LogEntryDetailContainer } from './log-entry-detail-container.js';
import { LogEntryDetailTask } from './log-entry-detail-task.js';
import { LogEntryDetailAgent } from './log-entry-detail-agent.js';
import { isEscalationEntry } from './log-entry-presentation.js';

const DETAIL_SECTION_CLASS_NAME = 'rounded-lg border border-border/80 bg-surface/90 p-4 shadow-sm';

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
const GENERIC_ACTOR_NAMES = new Set([
  'runtime',
  'worker',
  'agent',
  'specialist agent',
  'specialist execution',
  'orchestrator agent',
  'orchestrator execution',
]);

function resolveActorLabel(entry: LogEntry): string {
  if (entry.actor_name) {
    const normalized = entry.actor_name.trim().toLowerCase();
    if (KEY_PREFIX_RE.test(entry.actor_name)) {
      return entry.actor_name.split(' ')[0];
    }
    if (GENERIC_ACTOR_NAMES.has(normalized)) {
      return describeActorSurface(entry);
    }
    if (entry.actor_name.startsWith(RUNTIME_PREFIX)) {
      return describeActorSurface(entry);
    }
    if (!UUID_RE.test(entry.actor_name)) {
      return entry.actor_name;
    }
  }
  return describeActorSurface(entry);
}

function describeActorSurface(entry: LogEntry): string {
  if (entry.actor_type === 'worker') {
    return entry.role?.trim()?.toLowerCase() === 'orchestrator'
      ? 'Orchestrator agent'
      : 'Specialist Agent';
  }
  if (entry.actor_type === 'agent') {
    return entry.role?.trim()?.toLowerCase() === 'orchestrator'
      ? 'Orchestrator execution'
      : 'Specialist Execution';
  }
  return entry.actor_type ? formatActorType(entry.actor_type) : 'Unknown';
}

const DETAIL_CATEGORY_LABELS: Record<string, string> = {
  llm: 'LLM',
  tool: 'Tool',
  agent_loop: 'Agent Loop',
  task_lifecycle: 'Execution Step Lifecycle',
  runtime_lifecycle: 'Agent Lifecycle',
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
    <div className={DETAIL_SECTION_CLASS_NAME}>
      <h4 className="mb-1 text-sm font-semibold">Execution packet</h4>
      <p className="mb-3 text-xs text-muted-foreground">
        Workflow, stage, and specialist-step context for this activity.
      </p>
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
        {(entry.workspace_name || entry.workspace_id) && (
          <DetailRow label="Workspace">
            {entry.workspace_name ?? (
              <span className="font-mono text-xs text-muted-foreground/60">{entry.workspace_id}</span>
            )}
          </DetailRow>
        )}
        {(entry.workflow_name || entry.workflow_id) && (
          <DetailRow label="Workflow">
            {entry.workflow_name ?? (
              <span className="font-mono text-xs text-muted-foreground/60">
                {entry.workflow_id}
              </span>
            )}
          </DetailRow>
        )}
        {entry.task_id && (
          <DetailRow label="Step">
            <span className="font-mono text-xs">{entry.task_id}</span>
          </DetailRow>
        )}
        {entry.work_item_id && (
          <DetailRow label="Work item">
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
          <DetailRow label="Activation">
            <span className="font-mono text-xs">{entry.activation_id}</span>
          </DetailRow>
        )}
        {entry.is_orchestrator_task && (
          <DetailRow label="Step Kind">
            <span className="font-medium">Orchestrator</span>
          </DetailRow>
        )}
        {entry.execution_backend ? (
          <DetailRow label="Execution backend">
            <span className="font-medium">
              {describeGenericExecutionBackendSurface(entry.execution_backend)}
            </span>
          </DetailRow>
        ) : null}
        {entry.tool_owner ? (
          <DetailRow label="Tool owner">
            <span className="font-medium">{describeGenericToolOwnerSurface(entry.tool_owner)}</span>
          </DetailRow>
        ) : null}
        {role && (
          <DetailRow label="Role">
            <span className="font-medium">{role as string}</span>
          </DetailRow>
        )}
        <DetailRow label="Actor">
          <span className="text-muted-foreground">{describeActorSurface(entry)}</span>
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
      </div>
    </div>
  );
}

function DiagnosticHandlesSection({ entry }: { entry: LogEntry }): JSX.Element {
  return (
    <div className={DETAIL_SECTION_CLASS_NAME}>
      <h4 className="mb-1 text-sm font-semibold">Diagnostic handles</h4>
      <p className="mb-3 text-xs text-muted-foreground">
        Use these only when correlating entries across traces, exports, or support investigations.
      </p>
      <div className="grid max-w-lg grid-cols-[auto_1fr] gap-x-6 gap-y-0 text-sm">
        <DetailRow label="Trace handle">
          <span className="font-mono text-xs">{entry.trace_id}</span>
        </DetailRow>
        <DetailRow label="Span handle">
          <span className="font-mono text-xs">{entry.span_id}</span>
        </DetailRow>
        {entry.parent_span_id ? (
          <DetailRow label="Parent span handle">
            <span className="font-mono text-xs">{entry.parent_span_id}</span>
          </DetailRow>
        ) : null}
      </div>
    </div>
  );
}

function ErrorSection({ error }: { error: NonNullable<LogEntry['error']> }): JSX.Element {
  return (
    <div className="rounded-lg border border-rose-300 bg-rose-100 p-4 shadow-sm dark:border-rose-400/80 dark:bg-rose-500/22">
      <h4 className="mb-2 text-sm font-semibold text-rose-800 dark:text-rose-50">Error</h4>
      {error.code && (
        <div className="mb-1 font-mono text-xs text-rose-700 dark:text-rose-100">{error.code}</div>
      )}
      <div className="text-sm text-rose-900 dark:text-rose-50">{error.message}</div>
    </div>
  );
}

function EscalationNoteSection({ error }: { error: NonNullable<LogEntry['error']> }): JSX.Element {
  return (
    <div className={DETAIL_SECTION_CLASS_NAME}>
      <h4 className="mb-2 text-sm font-semibold">Escalation note</h4>
      {error.code ? (
        <div className="mb-1 font-mono text-xs text-muted-foreground">{error.code}</div>
      ) : null}
      <div className="text-sm text-foreground">{error.message}</div>
    </div>
  );
}

function PayloadSection({ payload }: { payload: Record<string, unknown> }): JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className={DETAIL_SECTION_CLASS_NAME}>
      <button
        type="button"
        className="flex w-full items-center gap-1 text-sm font-semibold"
        onClick={() => setIsExpanded((prev) => !prev)}
      >
        {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        Recorded payload
      </button>
      {isExpanded && (
        <pre className="mt-2 max-h-80 overflow-auto rounded-lg border border-border/80 bg-background/85 p-3 text-xs shadow-sm">
          {JSON.stringify(payload, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function LogEntryDetail({ entry, onFilterTrace }: LogEntryDetailProps): JSX.Element {
  const [isCopied, setIsCopied] = useState(false);
  const isEscalation = isEscalationEntry(entry);

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
    <div className={cn('space-y-4 bg-background/40 px-4 pb-4 pt-1 dark:bg-background/10')}>
      <TraceContextSection entry={entry} />
      <DiagnosticHandlesSection entry={entry} />

      <CategoryDetail entry={entry} />

      {entry.error && !isEscalation ? <ErrorSection error={entry.error} /> : null}
      {entry.error && isEscalation ? <EscalationNoteSection error={entry.error} /> : null}

      {entry.payload && <PayloadSection payload={entry.payload} />}

      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={handleCopyJson}>
          <Copy className="mr-1 h-3 w-3" />
          {isCopied ? 'Copied' : 'Copy entry JSON'}
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
