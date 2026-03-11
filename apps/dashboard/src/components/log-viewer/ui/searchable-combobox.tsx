import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/popover.js';
import { cn } from '../../../lib/utils.js';
import { Input } from '../../ui/input.js';

export interface ComboboxItem {
  id: string;
  label: string;
  subtitle?: string;
  status?: 'active' | 'completed' | 'failed' | 'pending';
}

export interface ComboboxGroup {
  label: string;
  items: ComboboxItem[];
}

export interface SearchableComboboxProps {
  items: ComboboxItem[];
  recentItems?: ComboboxItem[];
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  allGroupLabel?: string;
  onSearch?: (query: string) => void;
  isLoading?: boolean;
  className?: string;
  disabled?: boolean;
  multiSelect?: boolean;
  selectedIds?: Set<string>;
  onClearAll?: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-500',
  completed: 'bg-blue-500',
  failed: 'bg-red-500',
  pending: 'bg-yellow-500',
};

const ITEM_HEIGHT_PX = 48;
const GROUP_HEADER_HEIGHT_PX = 28;
const MAX_LIST_HEIGHT_PX = 384;

type FlatRow =
  | { type: 'header'; label: string }
  | { type: 'item'; item: ComboboxItem; flatIndex: number };

function buildFlatRows(
  recentItems: ComboboxItem[],
  allItems: ComboboxItem[],
  allGroupLabel: string,
): FlatRow[] {
  const rows: FlatRow[] = [];
  let flatIndex = 0;

  if (recentItems.length > 0) {
    rows.push({ type: 'header', label: 'Recent' });
    for (const item of recentItems) {
      rows.push({ type: 'item', item, flatIndex });
      flatIndex++;
    }
  }

  if (allItems.length > 0) {
    rows.push({ type: 'header', label: allGroupLabel });
    for (const item of allItems) {
      rows.push({ type: 'item', item, flatIndex });
      flatIndex++;
    }
  }

  return rows;
}

function collectSelectableItems(rows: FlatRow[]): ComboboxItem[] {
  return rows.filter((r): r is FlatRow & { type: 'item' } => r.type === 'item').map((r) => r.item);
}

