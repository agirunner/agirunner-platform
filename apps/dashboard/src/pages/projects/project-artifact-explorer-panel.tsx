import { useEffect, useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';

import {
  MAX_INLINE_ARTIFACT_PREVIEW_BYTES,
  describeArtifactPreview,
} from '../../components/artifact-preview-support.js';
import { dashboardApi } from '../../lib/api.js';
import { toast } from '../../lib/toast.js';
import {
  buildWorkflowOptions,
  normalizeTaskOptions,
  normalizeWorkItemOptions,
} from './project-content-browser-support.js';
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
  buildArtifactContentTypeOptions,
  buildArtifactRoleOptions,
  buildArtifactStageOptions,
  buildProjectArtifactEntries,
  filterProjectArtifactEntries,
  summarizeProjectArtifactEntries,
  type ProjectArtifactPreviewMode,
  type ProjectArtifactSort,
} from './project-artifact-explorer-support.js';
import {
  ProjectArtifactExplorerSkeleton,
} from './project-artifact-explorer-presentation.js';
import { ProjectArtifactExplorerShell } from './project-artifact-explorer-shell.js';

export function ProjectArtifactExplorerPanel(props: {
  projectId: string;
  showHeader?: boolean;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const [selectedWorkflowId, setSelectedWorkflowId] = useState('');
  const [selectedWorkItemId, setSelectedWorkItemId] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [selectedStageName, setSelectedStageName] = useState('');
  const [selectedRole, setSelectedRole] = useState('');
  const [selectedContentType, setSelectedContentType] = useState('');
  const [previewMode, setPreviewMode] = useState<ProjectArtifactPreviewMode>('all');
  const [createdFrom, setCreatedFrom] = useState('');
  const [createdTo, setCreatedTo] = useState('');
  const [sort, setSort] = useState<ProjectArtifactSort>('newest');
  const [selectedArtifactId, setSelectedArtifactId] = useState('');
  const [selectedArtifactIds, setSelectedArtifactIds] = useState<string[]>([]);
  const [isBulkDownloading, setIsBulkDownloading] = useState(false);

  const timelineQuery = useQuery({
    queryKey: ['project-timeline', props.projectId],
    queryFn: () => dashboardApi.getProjectTimeline(props.projectId),
  });

  const workflows = useMemo(
    () => buildWorkflowOptions(timelineQuery.data),
    [timelineQuery.data],
  );
  const scopedWorkflowIds = useMemo(
    () => (selectedWorkflowId ? [selectedWorkflowId] : workflows.map((workflow) => workflow.id)),
    [selectedWorkflowId, workflows],
  );

  const taskQueries = useQueries({
    queries: scopedWorkflowIds.map((workflowId) => ({
      queryKey: ['project-artifact-workflow-tasks', workflowId],
      queryFn: () => dashboardApi.listTasks({ workflow_id: workflowId, per_page: '100' }),
      enabled: workflowId.length > 0,
    })),
  });
  const workItemQueries = useQueries({
    queries: scopedWorkflowIds.map((workflowId) => ({
      queryKey: ['project-artifact-work-items', workflowId],
      queryFn: () => dashboardApi.listWorkflowWorkItems(workflowId),
      enabled: workflowId.length > 0,
    })),
  });

  const tasks = useMemo(
    () => taskQueries.flatMap((queryResult) => normalizeTaskOptions(queryResult.data)),
    [taskQueries],
  );
  const workItems = useMemo(
    () => workItemQueries.flatMap((queryResult) => normalizeWorkItemOptions(queryResult.data)),
    [workItemQueries],
  );
  const selectedWorkflow =
    workflows.find((workflow) => workflow.id === selectedWorkflowId) ?? null;
  const selectedWorkItem =
    workItems.find((workItem) => workItem.id === selectedWorkItemId) ?? null;
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;
  const scopedTaskIds = useMemo(() => {
    return tasks
      .filter((task) => (selectedWorkItemId ? task.workItemId === selectedWorkItemId : true))
      .filter((task) => (selectedTaskId ? task.id === selectedTaskId : true))
      .filter((task) => (selectedStageName ? task.stageName === selectedStageName : true))
      .map((task) => task.id);
  }, [selectedStageName, selectedTaskId, selectedWorkItemId, tasks]);

  const artifactQueries = useQueries({
    queries: scopedTaskIds.map((taskId) => ({
      queryKey: ['project-artifact-task-artifacts', taskId],
      queryFn: () => dashboardApi.listTaskArtifacts(taskId),
      enabled: taskId.length > 0,
    })),
  });

  const artifactEntries = useMemo(() => {
    const artifactsByTask = Object.fromEntries(
      scopedTaskIds.map((taskId, index) => [taskId, artifactQueries[index]?.data]),
    );
    return buildProjectArtifactEntries({
      workflows,
      tasks,
      workItems,
      artifactsByTask,
    });
  }, [artifactQueries, scopedTaskIds, tasks, workflows, workItems]);
  const filteredArtifacts = useMemo(
    () =>
      filterProjectArtifactEntries(artifactEntries, {
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
      }),
    [
      artifactEntries,
      createdFrom,
      createdTo,
      query,
      selectedRole,
      selectedContentType,
      selectedStageName,
      selectedTaskId,
      selectedWorkflowId,
      selectedWorkItemId,
      previewMode,
      sort,
    ],
  );
  const summary = useMemo(
    () => summarizeProjectArtifactEntries(filteredArtifacts),
    [filteredArtifacts],
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
      selectedRole,
      selectedContentType,
      selectedStageName,
      selectedTask?.title,
      selectedWorkItem?.title,
      selectedWorkflow?.name,
    ],
  );
  const contentTypeOptions = useMemo(
    () => buildArtifactContentTypeOptions(artifactEntries),
    [artifactEntries],
  );
  const stageOptions = useMemo(
    () => buildArtifactStageOptions(artifactEntries),
    [artifactEntries],
  );
  const roleOptions = useMemo(
    () => buildArtifactRoleOptions(artifactEntries),
    [artifactEntries],
  );
  const visibleWorkItems = useMemo(
    () =>
      workItems
        .filter((workItem) =>
          selectedWorkflowId ? workItem.workflowId === selectedWorkflowId : true,
        )
        .filter((workItem) =>
          selectedStageName ? workItem.stageName === selectedStageName : true,
        ),
    [selectedStageName, selectedWorkflowId, workItems],
  );
  const visibleTasks = useMemo(
    () =>
      tasks
        .filter((task) => (selectedWorkflowId ? task.workflowId === selectedWorkflowId : true))
        .filter((task) => (selectedWorkItemId ? task.workItemId === selectedWorkItemId : true))
        .filter((task) => (selectedStageName ? task.stageName === selectedStageName : true)),
    [selectedStageName, selectedWorkflowId, selectedWorkItemId, tasks],
  );

  const selectedArtifact =
    filteredArtifacts.find((artifact) => artifact.id === selectedArtifactId) ??
    filteredArtifacts[0] ??
    null;
  const nextAction = useMemo(
    () =>
      describeProjectArtifactNextAction({
        totalArtifacts: filteredArtifacts.length,
        selectedCount: selectedArtifactIds.length,
        selectedArtifactName: selectedArtifact?.fileName ?? null,
        activeFilterCount: scopeChips.length,
      }),
    [
      filteredArtifacts.length,
      scopeChips.length,
      selectedArtifact?.fileName,
      selectedArtifactIds.length,
    ],
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
    if (selectedWorkItemId && !visibleWorkItems.some((workItem) => workItem.id === selectedWorkItemId)) {
      setSelectedWorkItemId('');
    }
  }, [selectedWorkItemId, visibleWorkItems]);

  useEffect(() => {
    if (selectedTaskId && !visibleTasks.some((task) => task.id === selectedTaskId)) {
      setSelectedTaskId('');
    }
  }, [selectedTaskId, visibleTasks]);

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
      current.filter((artifactId) => filteredArtifacts.some((artifact) => artifact.id === artifactId)),
    );
  }, [filteredArtifacts]);

  async function handleBulkDownload() {
    const artifactsToDownload = filteredArtifacts.filter((artifact) =>
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

  if (timelineQuery.isLoading) {
    return <ProjectArtifactExplorerSkeleton showHeader={props.showHeader ?? false} />;
  }

  const isLoading =
    taskQueries.some((queryResult) => queryResult.isLoading) ||
    workItemQueries.some((queryResult) => queryResult.isLoading) ||
    artifactQueries.some((queryResult) => queryResult.isLoading);

  return (
    <ProjectArtifactExplorerShell
      projectId={props.projectId}
      showHeader={props.showHeader ?? false}
      summary={summary}
      filteredArtifacts={filteredArtifacts}
      selectedArtifact={selectedArtifact}
      selectedArtifactId={selectedArtifactId}
      selectedArtifactIds={selectedArtifactIds}
      isBulkDownloading={isBulkDownloading}
      isLoading={isLoading}
      timelineError={timelineQuery.error}
      scopeChips={scopeChips}
      nextAction={nextAction}
      filterCard={
        <ProjectArtifactFilterCard
          visibleArtifactCount={filteredArtifacts.length}
          selectedArtifactCount={selectedArtifactIds.length}
          previewableArtifactCount={filteredArtifacts.filter((artifact) => artifact.canPreview).length}
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
          workItems={visibleWorkItems}
          tasks={visibleTasks}
          roleOptions={roleOptions}
          contentTypeOptions={contentTypeOptions}
          onQueryChange={setQuery}
          onWorkflowChange={setSelectedWorkflowId}
          onStageChange={setSelectedStageName}
          onWorkItemChange={setSelectedWorkItemId}
          onTaskChange={setSelectedTaskId}
          onRoleChange={setSelectedRole}
          onContentTypeChange={setSelectedContentType}
          onPreviewModeChange={(value) =>
            setPreviewMode((value || 'all') as ProjectArtifactPreviewMode)
          }
          onCreatedFromChange={setCreatedFrom}
          onCreatedToChange={setCreatedTo}
          onSortChange={setSort}
          onReset={() => {
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
          }}
        />
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
          artifactCount={filteredArtifacts.length}
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
          artifacts={filteredArtifacts}
          isLoading={isLoading}
          previewState={{
            isLoading: previewQuery.isLoading,
            error:
              previewQuery.error instanceof Error ? previewQuery.error.message : null,
          }}
        />
      }
    />
  );
}
