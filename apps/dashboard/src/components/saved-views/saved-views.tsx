import { useState } from 'react';
import { Bookmark, Plus, Trash2, ChevronDown } from 'lucide-react';
import { Button } from '../ui/button.js';
import { Input } from '../ui/input.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu.js';

export interface SavedViewFilters {
  [key: string]: string;
}

interface SavedView {
  name: string;
  filters: SavedViewFilters;
}

const STORAGE_PREFIX = 'agirunner-saved-views-';

function loadViews(storageKey: string): SavedView[] {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${storageKey}`);
    if (!raw) return [];
    return JSON.parse(raw) as SavedView[];
  } catch {
    return [];
  }
}

function persistViews(storageKey: string, views: SavedView[]): void {
  localStorage.setItem(`${STORAGE_PREFIX}${storageKey}`, JSON.stringify(views));
}

interface SavedViewsProps {
  storageKey: string;
  currentFilters: SavedViewFilters;
  onApply: (filters: SavedViewFilters) => void;
}

export function SavedViews({
  storageKey,
  currentFilters,
  onApply,
}: SavedViewsProps): JSX.Element {
  const [views, setViews] = useState<SavedView[]>(() => loadViews(storageKey));
  const [isSaving, setIsSaving] = useState(false);
  const [newViewName, setNewViewName] = useState('');

  function saveView(): void {
    const name = newViewName.trim();
    if (!name) return;

    const updated = [...views.filter((v) => v.name !== name), { name, filters: { ...currentFilters } }];
    setViews(updated);
    persistViews(storageKey, updated);
    setNewViewName('');
    setIsSaving(false);
  }

  function deleteView(name: string): void {
    const updated = views.filter((v) => v.name !== name);
    setViews(updated);
    persistViews(storageKey, updated);
  }

  function applyView(view: SavedView): void {
    onApply(view.filters);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Bookmark className="h-4 w-4" />
          Saved Views
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {views.length === 0 && !isSaving && (
          <div className="px-3 py-2 text-xs text-muted-foreground">
            No saved views yet.
          </div>
        )}

        {views.map((view) => (
          <DropdownMenuItem
            key={view.name}
            className="flex items-center justify-between"
            onSelect={(e) => {
              e.preventDefault();
              applyView(view);
            }}
          >
            <span className="truncate text-sm">{view.name}</span>
            <button
              type="button"
              className="ml-2 rounded p-0.5 text-muted hover:text-red-600"
              onClick={(e) => {
                e.stopPropagation();
                deleteView(view.name);
              }}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />

        {isSaving ? (
          <div className="px-2 py-1.5">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                saveView();
              }}
              className="flex items-center gap-1"
            >
              <Input
                value={newViewName}
                onChange={(e) => setNewViewName(e.target.value)}
                placeholder="View name"
                className="h-7 text-xs"
                autoFocus
              />
              <Button type="submit" size="sm" className="h-7 px-2 text-xs" disabled={!newViewName.trim()}>
                Save
              </Button>
            </form>
          </div>
        ) : (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setIsSaving(true);
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="text-sm">Save Current Filters</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
