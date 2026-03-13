import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus } from 'lucide-react';

import { dashboardApi, type DashboardPlaybookRecord } from '../../lib/api.js';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import { Badge } from '../../components/ui/badge.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Textarea } from '../../components/ui/textarea.js';
import {
  buildPlaybookDefinition,
  createDefaultAuthoringDraft,
  summarizePlaybookAuthoringDraft,
  type PlaybookAuthoringDraft,
} from './playbook-authoring-support.js';
import { PlaybookAuthoringForm } from './playbook-authoring-form.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import {
  filterPlaybooks,
  summarizePlaybookLibrary,
  validatePlaybookCreateDraft,
  type PlaybookLifecycleFilter,
  type PlaybookStatusFilter,
} from './playbook-list-page.support.js';
import {
  PlaybookCard,
  PlaybookLibraryFilters,
  PlaybookLibrarySummaryCards,
} from './playbook-list-page.library.js';

const DEFAULT_LIFECYCLE = 'continuous';

export function PlaybookListPage(): JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [createMode, setCreateMode] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [outcome, setOutcome] = useState('');
  const [lifecycle, setLifecycle] = useState<'standard' | 'continuous'>(DEFAULT_LIFECYCLE);
  const [statusFilter, setStatusFilter] = useState<PlaybookStatusFilter>('all');
  const [lifecycleFilter, setLifecycleFilter] = useState<PlaybookLifecycleFilter>('all');
  const [draft, setDraft] = useState<PlaybookAuthoringDraft>(() =>
    createDefaultAuthoringDraft(DEFAULT_LIFECYCLE),
  );
  const [definitionError, setDefinitionError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const playbooksQuery = useQuery({
    queryKey: ['playbooks'],
    queryFn: () => dashboardApi.listPlaybooks(),
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const definition = buildPlaybookDefinition(lifecycle, draft);
      if (definition.ok === false) {
        throw new Error(definition.error);
      }
      return dashboardApi.createPlaybook({
        name: name.trim(),
        slug: slug.trim() || undefined,
        description: description.trim() || undefined,
        outcome: outcome.trim(),
        lifecycle,
        definition: definition.value,
      });
    },
    onSuccess: async (playbook) => {
      await queryClient.invalidateQueries({ queryKey: ['playbooks'] });
      resetForm();
      setCreateMode(false);
      await navigate(`/config/playbooks/${playbook.id}`);
    },
    onError: (error) => {
      setDefinitionError(error instanceof Error ? error.message : 'Failed to create playbook');
    },
  });

  const archiveMutation = useMutation({
    mutationFn: ({ playbookId, archived }: { playbookId: string; archived: boolean }) =>
      archived
        ? dashboardApi.archivePlaybook(playbookId)
        : dashboardApi.restorePlaybook(playbookId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['playbooks'] });
      setConfirmDeleteId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (playbookId: string) => dashboardApi.deletePlaybook(playbookId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['playbooks'] });
      setConfirmDeleteId(null);
    },
  });

  const allPlaybooks = playbooksQuery.data?.data ?? [];
  const filtered = useMemo(
    () => filterPlaybooks(allPlaybooks, search, statusFilter, lifecycleFilter),
    [allPlaybooks, search, statusFilter, lifecycleFilter],
  );
  const summaryCards = useMemo(() => summarizePlaybookLibrary(allPlaybooks), [allPlaybooks]);
  const createValidation = useMemo(
    () =>
      validatePlaybookCreateDraft({
        name,
        slug,
        outcome,
        playbooks: allPlaybooks,
      }),
    [name, slug, outcome, allPlaybooks],
  );

  function resetForm() {
    setName('');
    setSlug('');
    setDescription('');
    setOutcome('');
    setLifecycle(DEFAULT_LIFECYCLE);
    setDraft(createDefaultAuthoringDraft(DEFAULT_LIFECYCLE));
    setDefinitionError(null);
  }

  function handleLifecycleChange(next: 'standard' | 'continuous') {
    setLifecycle(next);
    setDraft(createDefaultAuthoringDraft(next));
    setDefinitionError(null);
  }

  const summary = summarizePlaybookAuthoringDraft(draft);
  const canCreate = createValidation.isValid && !createMutation.isPending;

  function openCreateWorkspace() {
    resetForm();
    setCreateMode(true);
  }

  function closeCreateWorkspace() {
    resetForm();
    setCreateMode(false);
  }

  if (createMode) {
    return (
      <div
        data-testid="playbook-create-workspace"
        className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8"
      >
        <div className="space-y-4 rounded-3xl border border-border/70 bg-card/80 p-5 shadow-sm">
          <Button variant="ghost" className="w-fit px-0 text-muted" onClick={closeCreateWorkspace}>
            <ArrowLeft className="h-4 w-4" />
            Back to playbook library
          </Button>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">Full-page authoring workspace</Badge>
                <Badge variant="outline">Structured controls only</Badge>
                <Badge variant="outline">Pinned create actions</Badge>
              </div>
              <div>
                <h1 className="text-2xl font-semibold">Create Playbook</h1>
                <p className="text-sm text-muted">
                  Define the workflow operating model in a dedicated workspace instead of a modal,
                  with progressive disclosure for flow design, automation policy, and launch/runtime
                  controls.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={closeCreateWorkspace}>
                Cancel
              </Button>
              <Button onClick={() => createMutation.mutate()} disabled={!canCreate}>
                Create Playbook
              </Button>
            </div>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr),22rem]">
          <Card className="border-border/70 bg-card/80 shadow-sm">
            <CardHeader className="space-y-2">
              <CardTitle>Playbook Basics</CardTitle>
              <p className="text-sm text-muted">
                Start with the identity and expected outcome, then shape the board, stages, runtime,
                and launch inputs below.
              </p>
            </CardHeader>
            <CardContent className="grid gap-6">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-2 text-sm">
                  <span className="font-medium">Name</span>
                  <Input
                    value={name}
                    onChange={(event) => {
                      setName(event.target.value);
                      setDefinitionError(null);
                    }}
                  />
                  {createValidation.fieldErrors.name ? (
                    <p className="text-xs text-red-600">{createValidation.fieldErrors.name}</p>
                  ) : null}
                </label>
                <label className="grid gap-2 text-sm">
                  <span className="font-medium">Slug</span>
                  <Input
                    value={slug}
                    onChange={(event) => {
                      setSlug(event.target.value);
                      setDefinitionError(null);
                    }}
                    placeholder="optional"
                  />
                  <p className="text-xs text-muted">
                    {createValidation.normalizedSlug
                      ? `Slug preview: ${createValidation.normalizedSlug} (${createValidation.slugSource === 'custom' ? 'custom' : 'derived from name'})`
                      : 'Slug will be generated from the name once it contains letters or numbers.'}
                  </p>
                  {createValidation.fieldErrors.slug ? (
                    <p className="text-xs text-red-600">{createValidation.fieldErrors.slug}</p>
                  ) : null}
                </label>
                <label className="grid gap-2 text-sm md:col-span-2">
                  <span className="font-medium">Outcome</span>
                  <Input
                    value={outcome}
                    onChange={(event) => {
                      setOutcome(event.target.value);
                      setDefinitionError(null);
                    }}
                  />
                  {createValidation.fieldErrors.outcome ? (
                    <p className="text-xs text-red-600">{createValidation.fieldErrors.outcome}</p>
                  ) : null}
                </label>
                <label className="grid gap-2 text-sm md:col-span-2">
                  <span className="font-medium">Description</span>
                  <Textarea
                    value={description}
                    onChange={(event) => {
                      setDescription(event.target.value);
                      setDefinitionError(null);
                    }}
                    className="min-h-[96px]"
                  />
                </label>
                <label className="grid gap-2 text-sm md:max-w-xs">
                  <span className="font-medium">Lifecycle</span>
                  <Select
                    value={lifecycle}
                    onValueChange={(value) =>
                      handleLifecycleChange(value as 'standard' | 'continuous')
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="continuous">Continuous</SelectItem>
                      <SelectItem value="standard">Standard</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
              </div>

              <PlaybookAuthoringForm
                draft={draft}
                onChange={setDraft}
                onClearError={() => setDefinitionError(null)}
              />

              {definitionError ? <p className="text-sm text-red-600">{definitionError}</p> : null}
            </CardContent>
          </Card>

          <div className="space-y-4 xl:sticky xl:top-6">
            <Card className="border-border/70 bg-card/80 shadow-sm">
              <CardHeader className="space-y-1">
                <CardTitle className="text-base">Creation Readiness</CardTitle>
                <p className="text-sm text-muted">
                  Keep the critical setup visible while you author.
                </p>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm">
                {createValidation.blockingIssues.length > 0 ? (
                  <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
                    <div className="font-medium">Resolve these blockers before creating the playbook.</div>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      {createValidation.blockingIssues.map((issue) => (
                        <li key={issue}>{issue}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">
                    Playbook basics are ready. Continue shaping the board, stages, runtime, and launch posture below.
                  </div>
                )}
                <ReadinessRow
                  label="Identity"
                  value={name.trim() ? name.trim() : 'Add a playbook name'}
                  ready={!createValidation.fieldErrors.name}
                />
                <ReadinessRow
                  label="Outcome"
                  value={outcome.trim() ? outcome.trim() : 'Describe the expected result'}
                  ready={!createValidation.fieldErrors.outcome}
                />
                <ReadinessRow
                  label="Slug"
                  value={createValidation.normalizedSlug || 'Generated from the playbook name'}
                  ready={!createValidation.fieldErrors.slug}
                />
                <ReadinessRow label="Lifecycle" value={lifecycle} ready />
                <ReadinessRow
                  label="Flow design"
                  value={`${summary.columnCount} columns • ${summary.stageCount} stages`}
                  ready={summary.columnCount > 0 && summary.stageCount > 0}
                />
                <ReadinessRow
                  label="Launch inputs"
                  value={`${summary.parameterCount} parameters • ${summary.secretParameterCount} secret`}
                  ready
                />
              </CardContent>
            </Card>

            <Card className="border-border/70 bg-card/80 shadow-sm">
              <CardHeader className="space-y-1">
                <CardTitle className="text-base">Workspace Guide</CardTitle>
                <p className="text-sm text-muted">
                  The authoring form is split so operators can focus on one decision set at a time.
                </p>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm text-muted">
                <div>
                  <div className="font-medium text-foreground">Flow Design</div>
                  Team roles, board columns, and stage handoffs.
                </div>
                <div>
                  <div className="font-medium text-foreground">Automation Policy</div>
                  Orchestrator instructions, cadence, and concurrency posture.
                </div>
                <div>
                  <div className="font-medium text-foreground">Launch and Runtime</div>
                  Runtime pools and typed launch parameters.
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="sticky bottom-4 z-10">
          <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-surface/95 p-4 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="text-sm font-medium">Ready to create</div>
              <p className="text-sm text-muted">
                The action bar stays visible while you scroll through the workspace.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={closeCreateWorkspace}>
                Cancel
              </Button>
              <Button onClick={() => createMutation.mutate()} disabled={!canCreate}>
                Create Playbook
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Playbooks</h1>
          <p className="text-sm text-muted">
            Define reusable orchestrated workflow operating models, archive retired revisions, and
            delete unused playbook records without leaving the supported management path.
          </p>
        </div>
        <Button onClick={openCreateWorkspace}>
          <Plus className="h-4 w-4" />
          New Playbook
        </Button>
      </div>

      <PlaybookLibrarySummaryCards cards={summaryCards} />
      <PlaybookLibraryFilters
        search={search}
        statusFilter={statusFilter}
        lifecycleFilter={lifecycleFilter}
        onSearchChange={setSearch}
        onStatusFilterChange={setStatusFilter}
        onLifecycleFilterChange={setLifecycleFilter}
      />

      {playbooksQuery.isLoading ? <p className="text-sm text-muted">Loading playbooks...</p> : null}
      {playbooksQuery.error ? (
        <p className="text-sm text-red-600">Failed to load playbooks.</p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((playbook) => (
          <PlaybookCard
            key={playbook.id}
            playbook={playbook}
            confirmDelete={confirmDeleteId === playbook.id}
            isArchiving={
              archiveMutation.isPending && archiveMutation.variables?.playbookId === playbook.id
            }
            isDeleting={deleteMutation.isPending && deleteMutation.variables === playbook.id}
            onArchiveChange={(archived) =>
              archiveMutation.mutate({ playbookId: playbook.id, archived })
            }
            onDelete={() => deleteMutation.mutate(playbook.id)}
            onRequestDelete={() =>
              setConfirmDeleteId((current) => (current === playbook.id ? null : playbook.id))
            }
          />
        ))}
        {!playbooksQuery.isLoading && filtered.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted">
              No playbooks match the current search.
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function ReadinessRow(props: { label: string; value: string; ready: boolean }): JSX.Element {
  return (
    <div className="rounded-xl border border-border/70 bg-muted/10 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-sm font-medium">{props.label}</div>
        <Badge variant={props.ready ? 'secondary' : 'destructive'}>
          {props.ready ? 'Ready' : 'Needs input'}
        </Badge>
      </div>
      <div className="text-sm text-muted">{props.value}</div>
    </div>
  );
}
