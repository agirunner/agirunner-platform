import { useEffect, useRef, useState } from 'react';
import type { AgentTurnData } from './agent-timeline-entry.js';
import { AgentTimelineEntry } from './agent-timeline-entry.js';
import { ScrollPauseToggle } from './scroll-pause-toggle.js';

const ALL_ROLES_VALUE = '__all__';

export interface AgentTimelineProps {
  entries: AgentTurnData[];
  roleFilter: string | null;
  onRoleFilterChange: (role: string | null) => void;
  isAutoScrolling: boolean;
  onToggleAutoScroll: () => void;
}

function buildRoleOptions(entries: AgentTurnData[]): string[] {
  const seen = new Set<string>();
  for (const entry of entries) {
    seen.add(entry.role);
  }
  return Array.from(seen).sort();
}

export function AgentTimeline({
  entries,
  roleFilter,
  onRoleFilterChange,
  isAutoScrolling,
  onToggleAutoScroll,
}: AgentTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const roleOptions = buildRoleOptions(entries);
  const visibleEntries = roleFilter === null
    ? entries
    : entries.filter((e) => e.role === roleFilter);

  useEffect(() => {
    if (isAutoScrolling && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries, isAutoScrolling]);

  const handleToggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

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
        <select
          value={roleFilter ?? ALL_ROLES_VALUE}
          onChange={(e) => {
            const val = e.target.value;
            onRoleFilterChange(val === ALL_ROLES_VALUE ? null : val);
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
          <option value={ALL_ROLES_VALUE}>All roles</option>
          {roleOptions.map((role) => (
            <option key={role} value={role}>{role}</option>
          ))}
        </select>
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
        }}
      >
        {visibleEntries.map((entry) => (
          <AgentTimelineEntry
            key={entry.id}
            entry={entry}
            isExpanded={expandedIds.has(entry.id)}
            onToggleExpand={() => handleToggleExpand(entry.id)}
          />
        ))}
      </div>
    </div>
  );
}
