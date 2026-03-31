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
import { ChevronDown, Search, X } from 'lucide-react';

import { cn } from '../../../lib/utils.js';
import { Input } from '../../ui/input.js';
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/popover.js';
import {
  buildFlatRows,
  collectSelectableItems,
  MAX_LIST_HEIGHT_PX,
  type SearchableComboboxProps,
  VIRTUALIZE_AFTER_ROW_COUNT,
} from './searchable-combobox.support.js';
import { SearchableComboboxList } from './searchable-combobox.list.js';

export type {
  ComboboxGroup,
  ComboboxItem,
  SearchableComboboxProps,
} from './searchable-combobox.support.js';

export const SearchableCombobox = forwardRef<HTMLButtonElement, SearchableComboboxProps>(
  (
    {
      items,
      recentItems = [],
      value,
      onChange,
      onOpenChange,
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
      if (!query) {
        return items;
      }
      const lower = query.toLowerCase();
      return items.filter(
        (item) =>
          item.label.toLowerCase().includes(lower) || item.subtitle?.toLowerCase().includes(lower),
      );
    }, [items, query]);

    const filteredRecent = useMemo(() => {
      if (!query) {
        return recentItems;
      }
      const lower = query.toLowerCase();
      return recentItems.filter(
        (item) =>
          item.label.toLowerCase().includes(lower) || item.subtitle?.toLowerCase().includes(lower),
      );
    }, [query, recentItems]);

    const recentIds = useMemo(
      () => new Set(filteredRecent.map((item) => item.id)),
      [filteredRecent],
    );
    const nonRecentItems = useMemo(
      () => filtered.filter((item) => !recentIds.has(item.id)),
      [filtered, recentIds],
    );
    const flatRows = useMemo(
      () => buildFlatRows(filteredRecent, nonRecentItems, allGroupLabel),
      [allGroupLabel, filteredRecent, nonRecentItems],
    );
    const selectableItems = useMemo(() => collectSelectableItems(flatRows), [flatRows]);
    const shouldVirtualize = flatRows.length > VIRTUALIZE_AFTER_ROW_COUNT;
    const selectedItem = useMemo(
      () =>
        value
          ? (items.find((item) => item.id === value) ??
            recentItems.find((item) => item.id === value))
          : null,
      [items, recentItems, value],
    );

    const virtualizer = useVirtualizer({
      count: flatRows.length,
      getScrollElement: () => scrollContainerRef.current,
      estimateSize: (index) => (flatRows[index].type === 'header' ? 28 : 48),
      overscan: 5,
    });
    const virtualRows = virtualizer.getVirtualItems();

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
      [multiSelect, onChange],
    );

    const handleClear = useCallback(() => {
      onChange(null);
      setOpen(false);
      setQuery('');
    }, [onChange]);

    const scrollToHighlight = useCallback(
      (index: number) => {
        const rowIndex = flatRows.findIndex(
          (row) => row.type === 'item' && row.flatIndex === index,
        );
        if (rowIndex >= 0) {
          virtualizer.scrollToIndex(rowIndex, { align: 'auto' });
        }
      },
      [flatRows, virtualizer],
    );

    const handleKeyDown = useCallback(
      (event: KeyboardEvent) => {
        switch (event.key) {
          case 'ArrowDown':
            event.preventDefault();
            setHighlightIndex((previous) => {
              const next = Math.min(previous + 1, selectableItems.length - 1);
              scrollToHighlight(next);
              return next;
            });
            break;
          case 'ArrowUp':
            event.preventDefault();
            setHighlightIndex((previous) => {
              const next = Math.max(previous - 1, 0);
              scrollToHighlight(next);
              return next;
            });
            break;
          case 'Enter':
            event.preventDefault();
            if (selectableItems[highlightIndex]) {
              handleSelect(selectableItems[highlightIndex].id);
            }
            break;
          case 'Escape':
            event.preventDefault();
            setOpen(false);
            break;
        }
      },
      [handleSelect, highlightIndex, scrollToHighlight, selectableItems],
    );

    useEffect(() => {
      if (open) {
        setHighlightIndex(0);
        requestAnimationFrame(() => searchInputRef.current?.focus());
      }
    }, [open]);

    useEffect(() => {
      if (!open || !shouldVirtualize) {
        return;
      }
      const frame = requestAnimationFrame(() => {
        virtualizer.measure();
      });
      return () => cancelAnimationFrame(frame);
    }, [open, shouldVirtualize, virtualizer]);

    useEffect(() => () => clearTimeout(debounceRef.current), []);

    const handleOpenChange = useCallback(
      (nextOpen: boolean) => {
        setOpen(nextOpen);
        onOpenChange?.(nextOpen);
      },
      [onOpenChange],
    );

    return (
      <Popover open={open} onOpenChange={handleOpenChange}>
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
            <span
              className={cn(
                'min-w-0 truncate',
                selectedItem || (multiSelect && selectedIds && selectedIds.size > 0)
                  ? 'text-foreground'
                  : 'text-muted',
              )}
            >
              {selectedItem?.label ?? placeholder}
            </span>
            <div className="flex shrink-0 items-center gap-1">
              {multiSelect && selectedIds && selectedIds.size > 0 && onClearAll ? (
                <span
                  role="button"
                  tabIndex={-1}
                  className="rounded-sm p-0.5 hover:bg-border/50"
                  onClick={(event) => {
                    event.stopPropagation();
                    onClearAll();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.stopPropagation();
                      onClearAll();
                    }
                  }}
                >
                  <X className="h-3.5 w-3.5 opacity-50 hover:opacity-100" />
                </span>
              ) : null}
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
              onChange={(event) => handleQueryChange(event.target.value)}
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
            <SearchableComboboxList
              flatRows={flatRows}
              highlightIndex={highlightIndex}
              isLoading={Boolean(isLoading)}
              multiSelect={multiSelect}
              selectedIds={selectedIds}
              selectableItems={selectableItems}
              shouldVirtualize={shouldVirtualize}
              value={value}
              virtualRows={virtualRows}
              virtualizer={virtualizer}
              onSelect={handleSelect}
              onHighlightChange={setHighlightIndex}
            />
          </div>

          {value || (multiSelect && selectedIds && selectedIds.size > 0) ? (
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
          ) : null}
        </PopoverContent>
      </Popover>
    );
  },
);

SearchableCombobox.displayName = 'SearchableCombobox';
