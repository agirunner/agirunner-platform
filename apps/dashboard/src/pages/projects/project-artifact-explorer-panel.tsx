import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';

import {
  MAX_INLINE_ARTIFACT_PREVIEW_BYTES,
  buildArtifactPermalink,
  describeArtifactPreview,
} from '../../components/artifact-preview-support.js';
import {
  buildProjectArtifactBrowserPath,
  DEFAULT_PROJECT_ARTIFACT_ROUTE_STATE,
  type ProjectArtifactRouteState,
} from '../../lib/artifact-navigation.js';
import { dashboardApi } from '../../lib/api.js';
import { toast } from '../../lib/toast.js';
import { cn } from '../../lib/utils.js';
import {
  ProjectArtifactBulkActionBar,
  ProjectArtifactFilterCard,
} from './project-artifact-explorer-controls.js';
import {
  buildProjectArtifactScopeChips,
  describeProjectArtifactNextAction,
} from './project-artifact-explorer-adaptive-support.js';
import { ProjectArtifactExplorerAdaptiveLayout } from './project-artifact-explorer-layout.js';
import {
  normalizeProjectArtifactEntries,
  normalizeProjectArtifactSummary,
  type ProjectArtifactPreviewMode,
  type ProjectArtifactSort,
} from './project-artifact-explorer-support.js';
import { ProjectArtifactExplorerSkeleton } from './project-artifact-explorer-presentation.js';
import { ProjectArtifactExplorerShell } from './project-artifact-explorer-shell.js';

const PROJECT_ARTIFACT_PAGE_SIZE = 50;