export const SearchableCombobox = forwardRef<HTMLButtonElement, SearchableComboboxProps>(
  (
    {
      items,
      recentItems = [],
      value,
      onChange,
      placeholder = 'Select...',
      searchPlaceholder = 'Search...',
      allGroupLabel = 'All',
      onSearch,
      isLoading,
      className,
      disabled,
      multiSelect = false,
      selectedIds,
      onClearAll,
    },
    ref,
  ) => {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [highlightIndex, setHighlightIndex] = useState(0);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout>>();

    const filtered = useMemo(() => {
      if (!query) return items;
      const lower = query.toLowerCase();
      return items.filter(
        (item) =>
          item.label.toLowerCase().includes(lower) ||
          item.subtitle?.toLowerCase().includes(lower),
      );
    }, [items, query]);

    const filteredRecent = useMemo(() => {
      if (!query) return recentItems;
      const lower = query.toLowerCase();
      return recentItems.filter(
        (item) =>
          item.label.toLowerCase().includes(lower) ||
          item.subtitle?.toLowerCase().includes(lower),
      );
    }, [recentItems, query]);

    const recentIds = useMemo(() => new Set(filteredRecent.map((i) => i.id)), [filteredRecent]);

    const nonRecentItems = useMemo(
      () => filtered.filter((i) => !recentIds.has(i.id)),
      [filtered, recentIds],
    );

    const flatRows = useMemo(
      () => buildFlatRows(filteredRecent, nonRecentItems, allGroupLabel),
      [filteredRecent, nonRecentItems, allGroupLabel],
    );

    const selectableItems = useMemo(() => collectSelectableItems(flatRows), [flatRows]);

    const selectedItem = useMemo(
      () => (value ? items.find((i) => i.id === value) ?? recentItems.find((i) => i.id === value) : null),
      [items, recentItems, value],
    );

    const virtualizer = useVirtualizer({
      count: flatRows.length,
      getScrollElement: () => scrollContainerRef.current,
      estimateSize: (index) =>
        flatRows[index].type === 'header' ? GROUP_HEADER_HEIGHT_PX : ITEM_HEIGHT_PX,
      overscan: 5,
    });

    const handleQueryChange = useCallback(
      (newQuery: string) => {
        setQuery(newQuery);
        setHighlightIndex(0);
        if (onSearch) {
          clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(() => onSearch(newQuery), 300);
        }
      },
      [onSearch],
    );

    const handleSelect = useCallback(
      (id: string) => {
        onChange(id);
        if (!multiSelect) {
          setOpen(false);
          setQuery('');
        }
      },
      [onChange, multiSelect],
    );

    const handleClear = useCallback(() => {
      onChange(null);
      setOpen(false);
      setQuery('');
    }, [onChange]);

    const scrollToHighlight = useCallback(
      (index: number) => {
        const rowIndex = flatRows.findIndex(
          (r) => r.type === 'item' && r.flatIndex === index,
        );
        if (rowIndex >= 0) {
          virtualizer.scrollToIndex(rowIndex, { align: 'auto' });
        }
      },
      [flatRows, virtualizer],
    );

    const handleKeyDown = useCallback(
      (e: KeyboardEvent) => {
        switch (e.key) {
          case 'ArrowDown':
            e.preventDefault();
            setHighlightIndex((prev) => {
              const next = Math.min(prev + 1, selectableItems.length - 1);
              scrollToHighlight(next);
              return next;
            });
            break;
          case 'ArrowUp':
            e.preventDefault();
            setHighlightIndex((prev) => {
              const next = Math.max(prev - 1, 0);
              scrollToHighlight(next);
              return next;
            });
            break;
          case 'Enter':
            e.preventDefault();
            if (selectableItems[highlightIndex]) {
              handleSelect(selectableItems[highlightIndex].id);
            }
            break;
          case 'Escape':
            e.preventDefault();
            setOpen(false);
            break;
        }
      },
      [selectableItems, highlightIndex, handleSelect, scrollToHighlight],
    );

    useEffect(() => {
      if (open) {
        setHighlightIndex(0);
        requestAnimationFrame(() => searchInputRef.current?.focus());
      }
    }, [open]);

    useEffect(() => {
      return () => clearTimeout(debounceRef.current);
    }, []);

    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            ref={ref}
            type="button"
            disabled={disabled}
            className={cn(
              'flex h-9 w-full items-center justify-between rounded-md border border-border bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-50',
              className,
            )}
          >
            <span className={cn('min-w-0 truncate', selectedItem || (multiSelect && selectedIds && selectedIds.size > 0) ? 'text-foreground' : 'text-muted')}>
              {selectedItem?.label ?? placeholder}
            </span>
            <div className="flex shrink-0 items-center gap-1">
              {multiSelect && selectedIds && selectedIds.size > 0 && onClearAll && (
                <span
                  role="button"
                  tabIndex={-1}
                  className="rounded-sm p-0.5 hover:bg-border/50"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClearAll();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.stopPropagation();
                      onClearAll();
                    }
                  }}
                >
                  <X className="h-3.5 w-3.5 opacity-50 hover:opacity-100" />
                </span>
              )}
              <ChevronDown className="h-4 w-4 opacity-50" />
            </div>
          </button>
        </PopoverTrigger>

        <PopoverContent
          className="w-[var(--radix-popover-trigger-width)] min-w-[14rem] p-0"
          onKeyDown={handleKeyDown}
        >
          <div className="flex items-center border-b border-border px-3">
            <Search className="mr-2 h-4 w-4 shrink-0 text-muted" />
            <Input
              ref={searchInputRef}
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              placeholder={searchPlaceholder}
              className="h-9 border-0 shadow-none focus-visible:ring-0"
            />
          </div>

          <div
            ref={scrollContainerRef}
            role="listbox"
            className="overflow-y-auto"
            style={{ maxHeight: MAX_LIST_HEIGHT_PX }}
          >
            {isLoading && (
              <div className="py-4 text-center text-sm text-muted">Loading...</div>
            )}

            {!isLoading && selectableItems.length === 0 && (
              <div className="py-4 text-center text-sm text-muted">No results found</div>
            )}

            {!isLoading && selectableItems.length > 0 && (
              <div
                style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
              >
                {virtualizer.getVirtualItems().map((virtualRow) => {
                  const row = flatRows[virtualRow.index];
                  if (row.type === 'header') {
                    return (
                      <div
                        key={`header-${row.label}`}
                        className="px-3 py-1 text-xs font-semibold text-muted"
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          height: virtualRow.size,
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                      >
                        {row.label}
                      </div>
                    );
                  }

                  const { item, flatIndex } = row;
                  const isItemSelected = multiSelect
                    ? selectedIds?.has(item.id) ?? false
                    : item.id === value;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="option"
                      aria-selected={isItemSelected}
                      className={cn(
                        'flex w-full cursor-default select-none flex-col rounded-sm px-2 py-1.5 text-left text-sm outline-none',
                        flatIndex === highlightIndex && 'bg-accent/10',
                        isItemSelected && 'font-medium',
                      )}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: virtualRow.size,
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                      onClick={() => handleSelect(item.id)}
                      onMouseEnter={() => setHighlightIndex(flatIndex)}
                    >
                      <div className="flex items-center gap-2">
                        {multiSelect && (
                          <span
                            className={cn(
                              'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-border',
                              isItemSelected && 'border-accent bg-accent text-accent-foreground',
                            )}
                          >
                            {isItemSelected && <Check className="h-3 w-3" />}
                          </span>
                        )}
                        {item.status && (
                          <span
                            className={cn(
                              'inline-block h-2 w-2 shrink-0 rounded-full',
                              STATUS_COLORS[item.status] ?? 'bg-border',
                            )}
                          />
                        )}
                        <span className="truncate">{item.label}</span>
                      </div>
                      {item.subtitle && (
                        <span className={cn('truncate text-xs text-muted', multiSelect ? 'pl-6' : 'pl-4')}>{item.subtitle}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {(value || (multiSelect && selectedIds && selectedIds.size > 0)) && (
            <>
              <div className="border-t border-border" />
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-sm text-muted hover:bg-border/30"
                onClick={multiSelect && onClearAll ? onClearAll : handleClear}
              >
                Clear {multiSelect ? 'all' : 'selection'}
              </button>
            </>
          )}
        </PopoverContent>
      </Popover>
    );
  },
);
SearchableCombobox.displayName = 'SearchableCombobox';
