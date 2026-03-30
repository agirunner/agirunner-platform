import { ChevronDown, Trash2 } from 'lucide-react';

import { Button } from '../../components/ui/button.js';
import { Card, CardContent } from '../../components/ui/card.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';
import { cn } from '../../lib/utils.js';
import {
  formatPlaybookDeleteError,
  type PlaybookDeleteImpactSummaryWithRevisions,
} from './playbook-detail-page.controller.js';

export function PlaybookDangerZone(props: {
  dangerOpen: boolean;
  isDeletePending: boolean;
  isPermanentDeletePending: boolean;
  onOpenDeleteDialog(): void;
  onOpenPermanentDeleteDialog(): void;
  onToggleDanger(): void;
}): JSX.Element {
  return (
    <Card id="playbook-danger-zone" className="border-border/70 shadow-none">
      <button
        type="button"
        className="flex w-full items-start justify-between gap-3 px-4 py-4 text-left"
        aria-expanded={props.dangerOpen}
        onClick={props.onToggleDanger}
      >
        <div className="space-y-1.5">
          <div className="text-base font-semibold text-foreground">Danger</div>
          <p className="text-sm leading-6 text-muted">
            Delete this revision without affecting sibling revisions, or permanently remove the
            entire playbook family.
          </p>
          <p className="max-w-3xl text-sm leading-5 text-muted">
            Permanent delete removes every revision in this playbook family and deletes linked
            workflows, tasks, and work items after stopping active work.
          </p>
        </div>
        <div className="flex items-center gap-2 pt-0.5">
          <span className="text-xs font-medium text-muted">
            {props.dangerOpen ? 'Hide danger' : 'Open danger'}
          </span>
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-muted transition-transform',
              props.dangerOpen && 'rotate-180',
            )}
          />
        </div>
      </button>
      {props.dangerOpen ? (
        <CardContent className="border-t border-border/70 p-4 pt-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3 rounded-xl border border-border/70 bg-muted/15 p-4">
              <div className="space-y-1">
                <div className="font-medium text-foreground">Delete revision</div>
                <p className="text-sm leading-6 text-muted">
                  Delete this revision only. If workflows still reference it, revision deletion
                  stays blocked.
                </p>
              </div>
              <Button
                variant="outline"
                onClick={props.onOpenDeleteDialog}
                disabled={props.isDeletePending}
              >
                <Trash2 className="h-4 w-4" />
                Delete Revision
              </Button>
            </div>
            <div className="space-y-3 rounded-xl border border-red-300 bg-red-50/60 p-4 dark:border-red-900/60 dark:bg-red-950/20">
              <div className="space-y-1">
                <div className="font-medium text-foreground">Delete playbook permanently</div>
                <p className="text-sm leading-6 text-muted">
                  Delete permanently removes every revision in this playbook family and all linked
                  work.
                </p>
              </div>
              <Button
                variant="destructive"
                onClick={props.onOpenPermanentDeleteDialog}
                disabled={props.isPermanentDeletePending}
              >
                <Trash2 className="h-4 w-4" />
                Delete Playbook Permanently
              </Button>
            </div>
          </div>
        </CardContent>
      ) : null}
    </Card>
  );
}