export function ProjectArtifactExplorerPanel(props: {
  projectId: string;
  showHeader?: boolean;
  initialRouteState?: ProjectArtifactRouteState;
}): JSX.Element {
  const initialRouteState = props.initialRouteState ?? DEFAULT_PROJECT_ARTIFACT_ROUTE_STATE;
  const [query, setQuery] = useState(initialRouteState.query);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState(initialRouteState.workflowId);
  const [selectedWorkItemId, setSelectedWorkItemId] = useState(initialRouteState.workItemId);
  const [selectedTaskId, setSelectedTaskId] = useState(initialRouteState.taskId);
  const [selectedStageName, setSelectedStageName] = useState(initialRouteState.stageName);
  const [selectedRole, setSelectedRole] = useState(initialRouteState.role);
  const [selectedContentType, setSelectedContentType] = useState(initialRouteState.contentType);
  const [previewMode, setPreviewMode] = useState<ProjectArtifactPreviewMode>(
    initialRouteState.previewMode,
  );
  const [createdFrom, setCreatedFrom] = useState(initialRouteState.createdFrom);
  const [createdTo, setCreatedTo] = useState(initialRouteState.createdTo);
  const [sort, setSort] = useState<ProjectArtifactSort>(initialRouteState.sort);
  const [page, setPage] = useState(initialRouteState.page);
  const [selectedArtifactId, setSelectedArtifactId] = useState(initialRouteState.artifactId);
  const [selectedArtifactIds, setSelectedArtifactIds] = useState<string[]>([]);
  const [isBulkDownloading, setIsBulkDownloading] = useState(false);
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);

  const artifactQuery = useQuery({
    queryKey: [
      'project-artifacts',
      props.projectId,
      query,
      selectedWorkflowId,
      selectedWorkItemId,
      selectedTaskId,
      selectedStageName,
      selectedRole,
      selectedContentType,
      previewMode,
      createdFrom,
      createdTo,
      sort,
      page,
    ],
    queryFn: () =>
      dashboardApi.listProjectArtifacts(props.projectId, {
        q: query,
        workflow_id: selectedWorkflowId,
        work_item_id: selectedWorkItemId,
        task_id: selectedTaskId,
        stage_name: selectedStageName,
        role: selectedRole,
        content_type: selectedContentType,
        preview_mode: previewMode === 'all' ? '' : previewMode,
        created_from: createdFrom,
        created_to: createdTo,
        sort,
        page: String(page),
        per_page: String(PROJECT_ARTIFACT_PAGE_SIZE),
      }),
    placeholderData: keepPreviousData,
  });

  const artifacts = useMemo(
    () => normalizeProjectArtifactEntries(artifactQuery.data?.data),
    [artifactQuery.data?.data],
  );
  const summary = useMemo(
    () => normalizeProjectArtifactSummary(artifactQuery.data?.meta.summary),
    [artifactQuery.data?.meta.summary],
  );
  const filterOptions = artifactQuery.data?.meta.filters;
  const workflows = filterOptions?.workflows ?? [];
  const workItems = filterOptions?.work_items ?? [];
  const tasks = filterOptions?.tasks ?? [];
  const stageOptions = filterOptions?.stages ?? [];
  const roleOptions = filterOptions?.roles ?? [];
  const contentTypeOptions = filterOptions?.content_types ?? [];
  const totalPages = artifactQuery.data?.meta.total_pages ?? 1;
  const totalArtifacts = artifactQuery.data?.meta.total ?? 0;

  const selectedWorkflow =
    workflows.find((workflow) => workflow.id === selectedWorkflowId) ?? null;
  const selectedWorkItem =
    workItems.find((workItem) => workItem.id === selectedWorkItemId) ?? null;
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;
  const selectedArtifact =
    artifacts.find((artifact) => artifact.id === selectedArtifactId) ?? artifacts[0] ?? null;
  const browserState = useMemo(
    () => ({
      query,
      workflowId: selectedWorkflowId,
      workItemId: selectedWorkItemId,
      taskId: selectedTaskId,
      stageName: selectedStageName,
      role: selectedRole,
      contentType: selectedContentType,
      previewMode,
      createdFrom,
      createdTo,
      sort,
      page,
      artifactId: selectedArtifactId,
    }),
    [
      createdFrom,
      createdTo,
      page,
      previewMode,
      props.projectId,
      query,
      selectedArtifactId,
      selectedContentType,
      selectedRole,
      selectedStageName,
      selectedTaskId,
      selectedWorkItemId,
      selectedWorkflowId,
      sort,
    ],
  );

  const scopeChips = useMemo(
    () =>
      buildProjectArtifactScopeChips({
        query,
        workflowName: selectedWorkflow?.name ?? null,
        stageName: selectedStageName,
        workItemTitle: selectedWorkItem?.title ?? null,
        taskTitle: selectedTask?.title ?? null,
        role: selectedRole,
        contentType: selectedContentType,
        previewMode,
        createdFrom,
        createdTo,
      }),
    [
      createdFrom,
      createdTo,
      previewMode,
      query,
      selectedContentType,
      selectedRole,
      selectedStageName,
      selectedTask?.title,
      selectedWorkItem?.title,
      selectedWorkflow?.name,
    ],
  );
  const nextAction = useMemo(
    () =>
      describeProjectArtifactNextAction({
        totalArtifacts,
        selectedCount: selectedArtifactIds.length,
        selectedArtifactName: selectedArtifact?.fileName ?? null,
        activeFilterCount: scopeChips.length,
      }),
    [scopeChips.length, selectedArtifact?.fileName, selectedArtifactIds.length, totalArtifacts],
  );
  const filterPanelSummary = useMemo(
    () => buildArtifactFilterSummary(scopeChips, totalArtifacts),
    [scopeChips, totalArtifacts],
  );
  const previewDescriptor = selectedArtifact
    ? describeArtifactPreview(selectedArtifact.contentType, selectedArtifact.logicalPath)
    : null;
  const shouldFetchPreview =
    Boolean(selectedArtifact) &&
    Boolean(previewDescriptor?.canPreview) &&
    (selectedArtifact?.sizeBytes ?? 0) <= MAX_INLINE_ARTIFACT_PREVIEW_BYTES;
  const previewQuery = useQuery({
    queryKey: ['project-artifact-preview', selectedArtifact?.taskId, selectedArtifact?.artifactId],
    queryFn: () =>
      dashboardApi.readTaskArtifactContent(selectedArtifact!.taskId, selectedArtifact!.artifactId),
    enabled: shouldFetchPreview,
  });

  useEffect(() => {
    if (selectedWorkflowId && !workflows.some((workflow) => workflow.id === selectedWorkflowId)) {
      setSelectedWorkflowId('');
    }
  }, [selectedWorkflowId, workflows]);

  useEffect(() => {
    if (selectedWorkItemId && !workItems.some((workItem) => workItem.id === selectedWorkItemId)) {
      setSelectedWorkItemId('');
    }
  }, [selectedWorkItemId, workItems]);

  useEffect(() => {
    if (selectedTaskId && !tasks.some((task) => task.id === selectedTaskId)) {
      setSelectedTaskId('');
    }
  }, [selectedTaskId, tasks]);

  useEffect(() => {
    if (selectedArtifact && selectedArtifact.id !== selectedArtifactId) {
      setSelectedArtifactId(selectedArtifact.id);
    }
    if (!selectedArtifact) {
      setSelectedArtifactId('');
    }
  }, [selectedArtifact, selectedArtifactId]);

  useEffect(() => {
    setSelectedArtifactIds((current) =>
      current.filter((artifactId) => artifacts.some((artifact) => artifact.id === artifactId)),
    );
  }, [artifacts]);

  function setPageAndReset(nextPage: number): void {
    setPage(nextPage);
    setSelectedArtifactId('');
    setSelectedArtifactIds([]);
  }

  function updateFilters(update: () => void): void {
    update();
    setPage(1);
  }

  async function handleBulkDownload() {
    const artifactsToDownload = artifacts.filter((artifact) =>
      selectedArtifactIds.includes(artifact.id),
    );
    if (artifactsToDownload.length === 0) {
      return;
    }
    setIsBulkDownloading(true);
    try {
      for (const artifact of artifactsToDownload) {
        const download = await dashboardApi.downloadTaskArtifact(artifact.taskId, artifact.artifactId);
        const objectUrl = URL.createObjectURL(download.blob);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = download.file_name ?? artifact.fileName;
        document.body.append(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(objectUrl);
      }
      toast.success(`Downloaded ${artifactsToDownload.length} artifacts`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to download selected artifacts');
    } finally {
      setIsBulkDownloading(false);
    }
  }

  if (artifactQuery.isLoading && !artifactQuery.data) {
    return <ProjectArtifactExplorerSkeleton showHeader={props.showHeader ?? false} />;
  }

  return (
    <ProjectArtifactExplorerShell
      projectId={props.projectId}
      showHeader={props.showHeader ?? false}
      summary={summary}
      loadError={artifactQuery.error}
      filterCard={
        <ArtifactExplorerSection
          title="Review scope"
          summary={filterPanelSummary}
          description="Start with the artifact list. Expand review scope only when you need to narrow or sort the result set."
          isExpanded={isFilterPanelOpen}
          onToggle={() => setIsFilterPanelOpen((current) => !current)}
        >
          <ProjectArtifactFilterCard
            loadedArtifactCount={artifacts.length}
            totalArtifactCount={summary.totalArtifacts}
            selectedArtifactCount={selectedArtifactIds.length}
            previewableArtifactCount={summary.previewableArtifacts}
            roleCount={summary.roleCount}
            nextAction={nextAction}
            scopeChips={scopeChips}
            query={query}
            selectedWorkflowId={selectedWorkflowId}
            selectedStageName={selectedStageName}
            selectedWorkItemId={selectedWorkItemId}
            selectedTaskId={selectedTaskId}
            selectedRole={selectedRole}
            selectedContentType={selectedContentType}
            previewMode={previewMode === 'all' ? '' : previewMode}
            createdFrom={createdFrom}
            createdTo={createdTo}
            sort={sort}
            workflows={workflows}
            stageOptions={stageOptions}
            workItems={workItems}
            tasks={tasks}
            roleOptions={roleOptions}
            contentTypeOptions={contentTypeOptions}
            onQueryChange={(value) => updateFilters(() => setQuery(value))}
            onWorkflowChange={(value) => updateFilters(() => setSelectedWorkflowId(value))}
            onStageChange={(value) => updateFilters(() => setSelectedStageName(value))}
            onWorkItemChange={(value) => updateFilters(() => setSelectedWorkItemId(value))}
            onTaskChange={(value) => updateFilters(() => setSelectedTaskId(value))}
            onRoleChange={(value) => updateFilters(() => setSelectedRole(value))}
            onContentTypeChange={(value) => updateFilters(() => setSelectedContentType(value))}
            onPreviewModeChange={(value) =>
              updateFilters(() => setPreviewMode((value || 'all') as ProjectArtifactPreviewMode))
            }
            onCreatedFromChange={(value) => updateFilters(() => setCreatedFrom(value))}
            onCreatedToChange={(value) => updateFilters(() => setCreatedTo(value))}
            onSortChange={(value) => updateFilters(() => setSort(value))}
            onReset={() =>
              updateFilters(() => {
                setQuery('');
                setSelectedWorkflowId('');
                setSelectedWorkItemId('');
                setSelectedTaskId('');
                setSelectedStageName('');
                setSelectedRole('');
                setSelectedContentType('');
                setPreviewMode('all');
                setCreatedFrom('');
                setCreatedTo('');
                setSort('newest');
              })
            }
          />
        </ArtifactExplorerSection>
      }
      bulkActionBar={
        <ProjectArtifactBulkActionBar
          selectedCount={selectedArtifactIds.length}
          isDownloading={isBulkDownloading}
          onClear={() => setSelectedArtifactIds([])}
          onDownload={() => void handleBulkDownload()}
        />
      }
      adaptiveLayout={
        <ProjectArtifactExplorerAdaptiveLayout
          artifactCount={summary.totalArtifacts}
          selectedArtifactName={selectedArtifact?.fileName ?? null}
          selectedArtifact={selectedArtifact}
          previewDescriptor={previewDescriptor}
          previewContentText={previewQuery.data?.content_text ?? null}
          listSelection={{
            selectedArtifactId,
            selectedArtifactIds,
            onSelectArtifact: setSelectedArtifactId,
            onToggleArtifact: (artifactId) =>
              setSelectedArtifactIds((current) =>
                current.includes(artifactId)
                  ? current.filter((value) => value !== artifactId)
                  : [...current, artifactId],
              ),
          }}
          artifacts={artifacts}
          isLoading={artifactQuery.isFetching}
          pagination={{
            page,
            totalPages,
            totalArtifacts,
            pageSize: PROJECT_ARTIFACT_PAGE_SIZE,
            onPrevious: () => setPageAndReset(Math.max(page - 1, 1)),
            onNext: () => setPageAndReset(Math.min(page + 1, totalPages)),
          }}
          previewState={{
            isLoading: previewQuery.isLoading,
            error: previewQuery.error instanceof Error ? previewQuery.error.message : null,
          }}
          buildPreviewHref={(artifact) =>
            buildArtifactPermalink(artifact.taskId, artifact.artifactId, {
              returnTo: buildProjectArtifactBrowserPath(props.projectId, {
                ...browserState,
                artifactId: artifact.id,
              }),
              returnSource: 'project-artifacts',
            })
          }
        />
      }
    />
  );
}

function ArtifactExplorerSection(props: {
  title: string;
  summary: string;
  description: string;
  isExpanded: boolean;
  onToggle(): void;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="rounded-2xl border border-border/70 bg-card/70 shadow-none">
      <button
        type="button"
        className="flex w-full items-start justify-between gap-3 px-4 py-4 text-left"
        aria-expanded={props.isExpanded}
        onClick={props.onToggle}
      >
        <div className="space-y-2">
          <p className="text-sm font-semibold text-foreground">{props.title}</p>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">
            {props.summary}
          </p>
          <p className="text-sm leading-6 text-muted">{props.description}</p>
        </div>
        <ChevronDown
          className={cn('mt-1 h-4 w-4 shrink-0 text-muted transition-transform', props.isExpanded && 'rotate-180')}
        />
      </button>
      {props.isExpanded ? <div className="border-t border-border/70 p-1">{props.children}</div> : null}
    </section>
  );
}

function buildArtifactFilterSummary(
  scopeChips: Array<{ label: string; value: string }>,
  totalArtifacts: number,
): string {
  if (scopeChips.length === 0) {
    return `${totalArtifacts} artifacts • Project-wide review scope`;
  }

  const visibleChips = scopeChips.slice(0, 3).map((chip) => `${chip.label}: ${chip.value}`);
  const remainingCount = scopeChips.length - visibleChips.length;

  return remainingCount > 0
    ? `${visibleChips.join(' • ')} • +${remainingCount} more`
    : visibleChips.join(' • ');
}
