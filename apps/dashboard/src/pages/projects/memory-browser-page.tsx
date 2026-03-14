import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';

import { dashboardApi } from '../../lib/api.js';
import {
  buildWorkflowOptions,
  normalizeWorkItemOptions,
} from './project-content-browser-support.js';
import { ProjectMemoryHistoryPanel } from './project-memory-history-panel.js';
import {
  buildMemoryActorOptions,
  buildMemoryKeyOptions,
  formatMemoryActor,
  filterScopedMemoryEntries,
} from './project-memory-history-support.js';
import {
  extractMemoryEntries,
  normalizeProjectList,
  normalizeWorkItemMemoryEntries,
  normalizeWorkItemMemoryHistoryEntries,
  summarizeProjectTimeline,
} from './project-memory-support.js';
import {
  MemoryBrowserHeader,
  MemoryOverviewSection,
  ProjectScopeCard,
  WorkflowScopeCard,
} from './memory-browser-page-sections.js';
import {
  MemoryExplorerCard,
  RecentWorkflowContextCard,
} from './memory-browser-page-explorer.js';
import {
  useScopedSelection,
  useSelectionGuards,
} from './memory-browser-page.support.js';

interface MemoryBrowserPageProps {
  scopedProjectId?: string;
  scopedWorkflowId?: string;
  scopedWorkItemId?: string;
  showHeader?: boolean;
}

export function MemoryBrowserPage(): JSX.Element {
  return <MemoryBrowserSurface />;
}

