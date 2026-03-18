import { ChevronRight, ChevronDown } from 'lucide-react';
import type { LogEntry } from '../../lib/api.js';
import { cn } from '../../lib/utils.js';
import { getCanonicalStageName } from './log-entry-context.js';
import { formatLogRelativeTime } from './log-time.js';

export interface LogEntryRowProps {
  entry: LogEntry;
  isExpanded: boolean;
  onToggle: () => void;
}

const CATEGORY_STYLES: Record<string, string> = {
  llm: 'bg-indigo-100 text-indigo-700',
  tool: 'bg-emerald-100 text-emerald-700',
  agent_loop: 'bg-violet-100 text-violet-700',
  task_lifecycle: 'bg-sky-100 text-sky-700',
  runtime_lifecycle: 'bg-sky-100 text-sky-700',
  container: 'bg-orange-100 text-orange-700',
  api: 'bg-slate-100 text-slate-700',
  config: 'bg-teal-100 text-teal-700',
  auth: 'bg-yellow-100 text-yellow-700',
};

const LEVEL_ACCENT: Record<string, string> = {
  debug: 'border-l-transparent',
  info: 'border-l-blue-400',
  warn: 'border-l-yellow-500',
  error: 'border-l-red-500',
};

const LEVEL_BADGE: Record<string, string> = {
  debug: 'bg-gray-100 text-gray-500',
  info: 'bg-blue-50 text-blue-600',
  warn: 'bg-amber-50 text-amber-700 font-semibold',
  error: 'bg-red-50 text-red-700 font-semibold',
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

const STATUS_INDICATOR: Record<string, string> = {
  completed: '●',
  failed: '✕',
  started: '◐',
  skipped: '○',
};

const STATUS_COLOR: Record<string, string> = {
  completed: 'text-green-500',
  failed: 'text-red-500',
  started: 'text-blue-500 animate-pulse',
  skipped: 'text-gray-400',
};

function getRole(entry: LogEntry): string | null {
  const role = entry.role ?? (entry.payload?.role as string | undefined);
  return role && role !== '' ? role : null;
}

export function LogTableHeader(): JSX.Element {
  return (
    <thead>
      <tr className="border-b border-border bg-muted/30 text-[11px] uppercase tracking-wider text-muted-foreground">
        <th className="w-6 px-1 py-1.5" />
        <th className="px-3 py-2 text-left font-medium">Signal</th>
        <th className="px-3 py-2 text-left font-medium">Recorded</th>
        <th className="px-3 py-2 text-left font-medium hidden lg:table-cell">Scope</th>
        <th className="px-3 py-2 text-left font-medium">Activity</th>
        <th className="px-3 py-2 text-right font-medium w-20">Duration</th>
      </tr>
    </thead>
  );
}

export function LogEntryRow({ entry, isExpanded, onToggle }: LogEntryRowProps): JSX.Element {
  const preview = appendTaskTitle(buildPreview(entry), entry);
  const accent = LEVEL_ACCENT[entry.level] ?? LEVEL_ACCENT.info;
  const levelBadge = LEVEL_BADGE[entry.level] ?? LEVEL_BADGE.info;
  const catStyle = CATEGORY_STYLES[entry.category] ?? 'bg-slate-100 text-slate-700';
  const Chevron = isExpanded ? ChevronDown : ChevronRight;
  const duration = formatDuration(entry.duration_ms);
  const role = getRole(entry);
  const scopeItems = buildScopeItems(entry, role);

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

      {/* Signal */}
      <td className="px-3 py-2.5 align-top">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={cn(
              'text-[11px] leading-none',
              STATUS_COLOR[entry.status] ?? 'text-muted-foreground',
            )}
          >
            {STATUS_INDICATOR[entry.status] ?? '○'}
          </span>
          <span
            className={cn(
              'inline-block rounded px-1.5 py-0.5 text-[11px] font-mono uppercase leading-tight',
              levelBadge,
            )}
          >
            {entry.level}
          </span>
          <span
            className={cn(
              'inline-block rounded px-1.5 py-0.5 text-[11px] font-medium leading-tight whitespace-nowrap',
              catStyle,
            )}
          >
            {CATEGORY_LABELS[entry.category] ?? entry.category}
          </span>
          <span className="inline-block rounded border border-border/70 bg-background px-1.5 py-0.5 text-[11px] font-medium leading-tight text-muted-foreground">
            {entry.status}
          </span>
        </div>
        <div className="mt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {formatActorLabel(entry)}
        </div>
        <div className="mt-1 break-words text-sm font-medium text-foreground">{entry.operation}</div>
      </td>

      {/* Recorded */}
      <td
        className="px-3 py-2.5 align-top text-muted-foreground tabular-nums whitespace-nowrap"
        title={formatTimestamp(entry.created_at)}
      >
        <div className="text-sm font-medium text-foreground">
          {formatLogRelativeTime(entry.created_at)}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">{formatTimestamp(entry.created_at)}</div>
      </td>

      {/* Scope */}
      <td className="hidden lg:table-cell px-3 py-2.5 align-top">
        {scopeItems.length > 0 ? (
          <div className="flex max-w-[16rem] flex-wrap gap-1.5">
            {scopeItems.map((item) => (
              <span
                key={item.value}
                className={cn(
                  'inline-block rounded px-1.5 py-0.5 text-[11px] font-medium leading-tight whitespace-nowrap',
                  item.tone,
                )}
                title={item.title}
              >
                {item.value}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground/70">No scoped entity</span>
        )}
      </td>

      {/* Activity */}
      <td className="px-3 py-2.5 align-top">
        <div className="grid gap-1">
          <div className="break-words text-sm font-medium text-foreground">
            {preview ? truncate(preview, 120) : 'Recorded activity with no derived summary'}
          </div>
          {entry.error?.message ? (
            <div className="rounded-md border border-red-300/60 bg-red-50/70 px-2 py-1 text-xs leading-5 text-red-700 dark:border-red-700/60 dark:bg-red-950/25 dark:text-red-200">
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

function buildScopeItems(
  entry: LogEntry,
  role: string | null,
): Array<{ value: string; title: string; tone: string }> {
  const scopeItems: Array<{ value: string; title: string; tone: string }> = [];
  const stageName = getCanonicalStageName(entry);

  if (entry.workspace_name || entry.workspace_id) {
    scopeItems.push({
      value: entry.workspace_name ?? entry.workspace_id!.slice(0, 8),
      title: entry.workspace_name ?? entry.workspace_id ?? '',
      tone: 'bg-cyan-50 text-cyan-700',
    });
  }
  if (entry.workflow_name || entry.workflow_id) {
    scopeItems.push({
      value: entry.workflow_name ?? entry.workflow_id!.slice(0, 8),
      title: entry.workflow_name ?? entry.workflow_id ?? '',
      tone: 'bg-purple-50 text-purple-700',
    });
  }
  if (stageName) {
    scopeItems.push({
      value: stageName,
      title: stageName,
      tone: 'bg-amber-50 text-amber-700',
    });
  }
  if (role) {
    scopeItems.push({
      value: truncate(role, 16),
      title: role,
      tone: 'bg-rose-50 text-rose-600',
    });
  }

  return scopeItems;
}
