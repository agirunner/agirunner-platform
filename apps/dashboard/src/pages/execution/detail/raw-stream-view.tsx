import { useEffect, useRef, useState } from 'react';
import type { TaskStreamEvent } from '../../../lib/use-task-stream.js';
import { useTaskStream } from '../../../lib/use-task-stream.js';
import { ScrollPauseToggle } from './scroll-pause-toggle';

export interface RawStreamViewProps {
  taskId: string | null;
  agentFilter: string | null;
  onAgentFilterChange: (agentId: string | null) => void;
  isAutoScrolling: boolean;
  onToggleAutoScroll: () => void;
}

const EVENT_COLORS: Record<string, string> = {
  thinking: 'var(--color-accent-primary)',
  tool_call: 'var(--color-status-warning)',
  tool_result: 'var(--color-status-success)',
  token: 'var(--color-text-primary)',
};

const TOOL_RESULT_LINE_LIMIT = 50;
const THINKING_LINE_LIMIT = 20;
const ALL_AGENTS_VALUE = '__all__';

export function getEventColor(eventType: string): string {
  return EVENT_COLORS[eventType] ?? 'var(--color-text-muted)';
}

export function countLines(text: string): number {
  if (text === '') return 0;
  return text.split('\n').length;
}

export function shouldCollapse(text: string, type: string): boolean {
  if (type === 'tool_result') {
    return countLines(text) > TOOL_RESULT_LINE_LIMIT;
  }
  if (type === 'thinking') {
    return countLines(text) > THINKING_LINE_LIMIT;
  }
  return false;
}

function extractText(event: TaskStreamEvent): string {
  const data = event.data;
  if (typeof data['text'] === 'string') return data['text'];
  if (typeof data['content'] === 'string') return data['content'];
  return JSON.stringify(data);
}

function buildAgentOptions(events: TaskStreamEvent[]): string[] {
  const seen = new Set<string>();
  for (const event of events) {
    if (event.agentId !== undefined) {
      seen.add(event.agentId);
    }
  }
  return Array.from(seen).sort();
}

interface TurnHeaderProps {
  role: string;
  turn: number;
}

function TurnHeader({ role, turn }: TurnHeaderProps) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '6px 0',
      borderBottom: '1px solid var(--color-border-subtle)',
      marginBottom: '4px',
    }}>
      <span style={{
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        backgroundColor: `var(--role-${role}, var(--color-text-muted))`,
        flexShrink: 0,
      }} />
      <span style={{
        fontSize: '10px',
        fontWeight: 600,
        color: `var(--role-${role}, var(--color-text-muted))`,
        textTransform: 'uppercase',
        letterSpacing: '0.4px',
      }}>
        {role}
      </span>
      <span style={{ fontSize: '10px', color: 'var(--color-text-tertiary)' }}>
        turn {turn}
      </span>
    </div>
  );
}

interface EventRowProps {
  event: TaskStreamEvent;
}

function EventRow({ event }: EventRowProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (event.type === 'turn_end') {
    return (
      <div style={{
        height: '1px',
        backgroundColor: 'var(--color-border-subtle)',
        margin: '8px 0',
        opacity: 0.5,
      }} />
    );
  }

  if (event.type === 'task_end') {
    return (
      <div style={{
        padding: '6px 10px',
        fontSize: '11px',
        fontWeight: 500,
        color: 'var(--color-status-success)',
        fontStyle: 'italic',
      }}>
        Task completed
      </div>
    );
  }

  const text = extractText(event);
  const color = getEventColor(event.type);
  const collapsible = shouldCollapse(text, event.type);
  const displayText = collapsible && !isExpanded
    ? text.split('\n').slice(0, 5).join('\n') + '\n…'
    : text;

  return (
    <div style={{
      borderLeft: `2px solid ${color}`,
      paddingLeft: '8px',
      marginBottom: '4px',
    }}>
      <pre style={{
        margin: 0,
        fontSize: '11px',
        color,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        fontFamily: 'monospace',
        lineHeight: 1.5,
      }}>
        {displayText}
      </pre>
      {collapsible && (
        <button
          onClick={() => setIsExpanded((prev) => !prev)}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: '10px',
            color: 'var(--color-text-tertiary)',
            padding: '2px 0',
            fontFamily: 'inherit',
          }}
        >
          {isExpanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

interface TurnGroup {
  role: string;
  turn: number;
  key: string;
  events: TaskStreamEvent[];
}

function groupByTurn(events: TaskStreamEvent[]): TurnGroup[] {
  const groups: TurnGroup[] = [];
  for (const event of events) {
    const role = event.role ?? 'unknown';
    const turn = event.turn ?? 0;
    const last = groups[groups.length - 1];
    if (last !== undefined && last.role === role && last.turn === turn) {
      last.events.push(event);
    } else {
      groups.push({ role, turn, key: `${role}-${turn}-${groups.length}`, events: [event] });
    }
  }
  return groups;
}

function AgentFilterDropdown({
  agentIds,
  agentFilter,
  onAgentFilterChange,
}: {
  agentIds: string[];
  agentFilter: string | null;
  onAgentFilterChange: (agentId: string | null) => void;
}) {
  return (
    <select
      value={agentFilter ?? ALL_AGENTS_VALUE}
      onChange={(e) => {
        const val = e.target.value;
        onAgentFilterChange(val === ALL_AGENTS_VALUE ? null : val);
      }}
      style={{
        fontSize: '11px',
        padding: '3px 6px',
        borderRadius: '4px',
        border: '1px solid var(--color-border-subtle)',
        backgroundColor: 'var(--color-bg-secondary)',
        color: 'var(--color-text-secondary)',
        cursor: 'pointer',
      }}
    >
      <option value={ALL_AGENTS_VALUE}>All agents</option>
      {agentIds.map((id) => (
        <option key={id} value={id}>{id}</option>
      ))}
    </select>
  );
}

export function RawStreamView({
  taskId,
  agentFilter,
  onAgentFilterChange,
  isAutoScrolling,
  onToggleAutoScroll,
}: RawStreamViewProps) {
  const { events, isConnected: _isConnected, error } = useTaskStream(taskId, {
    agentId: agentFilter ?? undefined,
  });

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isAutoScrolling && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events, isAutoScrolling]);

  if (taskId === null) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        fontSize: '13px',
        color: 'var(--color-text-tertiary)',
        fontStyle: 'italic',
      }}>
        Select a task to watch its live stream
      </div>
    );
  }

  const agentIds = buildAgentOptions(events);
  const turnGroups = groupByTurn(events);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 12px',
        borderBottom: '1px solid var(--color-border-subtle)',
        flexShrink: 0,
      }}>
        <AgentFilterDropdown
          agentIds={agentIds}
          agentFilter={agentFilter}
          onAgentFilterChange={onAgentFilterChange}
        />
        {error !== null && (
          <span style={{
            fontSize: '11px',
            color: 'var(--color-status-error)',
          }}>
            {error}
          </span>
        )}
        <div style={{ marginLeft: 'auto' }}>
          <ScrollPauseToggle isPaused={!isAutoScrolling} onToggle={onToggleAutoScroll} />
        </div>
      </div>
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px',
          backgroundColor: 'var(--color-bg-deep)',
          fontFamily: 'monospace',
        }}
      >
        {turnGroups.map((group) => (
          <div key={group.key}>
            <TurnHeader role={group.role} turn={group.turn} />
            {group.events.map((event, i) => (
              <EventRow key={i} event={event} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