export function MemoryBrowserSurface(props: MemoryBrowserPageProps = {}): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const scopedProjectId = props.scopedProjectId?.trim() ?? '';
  const scopedWorkflowId = props.scopedWorkflowId?.trim() ?? '';
  const scopedWorkItemId = props.scopedWorkItemId?.trim() ?? '';
  const [selectedProjectId, setSelectedProjectId] = useState(scopedProjectId || (searchParams.get('project') ?? ''));
  const [selectedWorkflowId, setSelectedWorkflowId] = useState(scopedWorkflowId || (searchParams.get('workflow') ?? ''));
  const [selectedWorkItemId, setSelectedWorkItemId] = useState(scopedWorkItemId || (searchParams.get('work_item') ?? ''));
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') ?? '');
  const [selectedHistoryAuthor, setSelectedHistoryAuthor] = useState(searchParams.get('author') ?? '');
  const [selectedHistoryKey, setSelectedHistoryKey] = useState(searchParams.get('key') ?? '');

  const projectsQuery = useQuery({ queryKey: ['projects'], queryFn: () => dashboardApi.listProjects() });
  const projectQuery = useQuery({
    queryKey: ['project', selectedProjectId],
    queryFn: () => dashboardApi.getProject(selectedProjectId),
    enabled: selectedProjectId.length > 0,
  });
  const timelineQuery = useQuery({
    queryKey: ['project-timeline', selectedProjectId],
    queryFn: () => dashboardApi.getProjectTimeline(selectedProjectId),
    enabled: selectedProjectId.length > 0,
  });
  const workItemsQuery = useQuery({
    queryKey: ['workflow-work-items', selectedWorkflowId],
    queryFn: () => dashboardApi.listWorkflowWorkItems(selectedWorkflowId),
    enabled: selectedWorkflowId.length > 0,
  });
  const workItemMemoryQuery = useQuery({
    queryKey: ['work-item-memory', selectedWorkflowId, selectedWorkItemId],
    queryFn: () => dashboardApi.getWorkflowWorkItemMemory(selectedWorkflowId, selectedWorkItemId),
    enabled: selectedWorkflowId.length > 0 && selectedWorkItemId.length > 0,
  });
  const workItemMemoryHistoryQuery = useQuery({
    queryKey: ['work-item-memory-history', selectedWorkflowId, selectedWorkItemId],
    queryFn: () => dashboardApi.getWorkflowWorkItemMemoryHistory(selectedWorkflowId, selectedWorkItemId),
    enabled: selectedWorkflowId.length > 0 && selectedWorkItemId.length > 0,
  });

  const projects = useMemo(() => normalizeProjectList(projectsQuery.data), [projectsQuery.data]);
  const workflows = useMemo(() => buildWorkflowOptions(timelineQuery.data), [timelineQuery.data]);
  const workItems = useMemo(() => normalizeWorkItemOptions(workItemsQuery.data), [workItemsQuery.data]);
  const projectMemoryEntries = useMemo(() => extractMemoryEntries(projectQuery.data?.memory), [projectQuery.data?.memory]);
  const workItemMemoryEntries = useMemo(
    () => normalizeWorkItemMemoryEntries(workItemMemoryQuery.data?.entries),
    [workItemMemoryQuery.data?.entries],
  );
  const workItemMemoryHistoryEntries = useMemo(
    () => normalizeWorkItemMemoryHistoryEntries(workItemMemoryHistoryQuery.data?.history),
    [workItemMemoryHistoryQuery.data?.history],
  );
  const timelineSummary = useMemo(() => summarizeProjectTimeline(timelineQuery.data), [timelineQuery.data]);
  const historyAuthorOptions = useMemo(() => buildMemoryActorOptions(workItemMemoryHistoryEntries), [workItemMemoryHistoryEntries]);
  const historyKeyOptions = useMemo(
    () =>
      buildMemoryKeyOptions(
        filterScopedMemoryEntries(workItemMemoryHistoryEntries, {
          query: searchQuery,
          actor: selectedHistoryAuthor,
          key: '',
        }),
      ),
    [searchQuery, selectedHistoryAuthor, workItemMemoryHistoryEntries],
  );
  const filteredProjectEntries = useMemo(
    () => filterScopedMemoryEntries(projectMemoryEntries, { query: searchQuery, actor: '', key: '' }),
    [projectMemoryEntries, searchQuery],
  );
  const filteredWorkItemEntries = useMemo(
    () => filterScopedMemoryEntries(workItemMemoryEntries, { query: searchQuery, actor: selectedHistoryAuthor, key: selectedHistoryKey }),
    [searchQuery, selectedHistoryAuthor, selectedHistoryKey, workItemMemoryEntries],
  );
  const filteredWorkItemHistoryEntries = useMemo(
    () => filterScopedMemoryEntries(workItemMemoryHistoryEntries, { query: searchQuery, actor: selectedHistoryAuthor, key: selectedHistoryKey }),
    [searchQuery, selectedHistoryAuthor, selectedHistoryKey, workItemMemoryHistoryEntries],
  );

  useScopedSelection({ scopedProjectId, scopedWorkflowId, scopedWorkItemId, selectedProjectId, selectedWorkflowId, selectedWorkItemId, setSelectedProjectId, setSelectedWorkflowId, setSelectedWorkItemId });
  useSelectionGuards({ workflows, workItems, selectedWorkflowId, selectedWorkItemId, historyAuthorOptions, historyKeyOptions, selectedHistoryAuthor, selectedHistoryKey, setSelectedWorkflowId, setSelectedWorkItemId, setSelectedHistoryAuthor, setSelectedHistoryKey });
  useEffect(() => {
    const next = new URLSearchParams();
    if (!scopedProjectId && selectedProjectId) next.set('project', selectedProjectId);
    if (!scopedWorkflowId && selectedWorkflowId) next.set('workflow', selectedWorkflowId);
    if (!scopedWorkItemId && selectedWorkItemId) next.set('work_item', selectedWorkItemId);
    if (searchQuery) next.set('q', searchQuery);
    if (selectedHistoryAuthor) next.set('author', selectedHistoryAuthor);
    if (selectedHistoryKey) next.set('key', selectedHistoryKey);
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
  }, [
    scopedProjectId,
    scopedWorkflowId,
    scopedWorkItemId,
    selectedProjectId,
    selectedWorkflowId,
    selectedWorkItemId,
    searchQuery,
    selectedHistoryAuthor,
    selectedHistoryKey,
    searchParams,
    setSearchParams,
  ]);

  const selectedWorkflow = workflows.find((workflow) => workflow.id === selectedWorkflowId) ?? null;
  const selectedWorkItem = workItems.find((workItem) => workItem.id === selectedWorkItemId) ?? null;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      {props.showHeader === false ? null : (
        <MemoryBrowserHeader
          scopedProjectId={scopedProjectId}
          selectedWorkflowId={selectedWorkflowId}
          projectBackLabel="Back to Project"
        />
      )}
      <ProjectScopeCard
        selectedProjectId={selectedProjectId}
        projects={projects}
        isLoading={projectsQuery.isLoading}
        error={projectsQuery.error}
        disabled={scopedProjectId.length > 0}
        onProjectChange={(value) => {
          setSelectedProjectId(value);
          setSelectedWorkflowId('');
          setSelectedWorkItemId('');
        }}
      />
      <MemoryOverviewSection
        selectedProjectId={selectedProjectId}
        selectedWorkflowName={selectedWorkflow?.name ?? null}
        selectedWorkItemTitle={selectedWorkItem?.title ?? null}
        projectEntryCount={projectMemoryEntries.length}
        workItemEntryCount={workItemMemoryEntries.length}
        filteredProjectEntryCount={filteredProjectEntries.length}
        filteredWorkItemEntryCount={filteredWorkItemEntries.length}
        historyEntryCount={filteredWorkItemHistoryEntries.length}
        timelineSummary={timelineSummary}
      />
      {selectedProjectId ? (
        <>
          <WorkflowScopeCard
            selectedWorkflowId={selectedWorkflowId}
            selectedWorkItemId={selectedWorkItemId}
            workflows={workflows}
            workItems={workItems}
            isTimelineLoading={timelineQuery.isLoading}
            isWorkItemsLoading={workItemsQuery.isLoading}
            onWorkflowChange={(value) => {
              setSelectedWorkflowId(value === '__all__' ? '' : value);
              setSelectedWorkItemId('');
            }}
            onWorkItemChange={(value) => setSelectedWorkItemId(value === '__all__' ? '' : value)}
          />
          <MemoryExplorerCard
            projectId={selectedProjectId}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            projectQueryState={{ isLoading: projectQuery.isLoading, error: projectQuery.error }}
            projectEntries={projectMemoryEntries}
            filteredProjectEntries={filteredProjectEntries}
            workItemQueryState={{ isLoading: workItemMemoryQuery.isLoading }}
            filteredWorkItemEntries={filteredWorkItemEntries}
            selectedWorkItemId={selectedWorkItemId}
            workItemHeading="Work-item memory"
            workItemDescription="Read-only scoped memory entries written for the selected workflow and work item."
            formatMemoryActor={formatMemoryActor}
            HistoryPanelComponent={ProjectMemoryHistoryPanel}
            historyPanel={{
              entries: filteredWorkItemHistoryEntries,
              isLoading: workItemMemoryHistoryQuery.isLoading,
              selectedActor: selectedHistoryAuthor,
              selectedKey: selectedHistoryKey,
              actorOptions: historyAuthorOptions,
              keyOptions: historyKeyOptions,
              onActorChange: setSelectedHistoryAuthor,
              onKeyChange: setSelectedHistoryKey,
            }}
          />
          <RecentWorkflowContextCard
            isLoading={timelineQuery.isLoading}
            error={timelineQuery.error}
            recentWorkflows={timelineSummary.recentWorkflows}
          />
        </>
      ) : null}
    </div>
  );
}
