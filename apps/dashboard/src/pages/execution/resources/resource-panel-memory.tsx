import { useState } from 'react';

export interface MemoryEntry {
  key: string;
  value: unknown;
  updatedBy?: string;
  updatedAt?: string;
}

export interface ResourcePanelMemoryProps {
  entries?: MemoryEntry[];
}

export function filterMemoryEntries(entries: Array<{ key: string }>, query: string): Array<{ key: string }> {
  if (query === '') return entries;
  const lower = query.toLowerCase();
  return entries.filter((entry) => entry.key.toLowerCase().includes(lower));
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function MemoryEntryRow({ entry }: { entry: MemoryEntry }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const raw = formatValue(entry.value);
  const isTruncated = raw.length > 80;

  return (
    <div style={{
      borderBottom: '1px solid var(--color-border-subtle)',
      padding: '8px 0',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: '8px',
      }}>
        <span style={{
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: '11px',
          fontWeight: 600,
          color: 'var(--color-text-primary)',
          flexShrink: 0,
        }}>
          {entry.key}
        </span>
        {isTruncated && (
          <button
            type="button"
            onClick={() => setIsExpanded((prev) => !prev)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: '10px',
              color: 'var(--color-accent-primary)',
              padding: 0,
              flexShrink: 0,
            }}
          >
            {isExpanded ? 'collapse' : 'expand'}
          </button>
        )}
      </div>

      <div style={{
        fontFamily: 'var(--font-mono, monospace)',
        fontSize: '11px',
        color: 'var(--color-text-secondary)',
        marginTop: '3px',
        overflowWrap: 'break-word',
        wordBreak: 'break-all',
      }}>
        {isExpanded || !isTruncated ? raw : `${raw.slice(0, 80)}…`}
      </div>

      {(entry.updatedBy ?? entry.updatedAt) && (
        <div style={{
          marginTop: '4px',
          fontSize: '10px',
          color: 'var(--color-text-tertiary)',
          display: 'flex',
          gap: '8px',
        }}>
          {entry.updatedBy && <span>by {entry.updatedBy}</span>}
          {entry.updatedAt && <span>{entry.updatedAt}</span>}
        </div>
      )}
    </div>
  );
}

export function ResourcePanelMemory({ entries = [] }: ResourcePanelMemoryProps) {
  const [query, setQuery] = useState('');

  const visible = filterMemoryEntries(entries, query) as MemoryEntry[];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <input
        type="search"
        placeholder="Filter by key…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{
          width: '100%',
          padding: '5px 8px',
          borderRadius: '4px',
          border: '1px solid var(--color-border-subtle)',
          backgroundColor: 'var(--color-bg-secondary)',
          color: 'var(--color-text-primary)',
          fontSize: '12px',
          boxSizing: 'border-box',
          outline: 'none',
        }}
      />

      {visible.length === 0 ? (
        <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)', padding: '8px 0' }}>
          {entries.length === 0 ? 'No memory entries.' : 'No matching entries.'}
        </div>
      ) : (
        <div>
          {visible.map((entry) => (
            <MemoryEntryRow key={entry.key} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}
