import { useEffect, useRef, useState } from 'react';
import { type PaletteAction, fuzzyMatch } from './command-palette-support.js';

export interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  actions: PaletteAction[];
}

interface ScoredAction {
  action: PaletteAction;
  score: number;
}

function filterAndScore(actions: PaletteAction[], query: string): ScoredAction[] {
  return actions
    .map(action => {
      const labelMatch = fuzzyMatch(query, action.label);
      const descMatch = action.description ? fuzzyMatch(query, action.description) : { matches: false, score: 0 };
      const score = Math.max(labelMatch.score, descMatch.score * 0.5);
      return { action, score, matches: labelMatch.matches || descMatch.matches };
    })
    .filter(r => r.matches)
    .sort((a, b) => b.score - a.score)
    .map(r => ({ action: r.action, score: r.score }));
}

function groupByWorkflow(scored: ScoredAction[]): Map<string, ScoredAction[]> {
  const groups = new Map<string, ScoredAction[]>();

  for (const item of scored) {
    const key = item.action.workflowName ?? '';
    const existing = groups.get(key) ?? [];
    existing.push(item);
    groups.set(key, existing);
  }

  return groups;
}

function ActionItem({
  item,
  isSelected,
  onSelect,
}: {
  item: ScoredAction;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isSelected) {
      ref.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [isSelected]);

  return (
    <div
      ref={ref}
      role="option"
      aria-selected={isSelected}
      onClick={onSelect}
      style={{
        padding: '8px 16px',
        cursor: 'pointer',
        backgroundColor: isSelected ? 'var(--color-accent-primary-muted)' : 'transparent',
        borderLeft: isSelected ? '2px solid var(--color-accent-primary)' : '2px solid transparent',
        transition: 'background-color 0.1s',
      }}
    >
      <div style={{ fontSize: '13px', color: 'var(--color-text-primary)', fontWeight: 500 }}>
        {item.action.label}
      </div>
      {item.action.description && (
        <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', marginTop: '2px' }}>
          {item.action.description}
        </div>
      )}
    </div>
  );
}

function GroupHeader({ title }: { title: string }) {
  if (!title) return null;
  return (
    <div style={{
      fontSize: '10px',
      fontWeight: 600,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      color: 'var(--color-text-tertiary)',
      padding: '8px 16px 4px',
      borderTop: '1px solid var(--color-border-subtle)',
    }}>
      {title}
    </div>
  );
}

export function CommandPalette({ isOpen, onClose, actions }: CommandPaletteProps): JSX.Element | null {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const scored = filterAndScore(actions, query);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(i => Math.min(i + 1, scored.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(i => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Enter') {
        const selected = scored[selectedIndex];
        if (selected) {
          selected.action.action();
          onClose();
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, scored, selectedIndex, onClose]);

  if (!isOpen) return null;

  const groups = groupByWorkflow(scored);
  const groupKeys = Array.from(groups.keys());

  let flatIndex = 0;

  return (
    <>
      <div
        data-testid="command-palette-backdrop"
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 'var(--z-overlay-backdrop)' as unknown as number,
          backgroundColor: 'rgba(0,0,0,0.5)',
        }}
      />
      <div
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        data-testid="command-palette"
        style={{
          position: 'fixed',
          top: '15%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(600px, 90vw)',
          zIndex: 'var(--z-palette)' as unknown as number,
          backgroundColor: 'var(--color-bg-deep)',
          border: '1px solid var(--color-border-focus)',
          borderRadius: '8px',
          boxShadow: 'var(--shadow-overlay)',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '60vh',
          fontFamily: 'var(--font-family)',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border-subtle)', flexShrink: 0 }}>
          <input
            ref={inputRef}
            type="text"
            role="searchbox"
            placeholder="Search actions..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{
              width: '100%',
              background: 'none',
              border: 'none',
              outline: 'none',
              fontSize: '14px',
              color: 'var(--color-text-primary)',
              fontFamily: 'inherit',
            }}
          />
        </div>

        <div
          role="listbox"
          data-testid="command-palette-results"
          style={{ overflowY: 'auto', flex: 1 }}
        >
          {scored.length === 0 && (
            <div style={{ padding: '24px 16px', textAlign: 'center', fontSize: '13px', color: 'var(--color-text-tertiary)' }}>
              No results found
            </div>
          )}
          {groupKeys.map(groupKey => {
            const items = groups.get(groupKey) ?? [];
            return (
              <div key={groupKey || '__ungrouped__'}>
                <GroupHeader title={groupKey} />
                {items.map(item => {
                  const currentIndex = flatIndex++;
                  return (
                    <ActionItem
                      key={item.action.id}
                      item={item}
                      isSelected={currentIndex === selectedIndex}
                      onSelect={() => {
                        item.action.action();
                        onClose();
                      }}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
