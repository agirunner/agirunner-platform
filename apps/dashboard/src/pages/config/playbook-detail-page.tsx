import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronDown, Save, Trash2 } from 'lucide-react';

import { dashboardApi } from '../../lib/api.js';
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
import { Textarea } from '../../components/ui/textarea.js';
import { ToggleCard } from '../../components/ui/toggle-card.js';
import { cn } from '../../lib/utils.js';
import {
  buildPlaybookDefinition,
  hydratePlaybookAuthoringDraft,
  type PlaybookAuthoringDraft,
} from './playbook-authoring-support.js';
import { PlaybookAuthoringForm } from './playbook-authoring-form.js';
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
      void navigate(`/config/playbooks/${playbook.id}`, { replace: true });
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
      await navigate('/config/playbooks');
    },
    onError: (error) => {
      setMessage(null);
      setDefinitionError(error instanceof Error ? error.message : 'Failed to delete playbook.');
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
          <p className="max-w-3xl text-sm text-muted">
            Edit workflow structure, automation policy, and launch inputs in one place without
            dropping to raw JSON. Stage guidance and orchestrator instructions drive execution.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {playbook.is_active ? (
            <Button asChild variant="outline">
              <Link to={`/config/playbooks/${playbook.id}/launch`}>Launch</Link>
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
          <CardTitle>Playbook Details</CardTitle>
          <p className="text-sm text-muted">
            Keep the playbook identity and operating model visible while you edit the structured
            authoring sections below.
          </p>
        </CardHeader>
        <CardContent className="grid gap-6">
          <ToggleCard
            label="Playbook Availability"
            description={
              isActive
                ? 'Active playbooks can launch new workflows from this family.'
                : 'Inactive playbooks cannot launch new workflows until you save and reactivate them.'
            }
            checked={isActive}
            checkedLabel="Active"
            uncheckedLabel="Inactive"
            onCheckedChange={(checked) => {
              setIsActive(checked);
              setIsDirty(true);
            }}
          />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr),minmax(0,1fr),minmax(0,0.9fr)]">
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Name</span>
              <Input value={name} onChange={(event) => { setName(event.target.value); setIsDirty(true); }} />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Slug</span>
              <Input value={slug} onChange={(event) => { setSlug(event.target.value); setIsDirty(true); }} />
            </label>
            <label className="grid gap-2 text-sm md:col-span-2">
              <span className="font-medium">Outcome</span>
              <Textarea
                value={outcome}
                onChange={(event) => { setOutcome(event.target.value); setIsDirty(true); }}
                className="min-h-[88px]"
              />
            </label>
            <div className="grid gap-2 text-sm xl:row-span-2">
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
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted xl:col-span-2">
              <div className="flex items-center gap-2">
                <span className="font-medium text-foreground">Created</span>
                <span>{formatDate(playbook.created_at)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-foreground">Updated</span>
                <span>{formatDate(playbook.updated_at)}</span>
              </div>
            </div>
            <div className="rounded-xl border border-border/70 bg-muted/15 p-4 text-sm text-muted md:col-span-2 xl:col-span-2">
              Shared prompts, role prompts, and runtime defaults are configured elsewhere. This
              page owns workflow structure, orchestration policy, specialist exceptions, and launch
              inputs only.
            </div>
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
        onValidationChange={setAuthoringValidationIssues}
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
              Delete this playbook revision only when it should be removed permanently from the
              library.
            </p>
            <p className="max-w-3xl text-sm leading-5 text-muted">
              Playbook deletion is destructive. Leave this closed unless you intentionally need to
              remove the revision.
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
            <div className="space-y-3">
              <p className="text-sm leading-6 text-muted">
                Delete this playbook revision only when it should be removed permanently from the
                library.
              </p>
              <Button
                variant="destructive"
                onClick={() => setDeleteOpen(true)}
                disabled={deleteMutation.isPending}
              >
                <Trash2 className="h-4 w-4" />
                Delete Revision
              </Button>
            </div>
          </CardContent>
        ) : null}
      </Card>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-h-[70vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Delete Playbook Revision</DialogTitle>
            <DialogDescription>
              Delete permanently removes this revision from the playbook library.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm text-muted">
            <p>
              Deleting <span className="font-medium text-foreground">{playbook.name}</span>{' '}
              version <span className="font-mono">v{playbook.version}</span> does not remove
              sibling revisions, but any workflows that already reference this revision will block
              deletion.
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => setDeleteOpen(false)}>
                Keep revision
              </Button>
              <Button
                variant="destructive"
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
              >
                Delete Revision
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return 'unknown time';
  }
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}
