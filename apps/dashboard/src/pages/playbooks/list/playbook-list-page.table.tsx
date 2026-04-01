import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, Pencil, Plus, Rocket } from 'lucide-react';

import { Badge } from '../../../components/ui/badge.js';
import { Button } from '../../../components/ui/button.js';
import { Card, CardContent } from '../../../components/ui/card.js';
import { IconActionButton } from '../../../components/ui/icon-action-button.js';
import { Switch } from '../../../components/ui/switch.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table.js';
import { DASHBOARD_BADGE_TOKENS } from '../../../lib/dashboard-badge-palette.js';
import type { PlaybookFamilyRecord } from './playbook-list-page.support.js';
import { buildWorkflowsLaunchHref } from '../../workflows/workflows-page.support.js';

function describePlaybookLifecycle(lifecycle: 'planned' | 'ongoing'): string {
  return lifecycle === 'planned' ? 'Planned' : 'Ongoing';
}

function playbookLifecycleBadgeClassName(lifecycle: 'planned' | 'ongoing'): string {
  return lifecycle === 'ongoing'
    ? DASHBOARD_BADGE_TOKENS.success.className
    : DASHBOARD_BADGE_TOKENS.informationSecondary.className;
}

export function PlaybookLibraryEmptyState(props: {
  onCreatePlaybook(): void;
}): JSX.Element {
  return (
    <Card className="border-border/70 bg-card/80 shadow-none">
      <CardContent className="flex flex-col items-center justify-center gap-4 py-12 text-center">
        <Rocket className="h-12 w-12 text-muted" />
        <div className="space-y-1">
          <p className="font-medium text-foreground">No playbooks yet</p>
          <p className="max-w-2xl text-sm leading-6 text-muted">
            Create the first playbook, then shape workflow guidance, specialist coordination, and
            launch behavior from one place.
          </p>
        </div>
        <Button onClick={props.onCreatePlaybook} className="w-full sm:w-auto">
          <Plus className="h-4 w-4" />
          Create first playbook
        </Button>
      </CardContent>
    </Card>
  );
}

export function PlaybookLibraryTable(props: {
  families: PlaybookFamilyRecord[];
  togglingFamilySlug?: string | null;
  onToggleActive?(family: PlaybookFamilyRecord): void;
}): JSX.Element {
  return (
    <div className="overflow-x-auto border-y border-border/70">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Playbook</TableHead>
            <TableHead>Lifecycle</TableHead>
            <TableHead>Team</TableHead>
            <TableHead>Structure</TableHead>
            <TableHead>Revision</TableHead>
            <TableHead className="w-[160px] text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.families.map((family) => (
            <PlaybookFamilyRow
              key={family.slug}
              family={family}
              togglingFamilySlug={props.togglingFamilySlug ?? null}
              onToggleActive={props.onToggleActive}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function PlaybookFamilyRow(props: {
  family: PlaybookFamilyRecord;
  togglingFamilySlug: string | null;
  onToggleActive?(family: PlaybookFamilyRecord): void;
}): JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);
  const { family } = props;
  const playbook = family.primaryRevision;
  const isArchivedFamily = family.activeRevisionCount === 0;
  const isTogglePending = props.togglingFamilySlug === family.slug;
  const processSummary =
    family.process.processInstructions || 'Open the playbook to define process instructions.';
  const inputLabel = family.process.inputCount === 1 ? 'input' : 'inputs';

  return (
    <>
      <TableRow
        className={isArchivedFamily ? 'opacity-75' : undefined}
        onClick={() => setIsExpanded((value) => !value)}
      >
        <TableCell>
          <div className="flex items-start gap-2">
            {isExpanded ? (
              <ChevronDown className="mt-1 h-4 w-4 text-muted" />
            ) : (
              <ChevronRight className="mt-1 h-4 w-4 text-muted" />
            )}
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  className="font-medium text-foreground underline-offset-4 hover:underline"
                  to={`/design/playbooks/${playbook.id}`}
                >
                  {family.name}
                </Link>
                <Switch
                  checked={!isArchivedFamily}
                  disabled={isTogglePending}
                  onCheckedChange={() => props.onToggleActive?.(family)}
                  onClick={(event) => event.stopPropagation()}
                  aria-label={`Toggle ${family.name} active`}
                  className="scale-90"
                />
                <Badge variant={isArchivedFamily ? 'secondary' : 'success'}>
                  {isArchivedFamily ? 'Inactive' : 'Active'}
                </Badge>
                <Badge variant="outline">v{playbook.version}</Badge>
              </div>
              <p className="text-sm text-foreground">{family.slug}</p>
            </div>
          </div>
        </TableCell>
        <TableCell>
          <Badge variant="outline" className={playbookLifecycleBadgeClassName(family.lifecycle)}>
            {describePlaybookLifecycle(family.lifecycle)}
          </Badge>
        </TableCell>
        <TableCell className="text-sm text-foreground">
          {family.process.roleCount} roles · {family.process.inputCount} {inputLabel}
        </TableCell>
        <TableCell className="text-sm text-foreground">
          {family.structure.stages} stages / {family.structure.boardColumns} columns
        </TableCell>
        <TableCell className="text-sm text-foreground">
          v{playbook.version} · {family.revisionCount} revision
          {family.revisionCount === 1 ? '' : 's'}
        </TableCell>
        <TableCell className="text-right">
          <div className="flex justify-end gap-2">
            <IconActionButton
              asChild
              label={`Open ${family.name}`}
              onClick={(event) => event.stopPropagation()}
            >
              <Link to={`/design/playbooks/${playbook.id}`}>
                <Pencil className="h-4 w-4" />
              </Link>
            </IconActionButton>
            {isArchivedFamily ? (
              <IconActionButton
                label={`Launch ${family.name}`}
                disabled
                onClick={(event) => event.stopPropagation()}
              >
                <Rocket className="h-4 w-4" />
              </IconActionButton>
            ) : (
              <IconActionButton
                asChild
                label={`Launch ${family.name}`}
                onClick={(event) => event.stopPropagation()}
              >
                <Link to={buildWorkflowsLaunchHref({ playbookId: playbook.id })}>
                  <Rocket className="h-4 w-4" />
                </Link>
              </IconActionButton>
            )}
          </div>
        </TableCell>
      </TableRow>
      {isExpanded ? (
        <TableRow>
          <TableCell colSpan={6} className="bg-border/10">
            <div className="space-y-3 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
                Playbook details
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr),minmax(0,1.2fr)]">
                <div className="rounded-lg border border-border/70 bg-background/80 p-3 text-sm">
                  <div className="font-medium">Process</div>
                  <div className="mt-2 text-foreground">{processSummary}</div>
                </div>
                <div className="rounded-lg border border-border/70 bg-background/80 p-3 text-sm">
                  <div className="font-medium">Outcome</div>
                  <div className="mt-2 text-foreground">{family.outcome}</div>
                </div>
              </div>
              {isArchivedFamily ? (
                <div className="rounded-md border border-amber-300 bg-amber-50/80 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                  This playbook is inactive. Use the row toggle to reactivate the family before
                  launching a new workflow.
                </div>
              ) : null}
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}
