import { Search } from 'lucide-react';
import { Input } from '../../components/ui/input.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select.js';

export interface StatusFilterOption {
  label: string;
  value: string | null;
}

export const STATUS_FILTER_OPTIONS: StatusFilterOption[] = [
  { label: 'All', value: null },
  { label: 'Active', value: 'active' },
  { label: 'Needs Attention', value: 'needs-attention' },
  { label: 'Completed', value: 'completed' },
  { label: 'Failed', value: 'failed' },
];

export interface PlaybookOption {
  id: string;
  name: string;
}

export interface WorkspaceOption {
  id: string;
  name: string;
}

export interface SearchFilterBarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  statusFilter: string | null;
  onStatusFilterChange: (status: string | null) => void;
  playbookFilter?: string | null;
  onPlaybookFilterChange?: (playbookId: string | null) => void;
  workspaceFilter?: string | null;
  onWorkspaceFilterChange?: (workspaceId: string | null) => void;
  playbooks?: PlaybookOption[];
  workspaces?: WorkspaceOption[];
}

export function matchesStatusFilter(status: string, filter: string | null): boolean {
  if (filter === null) return true;
  return status === filter;
}

export function SearchFilterBar({
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  playbookFilter,
  onPlaybookFilterChange,
  workspaceFilter,
  onWorkspaceFilterChange,
  playbooks = [],
  workspaces = [],
}: SearchFilterBarProps) {
  function handleStatusChange(value: string) {
    const option = STATUS_FILTER_OPTIONS.find((o) => (o.value ?? '__all__') === value);
    onStatusFilterChange(option?.value ?? null);
  }

  const statusValue = statusFilter ?? '__all__';

  const showPlaybookFilter = onPlaybookFilterChange !== undefined;
  const showWorkspaceFilter = onWorkspaceFilterChange !== undefined;

  return (
    <div className="flex items-center gap-2 bg-secondary/30 border border-border rounded-lg px-3 py-2">
      <div className="relative flex-1 min-w-0">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted pointer-events-none" />
        <Input
          type="search"
          placeholder="Search workflows..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-8 bg-transparent border-border-subtle h-8 text-sm"
        />
      </div>

      <Select value={statusValue} onValueChange={handleStatusChange}>
        <SelectTrigger
          data-testid="status-filter"
          className="w-[140px] h-8 text-sm bg-transparent border-border-subtle"
        >
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          {STATUS_FILTER_OPTIONS.map((option) => (
            <SelectItem key={option.label} value={option.value ?? '__all__'}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {showPlaybookFilter && (
        <Select
          value={playbookFilter ?? '__all__'}
          onValueChange={(v) => onPlaybookFilterChange!(v === '__all__' ? null : v)}
        >
          <SelectTrigger className="w-[140px] h-8 text-sm bg-transparent border-border-subtle">
            <SelectValue placeholder="Playbook" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All</SelectItem>
            {playbooks.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {showWorkspaceFilter && (
        <Select
          value={workspaceFilter ?? '__all__'}
          onValueChange={(v) => onWorkspaceFilterChange!(v === '__all__' ? null : v)}
        >
          <SelectTrigger className="w-[140px] h-8 text-sm bg-transparent border-border-subtle">
            <SelectValue placeholder="Workspace" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All</SelectItem>
            {workspaces.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
