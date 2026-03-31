import type { KeyboardEvent as ReactKeyboardEvent, MutableRefObject, RefObject } from 'react';
import { Search, X } from 'lucide-react';

import { cn } from '../../lib/utils.js';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../ui/dialog.js';
import type { CommandPaletteItem } from './layout-search.js';
import { FOCUS_RING_CLASSES, ICON_BUTTON_CLASSES } from './layout-nav.js';

export function readActiveElement(): HTMLElement | null {
  return document.activeElement instanceof HTMLElement ? document.activeElement : null;
}

export function restoreFocusToElement(element: HTMLElement | null): boolean {
  if (!element || !element.isConnected || element.getClientRects().length === 0) {
    return false;
  }
  element.focus();
  return document.activeElement === element;
}

export function CommandPaletteDialog(props: {
  open: boolean;
  shouldSearchWorkspace: boolean;
  searchQuery: string;
  searchStatus: 'idle' | 'loading' | 'ready' | 'error';
  activePaletteIndex: number;
  searchInputRef: RefObject<HTMLInputElement>;
  desktopSearchButtonRef: RefObject<HTMLButtonElement>;
  mobileSearchButtonRef: RefObject<HTMLButtonElement>;
  searchRestoreFocusRef: RefObject<HTMLElement>;
  paletteItemRefs: MutableRefObject<Array<HTMLButtonElement | null>>;
  visiblePaletteItems: CommandPaletteItem[];
  visiblePaletteRows: Array<{
    id: string;
    title: string;
    rows: Array<{ item: CommandPaletteItem; index: number }>;
  }>;
  paletteState: { title: string; detail: string };
  onOpenChange(nextOpen: boolean): void;
  onSearchQueryChange(value: string): void;
  onInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void;
  onActivePaletteIndexChange(index: number): void;
  onNavigateToPaletteItem(item: CommandPaletteItem): void;
}): JSX.Element {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        showCloseButton={false}
        closeLabel="Close command palette"
        className="max-w-2xl gap-3 rounded-2xl border-border/80 bg-surface/95 p-4 backdrop-blur"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          props.searchInputRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreFocusToElement(props.searchRestoreFocusRef.current) ||
            restoreFocusToElement(props.mobileSearchButtonRef.current) ||
            restoreFocusToElement(props.desktopSearchButtonRef.current);
        }}
      >
        <div className="space-y-3">
          <div className="space-y-1">
            <div className="flex items-start justify-between gap-3">
              <div>
                <DialogTitle className="text-sm font-semibold text-foreground">
                  Search the workspace
                </DialogTitle>
                <DialogDescription className="text-xs text-muted">
                  Workflow boards, tasks, workspaces, playbooks, specialist agents, and specialist
                  executions.
                </DialogDescription>
              </div>
              <div className="flex items-center gap-2">
                <kbd className="rounded border border-border px-1.5 py-0.5 text-xs text-muted">
                  Esc
                </kbd>
                <DialogClose asChild>
                  <button
                    type="button"
                    className={ICON_BUTTON_CLASSES}
                    aria-label="Close command palette"
                  >
                    <X size={16} />
                  </button>
                </DialogClose>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border/80 bg-background/70 px-3 py-2">
            <div className="flex items-center gap-2">
              <Search size={16} className="text-muted" />
              <input
                ref={props.searchInputRef}
                className={cn(
                  'flex-1 bg-transparent text-sm placeholder:text-muted',
                  FOCUS_RING_CLASSES,
                )}
                placeholder="Type to search or jump to a quick link"
                value={props.searchQuery}
                onChange={(event) => props.onSearchQueryChange(event.target.value)}
                onKeyDown={props.onInputKeyDown}
                role="combobox"
                aria-expanded={props.open}
                aria-controls="dashboard-command-palette-results"
                aria-activedescendant={
                  props.activePaletteIndex >= 0
                    ? `dashboard-command-palette-item-${props.activePaletteIndex}`
                    : undefined
                }
                aria-label="Search the workspace"
              />
              {props.searchStatus === 'loading' ? (
                <span className="text-xs text-muted">Searching…</span>
              ) : null}
            </div>
          </div>

          <div
            className={cn(
              'rounded-xl border px-3 py-3 text-sm',
              props.searchStatus === 'error'
                ? 'border-red-300/80 bg-red-50/80 text-red-900 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-100'
                : 'border-border/70 bg-muted/10 text-muted',
            )}
          >
            <p className="font-medium text-foreground">{props.paletteState.title}</p>
            <p className="mt-1 text-xs leading-5">{props.paletteState.detail}</p>
          </div>

          {props.visiblePaletteRows.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3 px-1">
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted">
                  {props.shouldSearchWorkspace ? 'Commands and results' : 'Actions and shortcuts'}
                </p>
                <p className="text-xs text-muted">{`${props.visiblePaletteItems.length} items`}</p>
              </div>
              <div
                id="dashboard-command-palette-results"
                role="listbox"
                className="max-h-72 space-y-3 overflow-y-auto"
              >
                {props.visiblePaletteRows.map((section) => (
                  <div key={section.id} className="space-y-1">
                    <div className="px-1 text-[11px] font-medium uppercase tracking-[0.2em] text-muted">
                      {section.title}
                    </div>
                    <ul className="space-y-1">
                      {section.rows.map(({ item, index }) => (
                        <li key={item.id}>
                          <button
                            id={`dashboard-command-palette-item-${index}`}
                            ref={(element) => {
                              props.paletteItemRefs.current[index] = element;
                            }}
                            type="button"
                            role="option"
                            aria-selected={index === props.activePaletteIndex}
                            className={cn(
                              'flex w-full items-start justify-between gap-3 rounded-xl px-3 py-3 text-left text-sm transition-colors',
                              FOCUS_RING_CLASSES,
                              index === props.activePaletteIndex
                                ? 'bg-accent/10 text-foreground'
                                : 'hover:bg-border/30',
                            )}
                            onMouseEnter={() => props.onActivePaletteIndexChange(index)}
                            onClick={() => props.onNavigateToPaletteItem(item)}
                          >
                            <div className="min-w-0">
                              <p className="font-medium text-foreground">{item.label}</p>
                              <p className="truncate text-xs text-muted">{item.meta}</p>
                            </div>
                            <span className="rounded-full border border-border/70 px-2 py-0.5 text-[11px] uppercase tracking-wide text-muted">
                              {item.kind}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {!props.shouldSearchWorkspace && props.visiblePaletteItems.length === 0 ? (
            <p className="px-1 text-xs text-muted">
              No quick links match that text yet. Keep typing to search the full workspace.
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
