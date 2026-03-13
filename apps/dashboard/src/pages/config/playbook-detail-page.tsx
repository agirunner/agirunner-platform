import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Archive, RotateCcw, Save, Trash2 } from 'lucide-react';

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
import { Textarea } from '../../components/ui/textarea.js';
import {
  buildPlaybookDefinition,
  hydratePlaybookAuthoringDraft,
  type PlaybookAuthoringDraft,
} from './playbook-authoring-support.js';
import { PlaybookAuthoringForm } from './playbook-authoring-form.js';
import {
  buildPlaybookRestorePayload,
  buildPlaybookRevisionChain,
  buildPlaybookRevisionDiff,
} from './playbook-detail-support.js';
import {
  PlaybookControlCenterCard,
  PlaybookEditOutlineCard,
  PlaybookEditingActionRailCard,
  PlaybookRevisionHistoryCard,
} from './playbook-detail-sections.js';

const DEFAULT_LIFECYCLE = 'continuous';
const lifecycleOptions = [
  {
    value: 'continuous',
    label: 'Continuous',
    description: 'Work items can run across multiple active stages with playbook-level parallelism.',
  },
  {
    value: 'standard',
    label: 'Standard',
    description: 'One structured stage path with tighter milestone progression.',
  },
] as const;

export function PlaybookDetailPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const playbookId = params.id ?? '';
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [outcome, setOutcome] = useState('');
  const [lifecycle, setLifecycle] = useState<'standard' | 'continuous'>(DEFAULT_LIFECYCLE);
  const [draft, setDraft] = useState<PlaybookAuthoringDraft>(() =>
    hydratePlaybookAuthoringDraft(DEFAULT_LIFECYCLE, {}),
  );
  const [authoringValidationIssues, setAuthoringValidationIssues] = useState<string[]>([]);
  const [definitionError, setDefinitionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loadedPlaybookId, setLoadedPlaybookId] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const playbookQuery = useQuery({
    queryKey: ['playbook', playbookId],
    queryFn: () => dashboardApi.getPlaybook(playbookId),
    enabled: playbookId.length > 0,
  });
  const playbooksQuery = useQuery({
    queryKey: ['playbooks'],
    queryFn: () => dashboardApi.listPlaybooks(),
  });
  const roleDefinitionsQuery = useQuery({
    queryKey: ['role-definitions', 'active'],
    queryFn: () => dashboardApi.listRoleDefinitions(),
  });
  const llmProvidersQuery = useQuery({
    queryKey: ['llm-providers'],
    queryFn: () => dashboardApi.listLlmProviders(),
  });
  const llmModelsQuery = useQuery({
    queryKey: ['llm-models'],
    queryFn: () => dashboardApi.listLlmModels(),
  });
  const [comparedRevisionId, setComparedRevisionId] = useState('');

  useUnsavedChanges(isDirty);

  function loadPlaybook(playbook: NonNullable<typeof playbookQuery.data>): void {
    const nextLifecycle = playbook.lifecycle ?? DEFAULT_LIFECYCLE;
    setName(playbook.name);
    setSlug(playbook.slug);
    setDescription(playbook.description ?? '');
    setOutcome(playbook.outcome);
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
      return dashboardApi.updatePlaybook(playbookId, {
        name: name.trim(),
        slug: slug.trim() || undefined,
        description: description.trim() || undefined,
        outcome: outcome.trim(),
        lifecycle,
        definition: definition.value,
      });
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
  const restoreMutation = useMutation({
    mutationFn: async () => {
      if (!comparedRevision) {
        throw new Error('Choose a revision to restore.');
      }
      if (comparedRevision.id === playbookId) {
        throw new Error('Select an older version before restoring.');
      }
      return dashboardApi.updatePlaybook(playbookId, buildPlaybookRestorePayload(comparedRevision));
    },
    onSuccess: (playbook) => {
      loadPlaybook(playbook);
      setDefinitionError(null);
      setMessage(`Restored v${playbook.version} from an earlier revision.`);
      void playbooksQuery.refetch();
      void navigate(`/config/playbooks/${playbook.id}`, { replace: true });
    },
    onError: (error) => {
      setMessage(null);
      setDefinitionError(
        error instanceof Error ? error.message : 'Failed to restore playbook revision.',
      );
    },
  });
  const archiveStateMutation = useMutation({
    mutationFn: (archived: boolean) =>
      archived
        ? dashboardApi.archivePlaybook(playbookId)
        : dashboardApi.restorePlaybook(playbookId),
    onSuccess: async (nextPlaybook) => {
      loadPlaybook(nextPlaybook);
      setArchiveOpen(false);
      setDeleteOpen(false);
      setDefinitionError(null);
      setMessage(
        nextPlaybook.is_active
          ? `Playbook restored as the active revision for ${nextPlaybook.slug}.`
          : 'Playbook archived. Launch is disabled until this revision is restored or superseded.',
      );
      await queryClient.invalidateQueries({ queryKey: ['playbook', playbookId] });
      await queryClient.invalidateQueries({ queryKey: ['playbooks'] });
    },
    onError: (error) => {
      setMessage(null);
      setDefinitionError(
        error instanceof Error ? error.message : 'Failed to change playbook archive state.',
      );
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
  const summaryCards = [
    {
      label: 'Launch posture',
      value: playbook.is_active ? 'Ready to launch' : 'Archived',
      detail: playbook.is_active
        ? 'This revision can launch workflows immediately.'
        : 'Restore or create a newer active revision before launch.',
      tone: playbook.is_active ? 'border-emerald-300 bg-emerald-50/80 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200' : 'border-amber-300 bg-amber-50/80 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200',
    },
    {
      label: 'Lifecycle',
      value: lifecycle === 'continuous' ? 'Continuous orchestration' : 'Standard progression',
      detail:
        lifecycle === 'continuous'
          ? 'Multiple work items may stay active across stages.'
          : 'A tighter single-stage progression stays in focus.',
      tone: 'border-border/70 bg-muted/15 text-foreground',
    },
    {
      label: 'Revision status',
      value: `v${playbook.version}`,
      detail: comparedRevision ? `Comparing against v${comparedRevision.version}` : 'Latest revision loaded.',
      tone: 'border-border/70 bg-muted/15 text-foreground',
    },
    {
      label: 'Last updated',
      value: formatDate(playbook.updated_at ?? playbook.created_at),
      detail: `Created ${formatDate(playbook.created_at)}.`,
      tone: 'border-border/70 bg-muted/15 text-foreground',
    },
  ];
  const editOutlineLinks = [
    {
      href: '#playbook-identity',
      title: 'Identity and lifecycle',
      description: 'Name, slug, outcome, description, and lifecycle posture.',
    },
    {
      href: '#playbook-team-roles',
      title: 'Team roles',
      description: 'Specialist lineup, ownership, and role coverage.',
    },
    {
      href: '#playbook-workflow-stages',
      title: 'Workflow stages',
      description: 'Stage order, human gates, and stage-specific guidance.',
    },
    {
      href: '#playbook-orchestrator-controls',
      title: 'Automation policy',
      description: 'Cadence, retries, recovery, and parallelism controls.',
    },
    {
      href: '#playbook-runtime-controls',
      title: 'Runtime pools',
      description: 'Pool overrides, execution posture, and runtime inheritance.',
    },
    {
      href: '#playbook-parameters',
      title: 'Launch parameters',
      description: 'Operator-provided inputs and runtime configuration at launch.',
    },
    {
      href: '#playbook-control-center',
      title: 'Control center',
      description: 'Linked orchestrator, role, model, and runtime control surfaces.',
    },
    {
      href: '#playbook-revision-history',
      title: 'Revision history',
      description: 'Compare revisions and restore an older structure safely.',
    },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="grid gap-4 xl:grid-cols-[1.15fr,0.85fr]">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{playbook.name}</h1>
            <Badge variant="outline">v{playbook.version}</Badge>
            <Badge variant="secondary">{playbook.lifecycle}</Badge>
            {!playbook.is_active ? <Badge variant="destructive">Archived</Badge> : null}
          </div>
          <div className="space-y-2">
            <p className="text-sm text-muted">
              Edit playbook structure, runtime posture, and launch-time parameter definitions
              without dropping to raw JSON.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {summaryCards.map((card) => (
                <div
                  key={card.label}
                  className={`rounded-2xl border p-4 ${card.tone}`}
                >
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] opacity-80">
                    {card.label}
                  </div>
                  <div className="mt-2 text-base font-semibold">{card.value}</div>
                  <p className="mt-1 text-sm opacity-90">{card.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
        <aside className="space-y-4 self-start xl:sticky xl:top-6">
          <PlaybookEditingActionRailCard
            playbookId={playbook.id}
            isActive={Boolean(playbook.is_active)}
            canSave={Boolean(canSave)}
            isSaving={Boolean(updateMutation.isPending)}
            isArchiving={Boolean(archiveStateMutation.isPending)}
            isDeleting={Boolean(deleteMutation.isPending)}
            onArchive={() => setArchiveOpen(true)}
            onRestore={() => archiveStateMutation.mutate(false)}
            onSave={() => updateMutation.mutate()}
            onDelete={() => setDeleteOpen(true)}
          />
          <PlaybookEditOutlineCard links={editOutlineLinks} />
        </aside>
      </div>

      <Card id="playbook-identity">
        <CardHeader className="space-y-2">
          <CardTitle>Playbook Details</CardTitle>
          <p className="text-sm text-muted">
            Keep the playbook identity and operating model visible while you edit the structured
            authoring sections below.
          </p>
        </CardHeader>
        <CardContent className="grid gap-6 xl:grid-cols-[1.2fr,0.8fr]">
          <div className="grid gap-4 md:grid-cols-2">
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
              <Input value={outcome} onChange={(event) => { setOutcome(event.target.value); setIsDirty(true); }} />
            </label>
            <label className="grid gap-2 text-sm md:col-span-2">
              <span className="font-medium">Description</span>
              <Textarea
                value={description}
                onChange={(event) => { setDescription(event.target.value); setIsDirty(true); }}
                className="min-h-[96px]"
              />
            </label>
          </div>

          <div className="space-y-4">
            <div className="grid gap-2 text-sm">
              <span className="font-medium">Lifecycle</span>
              <div
                aria-label="Playbook lifecycle"
                className="grid gap-2 sm:grid-cols-2"
                role="group"
              >
                {lifecycleOptions.map((option) => {
                  const selected = lifecycle === option.value;
                  return (
                    <Button
                      key={option.value}
                      type="button"
                      variant={selected ? 'secondary' : 'outline'}
                      className="h-auto w-full items-start justify-start whitespace-normal px-4 py-3 text-left"
                      onClick={() => { setLifecycle(option.value); setIsDirty(true); }}
                    >
                      <span className="block">
                        <span className="block font-medium">{option.label}</span>
                        <span className="mt-1 block text-xs text-muted">
                          {option.description}
                        </span>
                      </span>
                    </Button>
                  );
                })}
              </div>
            </div>
            <div className="grid gap-2 text-sm">
              <span className="font-medium">Configuration model</span>
              <div className="rounded-xl border border-border/70 bg-muted/15 p-4 text-sm text-muted">
                Configure playbook-specific cadence, runtime pools, concurrency, and workflow
                structure below. Shared prompts, model preferences, and escalation policy for
                specialist or orchestrator roles live on the Roles &amp; Orchestrator page.
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-border/70 bg-muted/15 p-4 text-sm text-muted">
                <div className="font-medium text-foreground">Created</div>
                <div className="mt-1">{formatDate(playbook.created_at)}</div>
              </div>
              <div className="rounded-xl border border-border/70 bg-muted/15 p-4 text-sm text-muted">
                <div className="font-medium text-foreground">Updated</div>
                <div className="mt-1">{formatDate(playbook.updated_at)}</div>
              </div>
            </div>
            {!playbook.is_active ? (
              <div className="grid gap-2 text-sm">
                <span className="font-medium">Archive state</span>
                <div className="rounded-xl border border-amber-300 bg-amber-50/80 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                  This playbook is archived. Revision history remains available, but launch is
                  disabled until a new active revision is created.
                </div>
              </div>
            ) : null}
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
      {definitionError ? (
        <div className="rounded-xl border border-red-300 bg-red-50/80 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
          {definitionError}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50/80 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
          {message}
        </div>
      ) : null}

      <PlaybookControlCenterCard
        playbook={playbook}
        activeRoleCount={(roleDefinitionsQuery.data ?? []).filter((role) => role.is_active).length}
        llmProviders={llmProvidersQuery.data ?? []}
        llmModels={llmModelsQuery.data ?? []}
      />

      <PlaybookRevisionHistoryCard
        currentPlaybook={playbook}
        revisions={revisions.length > 0 ? revisions : [playbook]}
        comparedRevisionId={comparedRevisionId || playbook.id}
        diffRows={revisionDiff}
        onComparedRevisionChange={setComparedRevisionId}
        onRestore={() => restoreMutation.mutate()}
        isRestoring={restoreMutation.isPending}
      />

      <div className="sticky bottom-4 z-10 xl:hidden">
        <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-surface/95 p-4 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="text-sm font-medium">Save changes from anywhere in the editor</div>
            <p className="text-sm text-muted">
              The action bar stays visible while you review the control center, revisions, and
              longer authoring sections.
            </p>
          </div>
          <div className="grid gap-2 sm:flex sm:flex-wrap">
            <Button asChild variant="outline" className="w-full justify-between sm:w-auto">
              <Link to="/config/roles">Manage Roles</Link>
            </Button>
            {playbook.is_active ? (
              <Button asChild variant="outline" className="w-full justify-between sm:w-auto">
                <Link to={`/config/playbooks/${playbook.id}/launch`}>Launch</Link>
              </Button>
            ) : null}
            {playbook.is_active ? (
              <Button
                variant="destructive"
                className="w-full justify-between sm:w-auto"
                onClick={() => setArchiveOpen(true)}
              >
                <Archive className="h-4 w-4" />
                Archive
              </Button>
            ) : (
              <Button
                variant="outline"
                className="w-full justify-between sm:w-auto"
                onClick={() => archiveStateMutation.mutate(false)}
                disabled={archiveStateMutation.isPending}
              >
                <RotateCcw className="h-4 w-4" />
                Restore
              </Button>
            )}
            <Button
              className="w-full justify-between sm:w-auto"
              disabled={!canSave || updateMutation.isPending}
              onClick={() => updateMutation.mutate()}
            >
              <Save className="h-4 w-4" />
              Save Playbook
            </Button>
            <Button
              variant="outline"
              className="w-full justify-between sm:w-auto"
              onClick={() => setDeleteOpen(true)}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <DialogContent className="max-h-[70vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Archive Playbook</DialogTitle>
            <DialogDescription>
              Archive disables launch for this playbook family while keeping every revision
              available for audit and restore flows.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm text-muted">
            <p>
              Archiving <span className="font-medium text-foreground">{playbook.name}</span> marks
              the active revisions on slug <span className="font-mono">{playbook.slug}</span> as
              archived. Existing workflow history is preserved.
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => setArchiveOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => archiveStateMutation.mutate(true)}
                disabled={archiveStateMutation.isPending}
              >
                Archive Playbook
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
