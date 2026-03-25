import { Link } from 'react-router-dom';
import { CheckCheck, Rocket, Search, Settings2, Users } from 'lucide-react';

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

function describePlaybookLifecycle(lifecycle: 'planned' | 'ongoing'): string {
  return lifecycle === 'planned' ? 'Planned' : 'Ongoing';
}

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
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0 flex-1 space-y-3">
          <p className="text-sm text-muted">
            {props.familyCount} families · {props.activeFamilyCount} active ·{' '}
            {props.archivedFamilyCount} inactive
          </p>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,180px)_minmax(0,180px)_minmax(0,220px)]">
            <label className="grid gap-2 text-sm">
              <span className="text-xs font-medium uppercase tracking-wide text-muted">
                Search
              </span>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <Input
                  value={props.search}
                  onChange={(event) => props.onSearchChange(event.target.value)}
                  placeholder="Search playbooks"
                  className="pl-9"
                />
              </div>
            </label>
            <label className="grid gap-2 text-sm">
              <span className="text-xs font-medium uppercase tracking-wide text-muted">
                Status
              </span>
              <Select
                value={props.statusFilter}
                onValueChange={(value) => props.onStatusFilterChange(value as PlaybookStatusFilter)}
              >
                <SelectTrigger aria-label="Playbook status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="archived">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="grid gap-2 text-sm">
              <span className="text-xs font-medium uppercase tracking-wide text-muted">
                Lifecycle
              </span>
              <Select
                value={props.lifecycleFilter}
                onValueChange={(value) => props.onLifecycleFilterChange(value as PlaybookLifecycleFilter)}
              >
                <SelectTrigger aria-label="Playbook lifecycle">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="ongoing">Ongoing</SelectItem>
                  <SelectItem value="planned">Planned</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="grid gap-2 text-sm">
              <span className="text-xs font-medium uppercase tracking-wide text-muted">Sort</span>
              <Select value={props.sort} onValueChange={(value) => props.onSortChange(value as PlaybookSortOption)}>
                <SelectTrigger>
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
      </div>
    </div>
  );
}

export function PlaybookFamilyCard(props: {
  family: PlaybookFamilyRecord;
}): JSX.Element {
  const { family } = props;
  const playbook = family.primaryRevision;
  const isArchivedFamily = family.activeRevisionCount === 0;
  const processSummary =
    family.process.processInstructions || 'Open the playbook to define process instructions.';

  return (
    <Card className="flex min-h-[420px] flex-col border-border/70 bg-card/80 shadow-sm">
      <CardHeader className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-lg">
              <Link className="hover:underline" to={`/design/playbooks/${playbook.id}`}>
                {family.name}
              </Link>
            </CardTitle>
            <p className="text-sm text-muted">{family.slug}</p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Badge variant="outline">v{playbook.version}</Badge>
            <Badge variant="secondary">{describePlaybookLifecycle(family.lifecycle)}</Badge>
            {isArchivedFamily ? <Badge variant="secondary">Inactive</Badge> : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-muted">
          <span className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/20 px-3 py-1">
            <Users className="h-3.5 w-3.5" />
            {family.process.roleCount} roles
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/20 px-3 py-1">
            <CheckCheck className="h-3.5 w-3.5" />
            {family.structure.stages} stages / {family.structure.boardColumns} columns
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/20 px-3 py-1">
            {family.process.inputCount} inputs
          </span>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col space-y-4 overflow-hidden">
        <div className="rounded-xl border border-border/70 bg-background/60 p-3 text-sm">
          <div className="font-medium">Outcome</div>
          <div className="mt-1 line-clamp-2 text-muted">{family.outcome}</div>
        </div>
        <div className="h-[108px] overflow-hidden rounded-xl border border-border/70 bg-background/60 p-3 text-sm">
          <div className="font-medium">Process</div>
          <div className="mt-1 line-clamp-3 text-muted">{processSummary}</div>
        </div>
        {isArchivedFamily ? (
          <div className="rounded-md border border-amber-300 bg-amber-50/80 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            This playbook is inactive. Open it to reactivate the family before launching a new
            workflow.
          </div>
        ) : null}
        <div className="mt-auto flex flex-wrap gap-2">
          <Button asChild size="sm">
            <Link to={`/design/playbooks/${playbook.id}`}>
              <Settings2 className="h-4 w-4" />
              Manage
            </Link>
          </Button>
          {isArchivedFamily ? (
            <Button size="sm" disabled>
              <Rocket className="h-4 w-4" />
              Launch
            </Button>
          ) : (
            <Button asChild size="sm">
              <Link to={`/design/playbooks/${playbook.id}/launch`}>
                <Rocket className="h-4 w-4" />
                Launch
              </Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
