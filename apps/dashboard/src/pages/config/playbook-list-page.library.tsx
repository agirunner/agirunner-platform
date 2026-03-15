import { Link } from 'react-router-dom';
import { Archive, GitBranch, Layers3, RotateCcw, Rocket, Search, Settings2 } from 'lucide-react';

import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import {
  type PlaybookFamilyRecord,
  type PlaybookLifecycleFilter,
  type PlaybookSortOption,
  type PlaybookStatusFilter,
} from './playbook-list-page.support.js';

export function PlaybookLibraryToolbar(props: {
  search: string;
  statusFilter: PlaybookStatusFilter;
  lifecycleFilter: PlaybookLifecycleFilter;
  sort: PlaybookSortOption;
  familyCount: number;
  activeFamilyCount: number;
  archivedFamilyCount: number;
  onSearchChange(value: string): void;
  onStatusFilterChange(value: PlaybookStatusFilter): void;
  onLifecycleFilterChange(value: PlaybookLifecycleFilter): void;
  onSortChange(value: PlaybookSortOption): void;
}): JSX.Element {
  return (
    <div className="rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="text-sm font-medium">Playbook library</div>
          <p className="text-sm text-muted">
            {props.familyCount} families, {props.activeFamilyCount} active,{' '}
            {props.archivedFamilyCount} archived-only.
          </p>
        </div>
        <div className="relative min-w-[240px] flex-1 md:max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input
            value={props.search}
            onChange={(event) => props.onSearchChange(event.target.value)}
            placeholder="Search playbooks"
            className="pl-9"
          />
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <SegmentedFilter
          label="Status"
          value={props.statusFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'active', label: 'Active' },
            { value: 'archived', label: 'Archived-only' },
          ]}
          onChange={(value) => props.onStatusFilterChange(value as PlaybookStatusFilter)}
        />
        <SegmentedFilter
          label="Lifecycle"
          value={props.lifecycleFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'continuous', label: 'Continuous' },
            { value: 'standard', label: 'Standard' },
          ]}
          onChange={(value) => props.onLifecycleFilterChange(value as PlaybookLifecycleFilter)}
        />
        <label className="grid gap-2 text-sm">
          <span className="text-xs font-medium uppercase tracking-wide text-muted">Sort</span>
          <Select value={props.sort} onValueChange={(value) => props.onSortChange(value as PlaybookSortOption)}>
            <SelectTrigger className="min-w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="updated-desc">Recently updated</SelectItem>
              <SelectItem value="name-asc">Name</SelectItem>
              <SelectItem value="revision-count-desc">Most revisions</SelectItem>
            </SelectContent>
          </Select>
        </label>
      </div>
    </div>
  );
}

export function PlaybookFamilyCard(props: {
  family: PlaybookFamilyRecord;
  isArchiving: boolean;
  onArchiveChange(archived: boolean): void;
}): JSX.Element {
  const { family } = props;
  const playbook = family.primaryRevision;
  const isArchivedFamily = family.activeRevisionCount === 0;

  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-lg">
              <Link className="hover:underline" to={`/config/playbooks/${playbook.id}`}>
                {family.name}
              </Link>
            </CardTitle>
            <p className="text-sm text-muted">{family.slug}</p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Badge variant="outline">v{playbook.version}</Badge>
            <Badge variant="secondary">{family.lifecycle}</Badge>
            {isArchivedFamily ? <Badge variant="destructive">Archived-only</Badge> : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-muted">
          <span className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/20 px-3 py-1">
            <GitBranch className="h-3.5 w-3.5" />
            {family.revisionCount} revision{family.revisionCount === 1 ? '' : 's'}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/20 px-3 py-1">
            <Layers3 className="h-3.5 w-3.5" />
            {family.structure.boardColumns} columns / {family.structure.stages} stages
          </span>
          <span className="rounded-full border border-border/70 bg-muted/20 px-3 py-1">
            {family.activeRevisionCount > 0
              ? `${family.activeRevisionCount} active revision${family.activeRevisionCount === 1 ? '' : 's'}`
              : 'No active revisions'}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {family.description ? <p className="text-sm text-muted">{family.description}</p> : null}
        <div className="rounded-xl border border-border/70 bg-muted/15 p-3 text-sm">
          <div className="font-medium">Outcome</div>
          <div className="mt-1 text-muted">{family.outcome}</div>
        </div>
        {isArchivedFamily ? (
          <div className="rounded-md border border-amber-300 bg-amber-50/80 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            This family has no active revision. Restore one before launching a new workflow.
          </div>
        ) : null}
        <div className="grid grid-cols-3 gap-2">
          <Button asChild variant="outline" size="sm" className="w-full px-2">
            <Link to={`/config/playbooks/${playbook.id}`}>
              <Settings2 className="h-4 w-4" />
              Manage
            </Link>
          </Button>
          {isArchivedFamily ? (
            <Button
              variant="outline"
              size="sm"
              className="w-full px-2"
              onClick={() => props.onArchiveChange(false)}
              disabled={props.isArchiving}
            >
              <RotateCcw className="h-4 w-4" />
              Restore
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                className="w-full px-2"
                onClick={() => props.onArchiveChange(true)}
                disabled={props.isArchiving}
              >
                <Archive className="h-4 w-4" />
                Archive
              </Button>
              <Button asChild size="sm" className="w-full px-2">
                <Link to={`/config/playbooks/${playbook.id}/launch`}>
                  <Rocket className="h-4 w-4" />
                  Launch
                </Link>
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function SegmentedFilter(props: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange(value: string): void;
}): JSX.Element {
  return (
    <div className="grid gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-muted">{props.label}</span>
      <div className="flex flex-wrap gap-2">
        {props.options.map((option) => (
          <Button
            key={option.value}
            type="button"
            variant={props.value === option.value ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => props.onChange(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