export function PlaybookDeleteDialogs(props: {
  deleteError: unknown;
  deleteOpen: boolean;
  familyImpact: PlaybookDeleteImpactSummaryWithRevisions | null;
  isDeleteImpactLoading: boolean;
  isDeletePending: boolean;
  isPermanentDeletePending: boolean;
  isRevisionDeleteBlocked: boolean;
  onDeleteOpenChange(open: boolean): void;
  onDeletePermanently(): void;
  onDeleteRevision(): void;
  onPermanentDeleteOpenChange(open: boolean): void;
  permanentDeleteError: unknown;
  permanentDeleteOpen: boolean;
  playbookDeleteImpactError: unknown;
  playbookName: string;
  playbookVersion: number;
  revisionImpact: PlaybookDeleteImpactSummaryWithRevisions | null;
}): JSX.Element {
  return (
    <>
      <Dialog open={props.deleteOpen} onOpenChange={props.onDeleteOpenChange}>
        <DialogContent className="max-h-[70vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Delete Playbook Revision</DialogTitle>
            <DialogDescription>
              Delete this revision only. If workflows still reference it, revision deletion stays
              blocked.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm text-muted">
            <p>
              Deleting <span className="font-medium text-foreground">{props.playbookName}</span>{' '}
              version <span className="font-mono">v{props.playbookVersion}</span> does not remove
              sibling revisions.
            </p>
            <div className="rounded-xl border border-border/70 bg-muted/15 p-4">
              <div className="text-sm font-medium text-foreground">Delete impact</div>
              <PlaybookDeleteImpactDetails
                impact={props.revisionImpact}
                revisions={null}
                isLoading={props.isDeleteImpactLoading}
                error={props.playbookDeleteImpactError}
              />
            </div>
            <p>
              {props.isRevisionDeleteBlocked && props.revisionImpact
                ? `This revision is still referenced by ${props.revisionImpact.workflows} workflow${props.revisionImpact.workflows === 1 ? '' : 's'} and cannot be deleted yet.`
                : 'No workflows currently reference this revision.'}
            </p>
            {props.deleteError ? (
              <p className="text-sm text-red-600 dark:text-red-400">
                {formatPlaybookDeleteError(props.deleteError)}
              </p>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => props.onDeleteOpenChange(false)}>
                Keep revision
              </Button>
              <Button
                variant="destructive"
                onClick={props.onDeleteRevision}
                disabled={
                  props.isDeletePending
                  || props.isDeleteImpactLoading
                  || Boolean(props.playbookDeleteImpactError)
                  || props.isRevisionDeleteBlocked
                }
              >
                Delete Revision
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={props.permanentDeleteOpen} onOpenChange={props.onPermanentDeleteOpenChange}>
        <DialogContent className="max-h-[70vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Delete Playbook Permanently</DialogTitle>
            <DialogDescription>
              Delete permanently removes every revision in this playbook family.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm text-muted">
            <p>
              Deleting <span className="font-medium text-foreground">{props.playbookName}</span>{' '}
              permanently removes every saved revision, stops active workflows, and deletes linked
              workflows, tasks, and work items.
            </p>
            <div className="rounded-xl border border-border/70 bg-muted/15 p-4">
              <div className="text-sm font-medium text-foreground">Delete impact</div>
              <PlaybookDeleteImpactDetails
                impact={props.familyImpact}
                revisions={props.familyImpact?.revisions ?? null}
                isLoading={props.isDeleteImpactLoading}
                error={props.playbookDeleteImpactError}
              />
            </div>
            {props.permanentDeleteError ? (
              <p className="text-sm text-red-600 dark:text-red-400">
                {formatPlaybookDeleteError(props.permanentDeleteError)}
              </p>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => props.onPermanentDeleteOpenChange(false)}>
                Keep playbook
              </Button>
              <Button
                variant="destructive"
                onClick={props.onDeletePermanently}
                disabled={
                  props.isPermanentDeletePending
                  || props.isDeleteImpactLoading
                  || Boolean(props.playbookDeleteImpactError)
                }
              >
                Delete Playbook Permanently
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function PlaybookDeleteImpactDetails(props: {
  impact: PlaybookDeleteImpactSummaryWithRevisions | null;
  revisions: number | null;
  isLoading: boolean;
  error: unknown;
}): JSX.Element | null {
  if (props.isLoading) {
    return <p className="mt-2 text-sm text-muted">Loading delete impact…</p>;
  }
  if (props.error) {
    return (
      <p className="mt-2 text-sm text-red-600 dark:text-red-400">
        Failed to load delete impact: {formatPlaybookDeleteError(props.error)}
      </p>
    );
  }
  if (!props.impact) {
    return null;
  }

  const items = [
    props.revisions !== null ? ['Revisions', props.revisions] : null,
    ['Workflows', props.impact.workflows],
    ['Active workflows', props.impact.active_workflows],
    ['Tasks', props.impact.tasks],
    ['Active tasks', props.impact.active_tasks],
    ['Work items', props.impact.work_items],
  ].filter(Boolean) as Array<[string, number]>;

  return (
    <dl className="mt-3 grid gap-2 sm:grid-cols-2">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-lg border border-border/70 bg-background/80 px-3 py-2">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
            {label}
          </dt>
          <dd className="mt-1 text-sm font-medium text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
