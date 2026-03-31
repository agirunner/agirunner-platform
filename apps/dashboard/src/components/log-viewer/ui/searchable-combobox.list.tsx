import type { VirtualItem, Virtualizer } from '@tanstack/react-virtual';
import { Check } from 'lucide-react';

import { cn } from '../../../lib/utils.js';
import {
  isItemRow,
  STATUS_COLORS,
  type ComboboxItem,
  type FlatRow,
} from './searchable-combobox.support.js';

export function SearchableComboboxList(props: {
  flatRows: FlatRow[];
  highlightIndex: number;
  isLoading: boolean;
  multiSelect: boolean;
  selectedIds?: Set<string>;
  selectableItems: ComboboxItem[];
  shouldVirtualize: boolean;
  value: string | null;
  virtualRows: VirtualItem[];
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  onSelect(id: string): void;
  onHighlightChange(index: number): void;
}): JSX.Element {
  if (props.isLoading) {
    return <div className="py-4 text-center text-sm text-muted">Loading...</div>;
  }

  if (props.selectableItems.length === 0) {
    return <div className="py-4 text-center text-sm text-muted">No results found</div>;
  }

  if (props.shouldVirtualize && props.virtualRows.length > 0) {
    return (
      <div style={{ height: props.virtualizer.getTotalSize(), position: 'relative' }}>
        {props.virtualRows.map((virtualRow) => (
          <SearchableComboboxVirtualRow
            key={virtualRow.key}
            flatRows={props.flatRows}
            highlightIndex={props.highlightIndex}
            multiSelect={props.multiSelect}
            selectedIds={props.selectedIds}
            value={props.value}
            virtualRow={virtualRow}
            onSelect={props.onSelect}
            onHighlightChange={props.onHighlightChange}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="py-1">
      {props.flatRows.map((row) => (
        <SearchableComboboxStaticRow
          key={row.type === 'header' ? `header-${row.label}` : row.item.id}
          highlightIndex={props.highlightIndex}
          multiSelect={props.multiSelect}
          row={row}
          selectedIds={props.selectedIds}
          value={props.value}
          onSelect={props.onSelect}
          onHighlightChange={props.onHighlightChange}
        />
      ))}
    </div>
  );
}

function SearchableComboboxVirtualRow(props: {
  flatRows: FlatRow[];
  highlightIndex: number;
  multiSelect: boolean;
  selectedIds?: Set<string>;
  value: string | null;
  virtualRow: VirtualItem;
  onSelect(id: string): void;
  onHighlightChange(index: number): void;
}): JSX.Element {
  const row = props.flatRows[props.virtualRow.index];
  if (!row || !isItemRow(row)) {
    return (
      <div
        className="px-3 py-1 text-xs font-semibold text-muted"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: props.virtualRow.size,
          transform: `translateY(${props.virtualRow.start}px)`,
        }}
      >
        {row?.type === 'header' ? row.label : ''}
      </div>
    );
  }

  return (
    <SearchableComboboxOptionRow
      item={row.item}
      isSelected={
        props.multiSelect
          ? (props.selectedIds?.has(row.item.id) ?? false)
          : row.item.id === props.value
      }
      isHighlighted={row.flatIndex === props.highlightIndex}
      multiSelect={props.multiSelect}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: props.virtualRow.size,
        transform: `translateY(${props.virtualRow.start}px)`,
      }}
      onSelect={() => props.onSelect(row.item.id)}
      onHighlight={() => props.onHighlightChange(row.flatIndex)}
    />
  );
}

function SearchableComboboxStaticRow(props: {
  highlightIndex: number;
  multiSelect: boolean;
  row: FlatRow;
  selectedIds?: Set<string>;
  value: string | null;
  onSelect(id: string): void;
  onHighlightChange(index: number): void;
}): JSX.Element {
  const row = props.row;
  if (!isItemRow(row)) {
    return <div className="px-3 py-1 text-xs font-semibold text-muted">{row.label}</div>;
  }

  return (
    <SearchableComboboxOptionRow
      item={row.item}
      isSelected={
        props.multiSelect
          ? (props.selectedIds?.has(row.item.id) ?? false)
          : row.item.id === props.value
      }
      isHighlighted={row.flatIndex === props.highlightIndex}
      multiSelect={props.multiSelect}
      onSelect={() => props.onSelect(row.item.id)}
      onHighlight={() => props.onHighlightChange(row.flatIndex)}
    />
  );
}

function SearchableComboboxOptionRow(props: {
  item: ComboboxItem;
  isSelected: boolean;
  isHighlighted: boolean;
  multiSelect: boolean;
  style?: React.CSSProperties;
  onSelect(): void;
  onHighlight(): void;
}): JSX.Element {
  return (
    <button
      type="button"
      role="option"
      aria-selected={props.isSelected}
      className={cn(
        'flex w-full cursor-default select-none flex-col rounded-sm px-2 py-1.5 text-left text-sm outline-none',
        props.isHighlighted && 'bg-accent/10',
        props.isSelected && 'font-medium',
      )}
      style={props.style}
      onClick={props.onSelect}
      onMouseEnter={props.onHighlight}
    >
      <div className="flex items-center gap-2">
        {props.multiSelect ? (
          <span
            className={cn(
              'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-border',
              props.isSelected && 'border-accent bg-accent text-accent-foreground',
            )}
          >
            {props.isSelected ? <Check className="h-3 w-3" /> : null}
          </span>
        ) : null}
        {props.item.status ? (
          <span
            className={cn(
              'inline-block h-2 w-2 shrink-0 rounded-full',
              STATUS_COLORS[props.item.status] ?? 'bg-border',
            )}
          />
        ) : null}
        <span className="truncate text-foreground">{props.item.label}</span>
      </div>
      {props.item.subtitle ? (
        <span className={cn('truncate text-xs text-muted', props.multiSelect ? 'pl-6' : 'pl-4')}>
          {props.item.subtitle}
        </span>
      ) : null}
    </button>
  );
}
