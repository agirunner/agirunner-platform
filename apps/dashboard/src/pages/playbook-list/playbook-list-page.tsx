import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus } from 'lucide-react';

import { dashboardApi } from '../../lib/api.js';
import { toast } from '../../lib/toast.js';
import { DashboardPageHeader } from '../../components/layout/dashboard-page-header.js';
import { Button } from '../../components/ui/button.js';
import {
  DEFAULT_FORM_VALIDATION_MESSAGE,
  FormFeedbackMessage,
  resolveFormFeedbackMessage,
} from '../../components/forms/form-feedback.js';
import { DEFAULT_LIST_PAGE_SIZE, paginateListItems } from '../../lib/pagination/list-pagination.js';
import { Input } from '../../components/ui/input.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import {
  buildPlaybookDefinition,
  createDefaultAuthoringDraft,
  reconcileValidationIssues,
  type PlaybookAuthoringDraft,
} from '../playbook-authoring/playbook-authoring-support.js';
import { PlaybookAuthoringForm } from '../playbook-authoring/playbook-authoring-form.js';
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
  type PlaybookFamilyRecord,
  summarizePlaybookFamilyCounts,
  validatePlaybookCreateDraft,
  type PlaybookSortOption,
  type PlaybookLifecycleFilter,
  type PlaybookStatusFilter,
} from './playbook-list-page.support.js';
import { PlaybookLibrarySection } from './playbook-list-page.library.js';

