import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronDown, Save, Trash2 } from 'lucide-react';

import {
  dashboardApi,
  type DashboardDeleteImpactSummary,
  type DashboardPlaybookDeleteImpact,
} from '../../lib/api.js';
import { useUnsavedChanges } from '../../lib/use-unsaved-changes.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { Switch } from '../../components/ui/switch.js';
import { Textarea } from '../../components/ui/textarea.js';
import { cn } from '../../lib/utils.js';
import {
  buildPlaybookDefinition,
  hydratePlaybookAuthoringDraft,
  reconcileValidationIssues,
  type PlaybookAuthoringDraft,
} from '../playbook-authoring/playbook-authoring-support.js';
import { PlaybookAuthoringForm } from '../playbook-authoring/playbook-authoring-form.js';
import {
  buildPlaybookRevisionChain,
  buildPlaybookRevisionDiff,
} from './playbook-detail-support.js';
import { PlaybookRevisionHistoryCard } from './playbook-detail-sections.js';

const DEFAULT_LIFECYCLE = 'ongoing';
const lifecycleOptions = [
  {
    value: 'ongoing',
    label: 'Ongoing',
    description: 'Keeps one standing workflow open so new work can continue flowing into it over time.',
  },
  {
    value: 'planned',
    label: 'Planned',
    description: 'Launches a bounded workflow with a clear start, finish, and stage progression.',
  },
] as const;

function describePlaybookLifecycle(lifecycle: 'planned' | 'ongoing'): string {
  return lifecycle === 'planned' ? 'Planned' : 'Ongoing';
}

