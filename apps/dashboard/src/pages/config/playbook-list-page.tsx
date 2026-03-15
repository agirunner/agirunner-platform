import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus } from 'lucide-react';

import { dashboardApi } from '../../lib/api.js';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import { Badge } from '../../components/ui/badge.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
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
  buildPlaybookFamilies,
  filterPlaybookFamilies,
  summarizePlaybookFamilyCounts,
  validatePlaybookCreateDraft,
  type PlaybookSortOption,
  type PlaybookLifecycleFilter,
  type PlaybookStatusFilter,
} from './playbook-list-page.support.js';
import {
  PlaybookFamilyCard,
  PlaybookLibraryToolbar,
} from './playbook-list-page.library.js';

const DEFAULT_LIFECYCLE = 'ongoing';

function describePlaybookLifecycle(lifecycle: 'planned' | 'ongoing'): string {
  return lifecycle === 'planned' ? 'Planned' : 'Ongoing';
}

export function PlaybookListPage(): JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [createMode, setCreateMode] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [outcome, setOutcome] = useState('');
  const [lifecycle, setLifecycle] = useState<'planned' | 'ongoing'>(DEFAULT_LIFECYCLE);
  const [statusFilter, setStatusFilter] = useState<PlaybookStatusFilter>('all');
  const [lifecycleFilter, setLifecycleFilter] = useState<PlaybookLifecycleFilter>('all');
  const [sort, setSort] = useState<PlaybookSortOption>('updated-desc');
  const [draft, setDraft] = useState<PlaybookAuthoringDraft>(() =>
    createDefaultAuthoringDraft(DEFAULT_LIFECYCLE),
  );
  const [authoringValidationIssues, setAuthoringValidationIssues] = useState<string[]>([]);
  const [definitionError, setDefinitionError] = useState<string | null>(null);

  const playbooksQuery = useQuery({
    queryKey: ['playbooks'],
    queryFn: () => dashboardApi.listPlaybooks(),
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const authoringIssue = authoringValidationIssues[0];
      if (authoringIssue) {
        throw new Error(authoringIssue);
      }
      const definition = buildPlaybookDefinition(lifecycle, draft);
      if (definition.ok === false) {
        throw new Error(definition.error);
      }
      return dashboardApi.createPlaybook({
        name: name.trim(),
        slug: slug.trim() || undefined,
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

  const allPlaybooks = playbooksQuery.data?.data ?? [];
  const playbookFamilies = useMemo(() => buildPlaybookFamilies(allPlaybooks), [allPlaybooks]);
  const filteredFamilies = useMemo(
    () =>
      filterPlaybookFamilies(playbookFamilies, search, statusFilter, lifecycleFilter, sort),
    [lifecycleFilter, playbookFamilies, search, sort, statusFilter],
  );
  const libraryCounts = useMemo(
    () => summarizePlaybookFamilyCounts(playbookFamilies),
    [playbookFamilies],
  );
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
  const createReadinessIssues = useMemo(
    () => Array.from(new Set([...createValidation.blockingIssues, ...authoringValidationIssues])),
    [authoringValidationIssues, createValidation.blockingIssues],
  );

  function resetForm() {
    setName('');
    setSlug('');
    setOutcome('');
    setLifecycle(DEFAULT_LIFECYCLE);
    setDraft(createDefaultAuthoringDraft(DEFAULT_LIFECYCLE));
    setAuthoringValidationIssues([]);
    setDefinitionError(null);
  }

  function handleLifecycleChange(next: 'planned' | 'ongoing') {
    setLifecycle(next);
    setDraft(createDefaultAuthoringDraft(next));
    setAuthoringValidationIssues([]);
    setDefinitionError(null);
  }

  const summary = summarizePlaybookAuthoringDraft(draft);
  const canCreate = createReadinessIssues.length === 0 && !createMutation.isPending;

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
        className="mx-auto max-w-[88rem] space-y-6 px-4 py-6 sm:px-6 lg:px-8"
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
                  Start with the outcome, process instructions, team roles, and required workflow
                  rules, then open advanced overrides only when this playbook truly needs them.
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
                Define the playbook identity first, then author the process, team, required rules,
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
                    <p className="text-xs text-red-600 dark:text-red-400">{createValidation.fieldErrors.name}</p>
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
                    <p className="text-xs text-red-600 dark:text-red-400">{createValidation.fieldErrors.slug}</p>
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
                    <p className="text-xs text-red-600 dark:text-red-400">{createValidation.fieldErrors.outcome}</p>
                  ) : null}
                </label>
                <label className="grid gap-2 text-sm md:max-w-xs">
                  <span className="font-medium">Lifecycle</span>
                  <Select
                    value={lifecycle}
                    onValueChange={(value) =>
                      handleLifecycleChange(value as 'planned' | 'ongoing')
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ongoing">Ongoing</SelectItem>
                      <SelectItem value="planned">Planned</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
              </div>

              <PlaybookAuthoringForm
                draft={draft}
                onChange={setDraft}
                onClearError={() => setDefinitionError(null)}
                onValidationChange={setAuthoringValidationIssues}
              />

              {definitionError ? <p className="text-sm text-red-600 dark:text-red-400">{definitionError}</p> : null}
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
                {createReadinessIssues.length > 0 ? (
                  <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
                    <div className="font-medium">Resolve these blockers before creating the playbook.</div>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      {createReadinessIssues.map((issue) => (
                        <li key={issue}>{issue}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">
                    Playbook basics are ready. Continue shaping the process, rules, and launch
                    inputs below.
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
                <ReadinessRow label="Lifecycle" value={describePlaybookLifecycle(lifecycle)} ready />
                <ReadinessRow
                  label="Workflow rules"
                  value={`${summary.roleCount} roles • ${summary.checkpointCount} checkpoints`}
                  ready={summary.hasProcessInstructions && summary.roleCount > 0}
                />
                <ReadinessRow
                  label="Launch inputs"
                  value={`${summary.parameterCount} inputs • ${summary.secretParameterCount} secret`}
                  ready={authoringValidationIssues.length === 0}
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
                  <div className="font-medium text-foreground">Process</div>
                  Process instructions, team roles, checkpoints, and mandatory workflow rules.
                </div>
                <div>
                  <div className="font-medium text-foreground">Inputs</div>
                  Launch parameters and project-linked workflow inputs.
                </div>
                <div>
                  <div className="font-medium text-foreground">Advanced</div>
                  Board overrides, specialist runtime posture, and orchestration limits.
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
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Playbooks</h1>
          <p className="text-sm text-muted">
            Define reusable orchestrated workflow operating models and manage them from a single
            full-width library.
          </p>
        </div>
        <Button onClick={openCreateWorkspace}>
          <Plus className="h-4 w-4" />
          New Playbook
        </Button>
      </div>

      <PlaybookLibraryToolbar
        search={search}
        statusFilter={statusFilter}
        lifecycleFilter={lifecycleFilter}
        sort={sort}
        familyCount={libraryCounts.familyCount}
        activeFamilyCount={libraryCounts.activeFamilyCount}
        archivedFamilyCount={libraryCounts.archivedFamilyCount}
        onSearchChange={setSearch}
        onStatusFilterChange={setStatusFilter}
        onLifecycleFilterChange={setLifecycleFilter}
        onSortChange={setSort}
      />

      {playbooksQuery.isLoading ? <p className="text-sm text-muted">Loading playbooks...</p> : null}
      {playbooksQuery.error ? (
        <p className="text-sm text-red-600 dark:text-red-400">Failed to load playbooks.</p>
      ) : null}

      <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filteredFamilies.map((family) => {
          return (
            <PlaybookFamilyCard key={family.slug} family={family} />
          );
        })}
        {!playbooksQuery.isLoading && filteredFamilies.length === 0 ? (
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