const DEFAULT_LIFECYCLE = 'ongoing';

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
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_LIST_PAGE_SIZE);
  const [draft, setDraft] = useState<PlaybookAuthoringDraft>(() =>
    createDefaultAuthoringDraft(DEFAULT_LIFECYCLE),
  );
  const [authoringValidationIssues, setAuthoringValidationIssues] = useState<string[]>([]);
  const [definitionError, setDefinitionError] = useState<string | null>(null);
  const [hasAttemptedCreate, setHasAttemptedCreate] = useState(false);

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
      await navigate(`/design/playbooks/${playbook.id}`);
    },
    onError: (error) => {
      setDefinitionError(error instanceof Error ? error.message : 'Failed to create playbook');
    },
  });
  const toggleActiveMutation = useMutation({
    mutationFn: (family: PlaybookFamilyRecord) => {
      if (family.activeRevisionCount === 0) {
        return dashboardApi.restorePlaybook(family.primaryRevision.id);
      }
      return dashboardApi.archivePlaybook(family.primaryRevision.id);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['playbooks'] });
      toast.success('Updated playbook family active state.');
    },
    onError: (error) => {
      const message =
        error instanceof Error ? error.message : 'Failed to update playbook family active state.';
      toast.error(message);
    },
  });

  const allPlaybooks = playbooksQuery.data?.data ?? [];
  const playbookFamilies = useMemo(() => buildPlaybookFamilies(allPlaybooks), [allPlaybooks]);
  const filteredFamilies = useMemo(
    () => filterPlaybookFamilies(playbookFamilies, search, statusFilter, lifecycleFilter, sort),
    [lifecycleFilter, playbookFamilies, search, sort, statusFilter],
  );
  const pagination = useMemo(
    () => paginateListItems(filteredFamilies, page, pageSize),
    [filteredFamilies, page, pageSize],
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

  function resetForm() {
    setName('');
    setSlug('');
    setOutcome('');
    setLifecycle(DEFAULT_LIFECYCLE);
    setDraft(createDefaultAuthoringDraft(DEFAULT_LIFECYCLE));
    setAuthoringValidationIssues([]);
    setDefinitionError(null);
    setHasAttemptedCreate(false);
  }

  function handleLifecycleChange(next: 'planned' | 'ongoing') {
    setLifecycle(next);
    setDraft(createDefaultAuthoringDraft(next));
    setAuthoringValidationIssues([]);
    setDefinitionError(null);
  }

  const canCreate = !createMutation.isPending;
  const isCreateFormValid =
    createValidation.blockingIssues.length === 0 && authoringValidationIssues.length === 0;
  const createFormFeedbackMessage = resolveFormFeedbackMessage({
    serverError: definitionError,
    showValidation: hasAttemptedCreate,
    isValid: isCreateFormValid,
    validationMessage: DEFAULT_FORM_VALIDATION_MESSAGE,
  });

  function handleCreate(): void {
    if (!isCreateFormValid) {
      setHasAttemptedCreate(true);
      return;
    }
    createMutation.mutate();
  }

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
      <div data-testid="playbook-create-workspace" className="space-y-6 p-4 sm:p-6">
        <div className="space-y-4 rounded-3xl border border-border/70 bg-card/80 p-5 shadow-sm">
          <Button variant="ghost" className="w-fit px-0 text-muted" onClick={closeCreateWorkspace}>
            <ArrowLeft className="h-4 w-4" />
            Back to playbook library
          </Button>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
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
              <Button onClick={handleCreate} disabled={!canCreate}>
                Create Playbook
              </Button>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <Card className="border-border/70 bg-card/80 shadow-sm">
            <CardHeader className="space-y-2">
              <CardTitle>Playbook Basics</CardTitle>
              <p className="text-sm text-muted">
                Define the playbook identity first, then author the process, specialists, workflow
                goals, and required rules below.
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
                  {hasAttemptedCreate && createValidation.fieldErrors.name ? (
                    <p className="text-xs text-red-600 dark:text-red-400">
                      {createValidation.fieldErrors.name}
                    </p>
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
                  {hasAttemptedCreate && createValidation.fieldErrors.slug ? (
                    <p className="text-xs text-red-600 dark:text-red-400">
                      {createValidation.fieldErrors.slug}
                    </p>
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
                  {hasAttemptedCreate && createValidation.fieldErrors.outcome ? (
                    <p className="text-xs text-red-600 dark:text-red-400">
                      {createValidation.fieldErrors.outcome}
                    </p>
                  ) : null}
                </label>
                <label className="grid gap-2 text-sm md:max-w-xs">
                  <span className="font-medium">Lifecycle</span>
                  <Select
                    value={lifecycle}
                    onValueChange={(value) => handleLifecycleChange(value as 'planned' | 'ongoing')}
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
                showValidationErrors={hasAttemptedCreate}
                onChange={setDraft}
                onClearError={() => setDefinitionError(null)}
                onValidationChange={(nextIssues) =>
                  setAuthoringValidationIssues((currentIssues) =>
                    reconcileValidationIssues(currentIssues, nextIssues),
                  )
                }
              />
            </CardContent>
          </Card>
        </div>

        <div className="sticky bottom-4 z-10">
          <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-surface/95 p-4 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 flex-1">
              <FormFeedbackMessage message={createFormFeedbackMessage} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={closeCreateWorkspace}>
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={!canCreate}>
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
      <DashboardPageHeader
        navHref="/design/playbooks"
        description="Create and manage playbooks that define workflow guidance, team structure, and workflow goals."
        actions={
          <Button onClick={openCreateWorkspace}>
            <Plus className="h-4 w-4" />
            New Playbook
          </Button>
        }
      />

      <PlaybookLibrarySection
        search={search}
        statusFilter={statusFilter}
        lifecycleFilter={lifecycleFilter}
        sort={sort}
        familyCount={libraryCounts.familyCount}
        activeFamilyCount={libraryCounts.activeFamilyCount}
        archivedFamilyCount={libraryCounts.archivedFamilyCount}
        pagination={pagination}
        pageSize={pageSize}
        hasLoading={playbooksQuery.isLoading}
        hasError={Boolean(playbooksQuery.error)}
        families={filteredFamilies}
        onCreatePlaybook={openCreateWorkspace}
        togglingFamilySlug={
          toggleActiveMutation.isPending
            ? ((toggleActiveMutation.variables as PlaybookFamilyRecord | undefined)?.slug ?? null)
            : null
        }
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        onStatusFilterChange={(value) => {
          setStatusFilter(value);
          setPage(1);
        }}
        onLifecycleFilterChange={(value) => {
          setLifecycleFilter(value);
          setPage(1);
        }}
        onSortChange={(value) => {
          setSort(value);
          setPage(1);
        }}
        onPageChange={setPage}
        onPageSizeChange={(value) => {
          setPageSize(value);
          setPage(1);
        }}
        onToggleActive={(family) => toggleActiveMutation.mutate(family)}
      />
    </div>
  );
}
