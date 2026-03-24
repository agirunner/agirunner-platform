import { ChevronRight, ChevronDown } from 'lucide-react';
import type { LogEntry } from '../../lib/api.js';
import { cn } from '../../lib/utils.js';
import { Badge } from '../ui/badge.js';
import { describeExecutionHeadline } from '../execution-inspector/execution-inspector-support.js';
import { getCanonicalStageName } from './log-entry-context.js';
import { formatLogRelativeTime } from './log-time.js';

export interface LogEntryRowProps {
  entry: LogEntry;
  isExpanded: boolean;
  onToggle: () => void;
}

const LEVEL_ACCENT: Record<string, string> = {
  debug: 'border-l-transparent',
  info: 'border-l-blue-400',
  warn: 'border-l-yellow-500',
  error: 'border-l-red-500',
};

const LEVEL_BADGE_VARIANT: Record<string, 'info' | 'warning' | 'destructive'> = {
  debug: 'info',
  info: 'info',
  warn: 'warning',
  error: 'destructive',
};

const CATEGORY_LABELS: Record<string, string> = {
  llm: 'LLM',
  tool: 'Tool',
  agent_loop: 'Agent Loop',
  task_lifecycle: 'Step',
  runtime_lifecycle: 'Runtime',
  container: 'Container',
  api: 'API',
  config: 'Config',
  auth: 'Auth',
};

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const mon = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${mon}/${day} ${hh}:${mm}:${ss}`;
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '';
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function str(v: unknown): string {
  return v == null ? '' : String(v);
}

function num(v: unknown): string {
  return v == null ? '?' : String(v);
}

function truncate(t: string, max: number): string {
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

function shortLabel(value: string | null | undefined, fallback = 'Unknown'): string {
  if (value && value.trim() !== '') {
    return value.length > 24 ? value.slice(0, 24) : value;
  }
  return fallback;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RUNTIME_PREFIX = 'agirunner-runtime-';
const DOCKER_HASH_RE = /^[0-9a-f]{12,}$/i;
const KEY_PREFIX_RE = /^(?:Key|Worker|Agent|User)\s+ar_/;

function formatActorLabel(entry: LogEntry): string {
  if (entry.actor_name) {
    if (KEY_PREFIX_RE.test(entry.actor_name)) {
      return entry.actor_name.split(' ')[0];
    }
    if (entry.actor_name.startsWith(RUNTIME_PREFIX)) {
      return 'Runtime Worker';
    }
    if (DOCKER_HASH_RE.test(entry.actor_name)) {
      return 'Runtime Worker';
    }
    if (!UUID_RE.test(entry.actor_name)) {
      return entry.actor_name;
    }
  }
  const type = entry.actor_type ?? 'unknown';
  return type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, ' ');
}

function formatToolArgs(p: Record<string, unknown>): string {
  const input = p.input;
  if (input == null || typeof input !== 'object') return '';
  const inp = input as Record<string, unknown>;

  switch (p.tool_name) {
    case 'shell_exec':
      return inp.command ? `"${truncate(String(inp.command), 40)}"` : '';
    case 'file_read':
    case 'file_list':
      return inp.path ? `"${truncate(String(inp.path), 50)}"` : '';
    case 'file_write': {
      const path = inp.path ? `"${truncate(String(inp.path), 40)}"` : '';
      const size = typeof inp.content === 'string' ? `, ${inp.content.length}b` : '';
      return `${path}${size}`;
    }
    case 'file_copy':
      return [inp.src, inp.dst]
        .filter(Boolean)
        .map((v) => `"${truncate(String(v), 30)}"`)
        .join(' → ');
    default: {
      const keys = Object.keys(inp);
      if (keys.length === 0) return '';
      const first = inp[keys[0]];
      return typeof first === 'string'
        ? `"${truncate(first, 40)}"`
        : (JSON.stringify(first)?.slice(0, 40) ?? '');
    }
  }
}

function buildPreview(entry: LogEntry): string {
  const p = entry.payload ?? {};
  const stageName = getCanonicalStageName(entry);
  switch (entry.category) {
    case 'llm': {
      const parts = [
        str(p.model),
        str(stageName),
        p.input_tokens != null ? `${num(p.input_tokens)}→${num(p.output_tokens)}tok` : '',
        p.cost != null ? `$${num(p.cost)}` : '',
      ];
      return parts.filter(Boolean).join(' · ');
    }
    case 'tool': {
      const name = str(p.tool_name || p.command_or_path || p.command || p.path);
      const args = formatToolArgs(p);
      const call = args ? `${name}(${args})` : name;
      const failed = p.error || (p.exit_code != null && Number(p.exit_code) !== 0);
      return failed ? `${call} · exit ${num(p.exit_code)}` : call;
    }
    case 'agent_loop':
      return [
        p.iteration != null ? `iter ${num(p.iteration)}` : '',
        str(stageName),
        str(p.decision || p.summary || p.approach),
      ]
        .filter(Boolean)
        .join(' · ');
    case 'task_lifecycle':
      return [
        p.from_state && p.to_state ? `${str(p.from_state)}→${str(p.to_state)}` : str(p.task_status),
        str(p.action),
        str(p.entity_name),
        str(p.role),
        str(p.model),
        str(p.image),
        p.reuse_decision ? `${str(p.reuse_decision)} start` : '',
        str(p.workflow_name),
      ]
        .filter(Boolean)
        .join(' · ');
    case 'runtime_lifecycle': {
      const rid = str(p.runtime_id);
      return [
        str(p.action),
        rid ? rid.slice(0, 8) : '',
        str(p.image),
        str(p.playbook_name),
        str(p.reason),
      ]
        .filter(Boolean)
        .join(' · ');
    }
    case 'container':
      return [
        str(p.action),
        str(p.image),
        str(p.playbook_name),
        str(p.reason),
        p.cpu ? `${str(p.cpu)} cpu` : '',
        p.memory ? str(p.memory) : '',
        p.desired != null ? `${num(p.desired)}/${num(p.actual)}` : '',
      ]
        .filter(Boolean)
        .join(' · ');
    case 'api':
      return [str(p.method), str(p.path), p.status_code != null ? String(p.status_code) : '']
        .filter(Boolean)
        .join(' ');
    case 'config':
      return [str(p.action), p.entity_name ? `"${str(p.entity_name)}"` : '']
        .filter(Boolean)
        .join(' ');
    case 'auth':
      return [str(p.auth_type), p.email ? str(p.email) : ''].filter(Boolean).join(' · ');
    default:
      return '';
  }
}

function appendTaskTitle(preview: string, entry: LogEntry): string {
  if (!entry.task_title) return preview;
  const titleSnippet = truncate(entry.task_title, 40);
  return preview ? `${preview} · ${titleSnippet}` : titleSnippet;
}

function getRole(entry: LogEntry): string | null {
  const role = entry.role ?? (entry.payload?.role as string | undefined);
  return role && role !== '' ? role : null;
}

function describeExecutionBackend(value: LogEntry['execution_backend']): string | null {
  if (value === 'runtime_only') {
    return 'Runtime-only';
  }
  if (value === 'runtime_plus_task') {
    return 'Runtime + task sandbox';
  }
  return null;
}

function describeToolOwner(value: LogEntry['tool_owner']): string | null {
  if (value === 'runtime') {
    return 'Runtime tool';
  }
  if (value === 'task') {
    return 'Task sandbox tool';
  }
  return null;
}

export function LogTableHeader(): JSX.Element {
  return (
    <thead>
      <tr className="border-b border-border bg-muted/35 text-[11px] uppercase tracking-wider text-foreground/70">
        <th className="w-6 px-1 py-1.5" />
        <th className="px-3 py-2 text-left font-medium">Time</th>
        <th className="px-3 py-2 text-left font-medium">Level</th>
        <th className="px-3 py-2 text-left font-medium">Category</th>
        <th className="px-3 py-2 text-left font-medium">Workflow / Step</th>
        <th className="px-3 py-2 text-left font-medium">Actor</th>
        <th className="px-3 py-2 text-left font-medium">Activity</th>
        <th className="px-3 py-2 text-right font-medium w-20">Duration</th>
      </tr>
    </thead>
  );
}

export function LogEntryRow({ entry, isExpanded, onToggle }: LogEntryRowProps): JSX.Element {
  const preview = appendTaskTitle(buildPreview(entry), entry);
  const accent = LEVEL_ACCENT[entry.level] ?? LEVEL_ACCENT.info;
  const Chevron = isExpanded ? ChevronDown : ChevronRight;
  const duration = formatDuration(entry.duration_ms);
  const role = getRole(entry);
  const workflowStep = buildWorkflowStepSummary(entry);
  const actorDetail = buildActorDetail(entry, role);
  const activityHeadline = describeExecutionHeadline(entry);

  return (
    <tr
      className={cn(
        'border-b border-border/40 border-l-2 cursor-pointer align-top text-[13px] transition-colors hover:bg-muted/40',
        accent,
      )}
      onClick={onToggle}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      {/* Expand chevron */}
      <td className="px-2 py-2 align-top">
        <Chevron className="h-3 w-3 text-muted-foreground" />
      </td>

      {/* Time */}
      <td className="px-3 py-2.5 align-top">
        <div
          className="text-sm font-medium text-foreground"
          title={formatTimestamp(entry.created_at)}
        >
          {formatLogRelativeTime(entry.created_at)}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">{formatTimestamp(entry.created_at)}</div>
      </td>

      {/* Level */}
      <td className="px-3 py-2.5 align-top">
        <Badge
          variant={LEVEL_BADGE_VARIANT[entry.level] ?? 'info'}
          className="px-1.5 py-0.5 font-mono text-[11px] uppercase leading-tight"
        >
          {entry.level}
        </Badge>
      </td>

      {/* Category */}
      <td className="px-3 py-2.5 align-top">
        <span className="inline-block whitespace-nowrap text-sm font-medium text-foreground">
          {CATEGORY_LABELS[entry.category] ?? entry.category}
        </span>
      </td>

      {/* Workflow / Step */}
      <td className="px-3 py-2.5 align-top">
        <div className="min-w-[14rem]">
          <div className="break-words text-sm font-medium text-foreground">{workflowStep.workflow}</div>
          <div className="mt-1 break-words text-xs text-muted-foreground">{workflowStep.step}</div>
        </div>
      </td>

      {/* Actor */}
      <td className="px-3 py-2.5 align-top">
        <div className="min-w-[11rem]">
          <div className="break-words text-sm font-medium text-foreground">{formatActorLabel(entry)}</div>
          <div className="mt-1 break-words text-xs text-muted-foreground">{actorDetail}</div>
        </div>
      </td>

      {/* Activity */}
      <td className="px-3 py-2.5 align-top">
        <div className="grid min-w-[20rem] gap-1">
          <div className="break-words text-sm font-medium text-foreground">
            {activityHeadline}
          </div>
          <div className="break-words text-xs text-muted-foreground">
            {preview ? truncate(preview, 140) : entry.operation}
          </div>
          {entry.error?.message ? (
            <div className="rounded-md border border-rose-300 bg-rose-100 px-2 py-1 text-xs leading-5 text-rose-900 dark:border-rose-500/70 dark:bg-rose-500/12 dark:text-rose-100">
              {truncate(entry.error.message, 160)}
            </div>
          ) : null}
        </div>
      </td>

      {/* Duration */}
      <td className="px-3 py-2.5 align-top text-right font-mono tabular-nums text-muted-foreground whitespace-nowrap">
        {duration}
      </td>
    </tr>
  );
}

function buildWorkflowStepSummary(entry: LogEntry): { workflow: string; step: string } {
  const stageName = getCanonicalStageName(entry);
  const workflow =
    entry.workflow_name ??
    (entry.workflow_id ? `Workflow ${shortLabel(entry.workflow_id)}` : 'No workflow');
  const stepParts = [
    entry.task_title ? truncate(entry.task_title, 56) : '',
    stageName ? `Stage ${stageName}` : '',
  ].filter(Boolean);

  return {
    workflow,
    step: stepParts.join(' · ') || 'No step context',
  };
}

function buildActorDetail(entry: LogEntry, role: string | null): string {
  const parts = [
    role,
    describeExecutionBackend(entry.execution_backend),
    describeToolOwner(entry.tool_owner),
  ].filter(Boolean);

  if (parts.length > 0) {
    return parts.join(' · ');
  }

  const sourceLabel = entry.source.replace(/_/g, ' ');
  return sourceLabel.charAt(0).toUpperCase() + sourceLabel.slice(1);
}
