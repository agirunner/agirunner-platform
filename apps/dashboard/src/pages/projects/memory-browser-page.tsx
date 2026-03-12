import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BrainCircuit, Loader2 } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';

import { dashboardApi } from '../../lib/api.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Input } from '../../components/ui/input.js';
import { Badge } from '../../components/ui/badge.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { ProjectMemoryTable } from './project-memory-table.js';
import {
  extractMemoryEntries,
  filterMemoryEntries,
  normalizeWorkItemMemoryEntries,
  normalizeProjectList,
  summarizeProjectTimeline,
} from './project-memory-support.js';
import {
  buildWorkflowOptions,
  normalizeWorkItemOptions,
} from './project-content-browser-support.js';

export function MemoryBrowserPage(): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedProjectId, setSelectedProjectId] = useState(searchParams.get('project') ?? '');
  const [selectedWorkflowId, setSelectedWorkflowId] = useState(searchParams.get('workflow') ?? '');
  const [selectedWorkItemId, setSelectedWorkItemId] = useState(searchParams.get('work_item') ?? '');
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') ?? '');

  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: () => dashboardApi.listProjects(),
  });
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

  const projects = useMemo(() => normalizeProjectList(projectsQuery.data), [projectsQuery.data]);
  const workflows = useMemo(() => buildWorkflowOptions(timelineQuery.data), [timelineQuery.data]);
  const workItems = useMemo(
    () => normalizeWorkItemOptions(workItemsQuery.data),
    [workItemsQuery.data],
  );
  const projectMemoryEntries = useMemo(
    () => extractMemoryEntries(projectQuery.data?.memory),
    [projectQuery.data?.memory],
  );
  const workItemMemoryEntries = useMemo(
    () => normalizeWorkItemMemoryEntries(workItemMemoryQuery.data?.entries),
    [workItemMemoryQuery.data?.entries],
  );
  const filteredProjectEntries = useMemo(
    () => filterMemoryEntries(projectMemoryEntries, searchQuery),
    [projectMemoryEntries, searchQuery],
  );
  const filteredWorkItemEntries = useMemo(
    () => filterMemoryEntries(workItemMemoryEntries, searchQuery),
    [searchQuery, workItemMemoryEntries],
  );
  const timelineSummary = useMemo(
    () => summarizeProjectTimeline(timelineQuery.data),
    [timelineQuery.data],
  );
  const selectedWorkflow = workflows.find((workflow) => workflow.id === selectedWorkflowId) ?? null;
  const selectedWorkItem = workItems.find((workItem) => workItem.id === selectedWorkItemId) ?? null;

  useEffect(() => {
    if (workflows.length === 0) {
      setSelectedWorkflowId('');
      setSelectedWorkItemId('');
      return;
    }
    if (selectedWorkflowId && !workflows.some((workflow) => workflow.id === selectedWorkflowId)) {
      setSelectedWorkflowId(workflows[0].id);
      setSelectedWorkItemId('');
    }
  }, [selectedWorkflowId, workflows]);

  useEffect(() => {
    if (workItems.length === 0) {
      setSelectedWorkItemId('');
      return;
    }
    if (selectedWorkItemId && !workItems.some((workItem) => workItem.id === selectedWorkItemId)) {
      setSelectedWorkItemId('');
    }
  }, [selectedWorkItemId, workItems]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (selectedProjectId) next.set('project', selectedProjectId); else next.delete('project');
    if (selectedWorkflowId) next.set('workflow', selectedWorkflowId); else next.delete('workflow');
    if (selectedWorkItemId) next.set('work_item', selectedWorkItemId); else next.delete('work_item');
    if (searchQuery) next.set('q', searchQuery); else next.delete('q');
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, searchQuery, selectedProjectId, selectedWorkflowId, selectedWorkItemId, setSearchParams]);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Memory Browser</h1>
        <p className="text-sm text-muted">
          Browse project memory alongside workflow and work-item scoped context using deep-linkable v2 filters.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Project Scope</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-sm">
            <label className="mb-1 block text-sm font-medium">Project</label>
            {projectsQuery.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading projects...
              </div>
            ) : (
              <Select value={selectedProjectId} onValueChange={(value) => {
                setSelectedProjectId(value);
                setSelectedWorkflowId('');
                setSelectedWorkItemId('');
              }}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {projectsQuery.error ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              Failed to load projects: {String(projectsQuery.error)}
            </div>
          ) : null}

          {!selectedProjectId && !projectsQuery.isLoading ? (
            <div className="flex flex-col items-center py-8 text-muted">
              <BrainCircuit className="mb-3 h-10 w-10" />
              <p className="text-sm">Select a project to inspect memory.</p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {selectedProjectId ? (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Memory Entries</CardTitle>
              </CardHeader>
              <CardContent className="text-3xl font-semibold">
                {projectMemoryEntries.length + workItemMemoryEntries.length}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Project Workflows</CardTitle>
              </CardHeader>
              <CardContent className="text-3xl font-semibold">
                {timelineSummary.totalCount}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Active Workflows</CardTitle>
              </CardHeader>
              <CardContent className="text-3xl font-semibold">
                {timelineSummary.activeCount}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Workflow Scope</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_240px]">
              <div className="space-y-2">
                <label className="mb-1 block text-sm font-medium">Workflow</label>
                {timelineQuery.isLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading project workflows...
                  </div>
                ) : workflows.length > 0 ? (
                  <Select value={selectedWorkflowId || '__all__'} onValueChange={(value) => {
                    setSelectedWorkflowId(value === '__all__' ? '' : value);
                    setSelectedWorkItemId('');
                  }}>
                    <SelectTrigger>
                      <SelectValue placeholder="All workflows" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All workflows</SelectItem>
                      {workflows.map((workflow) => (
                        <SelectItem key={workflow.id} value={workflow.id}>
                          {workflow.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-sm text-muted">No workflows have been recorded for this project yet.</p>
                )}
              </div>

              <div className="space-y-2">
                <label className="mb-1 block text-sm font-medium">Work item</label>
                {workItemsQuery.isLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading workflow work items...
                  </div>
                ) : workItems.length > 0 ? (
                  <Select value={selectedWorkItemId || '__all__'} onValueChange={(value) => setSelectedWorkItemId(value === '__all__' ? '' : value)}>
                    <SelectTrigger>
                      <SelectValue placeholder="All work items" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All work items</SelectItem>
                      {workItems.map((workItem) => (
                        <SelectItem key={workItem.id} value={workItem.id}>
                          {workItem.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-sm text-muted">
                    {selectedWorkflowId ? 'No work items found for this workflow yet.' : 'Select a workflow to browse work-item memory.'}
                  </p>
                )}
              </div>

              {selectedWorkflow || selectedWorkItem ? (
                <div className="rounded-md border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="secondary">{selectedWorkflow?.state ?? selectedWorkItem?.columnId ?? 'scoped'}</Badge>
                    {selectedWorkflow ? (
                      <Link className="text-sm text-accent hover:underline" to={`/work/workflows/${selectedWorkflow.id}`}>
                        Open workflow
                      </Link>
                    ) : null}
                  </div>
                  <p className="mt-2 text-sm font-medium">{selectedWorkItem?.title ?? selectedWorkflow?.name}</p>
                  <p className="mt-1 text-xs text-muted">
                    {selectedWorkItem ? `Stage ${selectedWorkItem.stageName}` : 'Project workflow scope'}
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Memory Explorer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="max-w-md">
                <label className="mb-1 block text-sm font-medium">Filter entries</label>
                <Input
                  placeholder="Search by key, value, stage, work item, task, or actor"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                />
              </div>

              {projectQuery.isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted" />
                </div>
              ) : projectQuery.error ? (
                <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                  Failed to load project memory: {String(projectQuery.error)}
                </div>
              ) : filteredProjectEntries.length > 0 ? (
                <ProjectMemoryTable entries={filteredProjectEntries} projectId={selectedProjectId} />
              ) : (
                <div className="flex flex-col items-center py-10 text-muted">
                  <BrainCircuit className="mb-3 h-10 w-10" />
                  <p className="text-sm">
                    {projectMemoryEntries.length + workItemMemoryEntries.length === 0
                      ? 'No project or work-item memory has been written yet.'
                      : 'No memory entries matched the current filter.'}
                  </p>
                </div>
              )}

              <div className="space-y-3">
                <div>
                  <h3 className="text-sm font-medium">Work-item memory</h3>
                  <p className="text-xs text-muted">
                    Read-only scoped memory entries written for the selected workflow and work item.
                  </p>
                </div>
                {workItemMemoryQuery.isLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading work-item memory...
                  </div>
                ) : filteredWorkItemEntries.length > 0 ? (
                  <div className="space-y-2">
                    {filteredWorkItemEntries.map((entry) => (
                      <div key={`${entry.key}:${entry.updatedAt ?? 'unknown'}`} className="rounded-md border p-3">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                          <Badge variant="outline">{entry.scope}</Badge>
                          {entry.stageName ? <Badge variant="secondary">{entry.stageName}</Badge> : null}
                          {entry.taskId ? <span>Task {entry.taskId}</span> : null}
                          {entry.updatedAt ? <span>{new Date(entry.updatedAt).toLocaleString()}</span> : null}
                        </div>
                        <p className="mt-2 font-mono text-sm">{entry.key}</p>
                        <pre className="mt-2 overflow-x-auto rounded-md bg-border/10 p-3 text-xs">
                          {typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value, null, 2)}
                        </pre>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted">
                    {selectedWorkItemId
                      ? 'No work-item memory entries matched the current filter.'
                      : 'Select a workflow work item to inspect scoped memory.'}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent Workflow Context</CardTitle>
            </CardHeader>
            <CardContent>
              {timelineQuery.isLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading project timeline...
                </div>
              ) : timelineSummary.recentWorkflows.length > 0 ? (
                <div className="space-y-3">
                  {timelineSummary.recentWorkflows.map((workflow) => (
                    <div
                      key={workflow.id}
                      className="flex items-center justify-between rounded-md border p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <Link
                          className="truncate text-sm font-medium text-accent hover:underline"
                          to={`/work/workflows/${workflow.id}`}
                        >
                          {workflow.name}
                        </Link>
                        <p className="mt-1 text-xs text-muted">
                          {new Date(workflow.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <Badge variant="secondary">{workflow.state}</Badge>
                    </div>
                  ))}
                </div>
              ) : timelineQuery.error ? (
                <p className="text-sm text-red-600">Failed to load workflow context.</p>
              ) : (
                <p className="text-sm text-muted">No workflows have been recorded for this project yet.</p>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
