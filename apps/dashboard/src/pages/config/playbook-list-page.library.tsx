import { Link } from 'react-router-dom';
import { Archive, RotateCcw, Rocket, Search, Settings2, Trash2 } from 'lucide-react';

import type { DashboardPlaybookRecord } from '../../lib/api.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Input } from '../../components/ui/input.js';
import {
  PlaybookLifecycleFilter,
  PlaybookStatusFilter,
  summarizePlaybookStructure,
  type PlaybookLibrarySummaryCard,
} from './playbook-list-page.support.js';

export function PlaybookLibrarySummaryCards(props: {
  cards: PlaybookLibrarySummaryCard[];
}): JSX.Element {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {props.cards.map((card) => (
        <Card key={card.label} className="border-border/70 shadow-sm">
          <CardHeader className="space-y-1">
            <p className="text-sm font-medium text-muted">{card.label}</p>
            <CardTitle className="text-2xl">{card.value}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-6 text-muted">{card.detail}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function PlaybookLibraryFilters(props: {
  search: string;
  statusFilter: PlaybookStatusFilter;
  lifecycleFilter: PlaybookLifecycleFilter;
  onSearchChange(value: string): void;
  onStatusFilterChange(value: PlaybookStatusFilter): void;
  onLifecycleFilterChange(value: PlaybookLifecycleFilter): void;
}): JSX.Element {
  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader className="space-y-1">
        <CardTitle className="text-base">Library filters</CardTitle>
        <p className="text-sm text-muted">
          Narrow the library by search, lifecycle, and launch posture.
        </p>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-[minmax(0,1fr),auto,auto]">
        <div className="relative max-w-xl">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input
            value={props.search}
            onChange={(event) => props.onSearchChange(event.target.value)}
            placeholder="Search playbooks..."
            className="pl-9"
          />
        </div>
        <SegmentedFilter
          label="Status"
          value={props.statusFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'active', label: 'Active' },
            { value: 'archived', label: 'Archived' },
          ]}
          onChange={(value) => props.onStatusFilterChange(value as PlaybookStatusFilter)}
        />
        <SegmentedFilter
          label="Lifecycle"
          value={props.lifecycleFilter}
          options={[
            { value: 'all', label: 'All lifecycles' },
            { value: 'continuous', label: 'Continuous' },
            { value: 'standard', label: 'Standard' },
          ]}
          onChange={(value) => props.onLifecycleFilterChange(value as PlaybookLifecycleFilter)}
        />
      </CardContent>
    </Card>
  );
}

export function PlaybookCard(props: {
  playbook: DashboardPlaybookRecord;
  confirmDelete: boolean;
  isArchiving: boolean;
  isDeleting: boolean;
  onArchiveChange(archived: boolean): void;
  onDelete(): void;
  onRequestDelete(): void;
}) {
  const { playbook } = props;
  const structure = summarizePlaybookStructure(playbook);

  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg">{playbook.name}</CardTitle>
            <p className="text-sm text-muted">{playbook.slug}</p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Badge variant="outline">v{playbook.version}</Badge>
            {!playbook.is_active ? <Badge variant="destructive">Archived</Badge> : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{playbook.lifecycle}</Badge>
          <Badge variant="outline">{structure.boardColumns} columns</Badge>
          <Badge variant="outline">{structure.stages} stages</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {playbook.description ? <p className="text-sm text-muted">{playbook.description}</p> : null}
        <div className="rounded-md border border-border bg-muted/20 p-3 text-sm">
          <div className="font-medium">Outcome</div>
          <div className="text-muted">{playbook.outcome}</div>
        </div>
        {!playbook.is_active ? (
          <div className="rounded-md border border-amber-300 bg-amber-50/80 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            Archived playbooks stay available for review and revision history, but launch is
            disabled until this revision is restored or a new active revision is created.
          </div>
        ) : null}
        {props.confirmDelete ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
            <div className="font-medium">Delete this playbook revision?</div>
            <p className="mt-1">
              This permanently removes version {playbook.version}. Existing workflows that already
              reference it will block deletion.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={props.onRequestDelete}>
                Keep revision
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={props.onDelete}
                disabled={props.isDeleting}
              >
                Delete revision
              </Button>
            </div>
          </div>
        ) : null}
        <div className="flex justify-end">
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link to={`/config/playbooks/${playbook.id}`}>
                <Settings2 className="h-4 w-4" />
                Manage
              </Link>
            </Button>
            {playbook.is_active ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => props.onArchiveChange(true)}
                  disabled={props.isArchiving}
                >
                  <Archive className="h-4 w-4" />
                  Archive
                </Button>
                <Button asChild>
                  <Link to={`/config/playbooks/${playbook.id}/launch`}>
                    <Rocket className="h-4 w-4" />
                    Launch
                  </Link>
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                onClick={() => props.onArchiveChange(false)}
                disabled={props.isArchiving}
              >
                <RotateCcw className="h-4 w-4" />
                Restore
              </Button>
            )}
            <Button variant="outline" onClick={props.onRequestDelete} disabled={props.isDeleting}>
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          </div>
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
}) {
  return (
    <div className="grid gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-muted">{props.label}</span>
      <div className="flex flex-wrap gap-2">
        {props.options.map((option) => (
          <Button
            key={option.value}
            type="button"
            variant={props.value === option.value ? 'default' : 'outline'}
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