export function PlaybookDetailPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const playbookId = params.id ?? '';
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [outcome, setOutcome] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [lifecycle, setLifecycle] = useState<'planned' | 'ongoing'>(DEFAULT_LIFECYCLE);
  const [draft, setDraft] = useState<PlaybookAuthoringDraft>(() =>
    hydratePlaybookAuthoringDraft(DEFAULT_LIFECYCLE, {}),
  );
  const [authoringValidationIssues, setAuthoringValidationIssues] = useState<string[]>([]);
  const [definitionError, setDefinitionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loadedPlaybookId, setLoadedPlaybookId] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [permanentDeleteOpen, setPermanentDeleteOpen] = useState(false);
  const [dangerOpen, setDangerOpen] = useState(false);

  const playbookQuery = useQuery({
    queryKey: ['playbook', playbookId],
    queryFn: () => dashboardApi.getPlaybook(playbookId),
    enabled: playbookId.length > 0,
  });
  const playbooksQuery = useQuery({
    queryKey: ['playbooks'],
    queryFn: () => dashboardApi.listPlaybooks(),
  });
  const playbookDeleteImpactQuery = useQuery({
    queryKey: ['playbook-delete-impact', playbookId],
    queryFn: () => dashboardApi.getPlaybookDeleteImpact(playbookId),
    enabled: playbookId.length > 0 && (deleteOpen || permanentDeleteOpen),
  });
  const [comparedRevisionId, setComparedRevisionId] = useState('');

  useUnsavedChanges(isDirty);

  function loadPlaybook(playbook: NonNullable<typeof playbookQuery.data>): void {
    const nextLifecycle = playbook.lifecycle ?? DEFAULT_LIFECYCLE;
    setName(playbook.name);
    setSlug(playbook.slug);
    setOutcome(playbook.outcome);
    setIsActive(playbook.is_active !== false);
    setLifecycle(nextLifecycle);
    setDraft(hydratePlaybookAuthoringDraft(nextLifecycle, playbook.definition));
    setAuthoringValidationIssues([]);
    setLoadedPlaybookId(playbook.id);
    setIsDirty(false);
  }

  useEffect(() => {
    const playbook = playbookQuery.data;
    if (!playbook || loadedPlaybookId === playbook.id) {
      return;
    }
    loadPlaybook(playbook);
    setDefinitionError(null);
    setMessage(null);
  }, [loadedPlaybookId, playbookQuery.data]);

  const revisions = useMemo(() => {
    const playbook = playbookQuery.data;
    const allPlaybooks = playbooksQuery.data?.data ?? [];
    if (!playbook) {
      return [];
    }
    return buildPlaybookRevisionChain(allPlaybooks, playbook);
  }, [playbookQuery.data, playbooksQuery.data?.data]);

  useEffect(() => {
    if (revisions.length === 0) {
      return;
    }
    const fallbackRevisionId =
      revisions.find((revision) => revision.id !== playbookId)?.id ?? revisions[0]?.id ?? '';
    setComparedRevisionId((current) =>
      current && revisions.some((revision) => revision.id === current)
        ? current
        : fallbackRevisionId,
    );
  }, [playbookId, revisions]);

  const comparedRevision = useMemo(
    () => revisions.find((revision) => revision.id === comparedRevisionId) ?? null,
    [comparedRevisionId, revisions],
  );

  const revisionDiff = useMemo(() => {
    const playbook = playbookQuery.data;
    if (!playbook || !comparedRevision) {
      return [];
    }
    return buildPlaybookRevisionDiff(playbook, comparedRevision);
  }, [comparedRevision, playbookQuery.data]);

  const updateMutation = useMutation({
    mutationFn: async () => {
      const authoringIssue = authoringValidationIssues[0];
      if (authoringIssue) {
        throw new Error(authoringIssue);
      }
      const definition = buildPlaybookDefinition(lifecycle, draft);
      if (definition.ok === false) {
        throw new Error(definition.error);
      }
      const savedPlaybook = await dashboardApi.updatePlaybook(playbookId, {
        name: name.trim(),
        slug: slug.trim() || undefined,
        outcome: outcome.trim(),
        lifecycle,
        definition: definition.value,
      });
      if (!isActive) {
        return dashboardApi.archivePlaybook(savedPlaybook.id);
      }
      return savedPlaybook;
    },
    onSuccess: (playbook) => {
      loadPlaybook(playbook);
      setDefinitionError(null);
      setMessage(`Playbook saved as v${playbook.version}.`);
      void playbooksQuery.refetch();
      void navigate(`/design/playbooks/${playbook.id}`, { replace: true });
    },
    onError: (error) => {
      setMessage(null);
      setDefinitionError(error instanceof Error ? error.message : 'Failed to save playbook.');
    },
  });
  const deleteMutation = useMutation({
    mutationFn: () => dashboardApi.deletePlaybook(playbookId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['playbooks'] });
      await navigate('/design/playbooks');
    },
  });
  const permanentDeleteMutation = useMutation({
    mutationFn: () => dashboardApi.deletePlaybookPermanently(playbookId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['playbooks'] });
      await navigate('/design/playbooks');
    },
  });

  const canSave = useMemo(
    () => Boolean(playbookId && name.trim() && outcome.trim() && authoringValidationIssues.length === 0),
    [authoringValidationIssues.length, name, outcome, playbookId],
  );

  if (playbookQuery.isLoading) {
    return <div className="p-6 text-sm text-muted">Loading playbook...</div>;
  }

  if (playbookQuery.error || !playbookQuery.data) {
    return <div className="p-6 text-sm text-red-600 dark:text-red-400">Failed to load playbook.</div>;
  }

  const playbook = playbookQuery.data;
  const deleteImpact = playbookDeleteImpactQuery.data ?? null;
  const revisionDeleteBlocked = isPlaybookRevisionDeleteBlocked(deleteImpact);
  const revisionImpact = deleteImpact?.revision ?? null;
  const familyImpact = deleteImpact?.family ?? null;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      {!isActive ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50/80 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          This playbook is staged as inactive. Save the page to stop new workflow launches for this
          family while keeping revision history available.
        </div>
      ) : null}
      {message ? (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50/80 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
          {message}
        </div>
      ) : null}
      {definitionError ? (
        <div className="rounded-xl border border-red-300 bg-red-50/80 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
          {definitionError}
        </div>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{playbook.name}</h1>
            <Badge variant="outline">v{playbook.version}</Badge>
            <Badge variant="secondary">{describePlaybookLifecycle(playbook.lifecycle)}</Badge>
            {!playbook.is_active ? <Badge variant="secondary">Inactive</Badge> : null}
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted">
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground">Created</span>
              <span>{formatDate(playbook.created_at)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground">Updated</span>
              <span>{formatDate(playbook.updated_at)}</span>
            </div>
          </div>
          <p className="max-w-full overflow-x-auto whitespace-nowrap text-sm text-muted">
            Edit the playbook definition, workflow guidance, and launch inputs for this revision.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {playbook.is_active ? (
            <Button asChild variant="outline">
              <Link to={`/design/playbooks/${playbook.id}/launch`}>Launch</Link>
            </Button>
          ) : null}
          <Button onClick={() => updateMutation.mutate()} disabled={!canSave || updateMutation.isPending}>
            <Save className="h-4 w-4" />
            Save Playbook
          </Button>
        </div>
      </div>

      <Card id="playbook-identity">
        <CardHeader className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <CardTitle>Playbook Basics</CardTitle>
            <div className="flex shrink-0 items-center gap-2 pt-0.5">
              <span className="text-xs font-medium text-muted">
                {isActive ? 'Active' : 'Inactive'}
              </span>
              <Switch
                checked={isActive}
                aria-label="Playbook active"
                onCheckedChange={(checked) => {
                  setIsActive(checked);
                  setIsDirty(true);
                }}
              />
            </div>
          </div>
          <p className="text-sm text-muted">
            Keep the identity and operating model visible while you edit the process-first
            authoring sections below.
          </p>
        </CardHeader>
        <CardContent className="grid gap-6">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.35fr)] lg:items-stretch">
            <div className="grid gap-4">
              <label className="grid gap-2 text-sm">
                <span className="font-medium">Name</span>
                <Input value={name} onChange={(event) => { setName(event.target.value); setIsDirty(true); }} />
              </label>
              <label className="grid gap-2 text-sm">
                <span className="font-medium">Slug</span>
                <Input value={slug} onChange={(event) => { setSlug(event.target.value); setIsDirty(true); }} />
              </label>
              <div className="grid gap-2 text-sm">
                <span className="font-medium">Lifecycle</span>
                <Select
                  value={lifecycle}
                  onValueChange={(value) => {
                    setLifecycle(value as 'planned' | 'ongoing');
                    setIsDirty(true);
                  }}
                >
                  <SelectTrigger aria-label="Playbook lifecycle">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {lifecycleOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted">
                  {lifecycleOptions.find((option) => option.value === lifecycle)?.description}
                </p>
              </div>
            </div>
            <label className="grid gap-2 text-sm lg:h-full">
              <span className="font-medium">Outcome</span>
              <Textarea
                value={outcome}
                onChange={(event) => { setOutcome(event.target.value); setIsDirty(true); }}
                className="min-h-[220px] lg:h-full lg:min-h-0"
              />
            </label>
          </div>
        </CardContent>
      </Card>

      <PlaybookAuthoringForm
        draft={draft}
        onChange={(nextDraft) => { setDraft(nextDraft); setIsDirty(true); }}
        onClearError={() => {
          setDefinitionError(null);
          setMessage(null);
        }}
        onValidationChange={(nextIssues) =>
          setAuthoringValidationIssues((currentIssues) =>
            reconcileValidationIssues(currentIssues, nextIssues),
          )
        }
      />

      {authoringValidationIssues.length > 0 ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50/80 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          <div className="font-medium">Resolve these authoring blockers before saving.</div>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {authoringValidationIssues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <details
        id="playbook-revision-history"
        className="rounded-2xl border border-border/70 bg-card/80 p-5 shadow-sm"
      >
        <summary className="cursor-pointer list-none">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">Revision History</h2>
              <p className="text-sm text-muted">
                Compare every saved playbook setting against an earlier revision.
              </p>
            </div>
          </div>
        </summary>
        <div className="mt-4">
          <PlaybookRevisionHistoryCard
            currentPlaybook={playbook}
            revisions={revisions.length > 0 ? revisions : [playbook]}
            comparedRevisionId={comparedRevisionId || playbook.id}
            diffRows={revisionDiff}
            onComparedRevisionChange={setComparedRevisionId}
          />
        </div>
      </details>

      <Card id="playbook-danger-zone" className="border-border/70 shadow-none">
        <button
          type="button"
          className="flex w-full items-start justify-between gap-3 px-4 py-4 text-left"
          aria-expanded={dangerOpen}
          onClick={() => setDangerOpen((current) => !current)}
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
              {dangerOpen ? 'Hide danger' : 'Open danger'}
            </span>
            <ChevronDown
              className={cn(
                'h-4 w-4 shrink-0 text-muted transition-transform',
                dangerOpen && 'rotate-180',
              )}
            />
          </div>
        </button>
        {dangerOpen ? (
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
                  onClick={() => {
                    deleteMutation.reset();
                    setDeleteOpen(true);
                  }}
                  disabled={deleteMutation.isPending}
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
                  onClick={() => {
                    permanentDeleteMutation.reset();
                    setPermanentDeleteOpen(true);
                  }}
                  disabled={permanentDeleteMutation.isPending}
                >
                  <Trash2 className="h-4 w-4" />
                  Delete Playbook Permanently
                </Button>
              </div>
            </div>
          </CardContent>
        ) : null}
      </Card>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
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
              Deleting <span className="font-medium text-foreground">{playbook.name}</span>{' '}
              version <span className="font-mono">v{playbook.version}</span> does not remove
              sibling revisions.
            </p>
            <div className="rounded-xl border border-border/70 bg-muted/15 p-4">
              <div className="text-sm font-medium text-foreground">Delete impact</div>
              <PlaybookDeleteImpactDetails
                impact={revisionImpact}
                revisions={null}
                isLoading={playbookDeleteImpactQuery.isLoading}
                error={playbookDeleteImpactQuery.error}
              />
            </div>
            <p>
              {revisionDeleteBlocked && revisionImpact
                ? `This revision is still referenced by ${revisionImpact.workflows} workflow${revisionImpact.workflows === 1 ? '' : 's'} and cannot be deleted yet.`
                : 'No workflows currently reference this revision.'}
            </p>
            {deleteMutation.error ? (
              <p className="text-sm text-red-600 dark:text-red-400">
                {formatPlaybookDeleteError(deleteMutation.error)}
              </p>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => setDeleteOpen(false)}>
                Keep revision
              </Button>
              <Button
                variant="destructive"
                onClick={() => deleteMutation.mutate()}
                disabled={
                  deleteMutation.isPending
                  || playbookDeleteImpactQuery.isLoading
                  || Boolean(playbookDeleteImpactQuery.error)
                  || revisionDeleteBlocked
                }
              >
                Delete Revision
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={permanentDeleteOpen}
        onOpenChange={(open) => {
          if (!open) {
            setPermanentDeleteOpen(false);
          }
        }}
      >
        <DialogContent className="max-h-[70vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Delete Playbook Permanently</DialogTitle>
            <DialogDescription>
              Delete permanently removes every revision in this playbook family.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm text-muted">
            <p>
              Deleting <span className="font-medium text-foreground">{playbook.name}</span>{' '}
              permanently removes every saved revision, stops active workflows, and deletes linked
              workflows, tasks, and work items.
            </p>
            <div className="rounded-xl border border-border/70 bg-muted/15 p-4">
              <div className="text-sm font-medium text-foreground">Delete impact</div>
              <PlaybookDeleteImpactDetails
                impact={familyImpact}
                revisions={familyImpact?.revisions ?? null}
                isLoading={playbookDeleteImpactQuery.isLoading}
                error={playbookDeleteImpactQuery.error}
              />
            </div>
            {permanentDeleteMutation.error ? (
              <p className="text-sm text-red-600 dark:text-red-400">
                {formatPlaybookDeleteError(permanentDeleteMutation.error)}
              </p>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => setPermanentDeleteOpen(false)}>
                Keep playbook
              </Button>
              <Button
                variant="destructive"
                onClick={() => permanentDeleteMutation.mutate()}
                disabled={permanentDeleteMutation.isPending || playbookDeleteImpactQuery.isLoading || Boolean(playbookDeleteImpactQuery.error)}
              >
                Delete Playbook Permanently
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PlaybookDeleteImpactDetails(props: {
  impact: DashboardDeleteImpactSummary | (DashboardDeleteImpactSummary & { revisions?: number }) | null;
  revisions: number | null;
  isLoading: boolean;
  error: unknown;
}): JSX.Element {
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
          <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">{label}</dt>
          <dd className="mt-1 text-sm font-medium text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function isPlaybookRevisionDeleteBlocked(
  impact: DashboardPlaybookDeleteImpact | null,
): boolean {
  return (impact?.revision.workflows ?? 0) > 0;
}

function formatPlaybookDeleteError(error: unknown): string {
  const message = (error instanceof Error ? error.message : String(error ?? '')).trim();
  const normalized = message.replace(/^HTTP\s+\d+:\s*/i, '').trim();
  return normalized || 'Failed to delete playbook.';
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return 'unknown time';
  }
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}
