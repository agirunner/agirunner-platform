import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { FileText, Loader2, Package } from 'lucide-react';

import { dashboardApi } from '../../lib/api.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs.js';
import { Badge } from '../../components/ui/badge.js';
import {
  buildWorkflowOptions,
  filterTasksByWorkItem,
  normalizeProjectList,
  normalizeTaskOptions,
  normalizeWorkItemOptions,
} from './project-content-browser-support.js';
import { ArtifactsTable, DocumentsTable } from './project-content-tables.js';

export function ContentBrowserPage(): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedProjectId, setSelectedProjectId] = useState(searchParams.get('project') ?? '');
  const [selectedWorkflowId, setSelectedWorkflowId] = useState(searchParams.get('workflow') ?? '');
  const [selectedWorkItemId, setSelectedWorkItemId] = useState(searchParams.get('work_item') ?? '');
  const [selectedTaskId, setSelectedTaskId] = useState(searchParams.get('task') ?? '');
  const activeTab = searchParams.get('tab') === 'artifacts' ? 'artifacts' : 'documents';

  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: () => dashboardApi.listProjects(),
  });
  const timelineQuery = useQuery({
    queryKey: ['project-timeline', selectedProjectId],
    queryFn: () => dashboardApi.getProjectTimeline(selectedProjectId),
    enabled: selectedProjectId.length > 0,
  });
  const documentsQuery = useQuery({
    queryKey: ['content-documents', selectedWorkflowId],
    queryFn: () => dashboardApi.listWorkflowDocuments(selectedWorkflowId),
    enabled: selectedWorkflowId.length > 0,
  });
  const tasksQuery = useQuery({
    queryKey: ['workflow-tasks', selectedWorkflowId],
    queryFn: () => dashboardApi.listTasks({ workflow_id: selectedWorkflowId, per_page: '100' }),
    enabled: selectedWorkflowId.length > 0,
  });
  const workItemsQuery = useQuery({
    queryKey: ['workflow-work-items', selectedWorkflowId],
    queryFn: () => dashboardApi.listWorkflowWorkItems(selectedWorkflowId),
    enabled: selectedWorkflowId.length > 0,
  });
  const artifactsQuery = useQuery({
    queryKey: ['content-artifacts', selectedTaskId],
    queryFn: () => dashboardApi.listTaskArtifacts(selectedTaskId),
    enabled: selectedTaskId.length > 0,
  });

  const projects = useMemo(() => normalizeProjectList(projectsQuery.data), [projectsQuery.data]);
  const workflows = useMemo(() => buildWorkflowOptions(timelineQuery.data), [timelineQuery.data]);
  const workItems = useMemo(
    () => normalizeWorkItemOptions(workItemsQuery.data),
    [workItemsQuery.data],
  );
  const tasks = useMemo(() => normalizeTaskOptions(tasksQuery.data), [tasksQuery.data]);
  const filteredTasks = useMemo(
    () => filterTasksByWorkItem(tasks, selectedWorkItemId),
    [tasks, selectedWorkItemId],
  );
  const selectedWorkflow = workflows.find((workflow) => workflow.id === selectedWorkflowId) ?? null;
  const selectedWorkItem = workItems.find((workItem) => workItem.id === selectedWorkItemId) ?? null;
  const selectedTask = filteredTasks.find((task) => task.id === selectedTaskId) ?? null;

  useEffect(() => {
    const next = new URLSearchParams();
    if (selectedProjectId) next.set('project', selectedProjectId); else next.delete('project');
    if (selectedWorkflowId) next.set('workflow', selectedWorkflowId); else next.delete('workflow');
    if (selectedWorkItemId) next.set('work_item', selectedWorkItemId); else next.delete('work_item');
    if (selectedTaskId) next.set('task', selectedTaskId); else next.delete('task');
    if (activeTab !== 'documents') next.set('tab', activeTab); else next.delete('tab');
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [activeTab, searchParams, selectedProjectId, selectedTaskId, selectedWorkflowId, selectedWorkItemId, setSearchParams]);

  useEffect(() => {
    if (workflows.length === 0) {
      setSelectedWorkflowId('');
      setSelectedWorkItemId('');
      return;
    }
    if (!workflows.some((workflow) => workflow.id === selectedWorkflowId)) {
      setSelectedWorkflowId(workflows[0].id);
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
    if (filteredTasks.length === 0) {
      setSelectedTaskId('');
      return;
    }
    if (!filteredTasks.some((task) => task.id === selectedTaskId)) {
      setSelectedTaskId(filteredTasks[0].id);
    }
  }, [filteredTasks, selectedTaskId]);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Content Browser</h1>
        <p className="text-sm text-muted-foreground">
          Browse workflow documents and work-item scoped artifacts with deep-linkable project, workflow, work item, and task filters.
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
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading projects...
              </div>
            ) : (
            <Select
                value={selectedProjectId}
                onValueChange={(value) => {
                  setSelectedProjectId(value);
                  setSelectedWorkflowId('');
                  setSelectedWorkItemId('');
                  setSelectedTaskId('');
                }}
              >
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
            <p className="text-sm text-red-600">Failed to load projects.</p>
          ) : null}

          {!selectedProjectId && !projectsQuery.isLoading ? (
            <div className="flex flex-col items-center py-8 text-muted-foreground">
              <Package className="mb-4 h-12 w-12" />
              <p className="font-medium">Select a project to browse content</p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {selectedProjectId ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Workflow Scope</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
              <div className="space-y-2">
                <label className="block text-sm font-medium">Workflow</label>
                {timelineQuery.isLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading project workflows...
                  </div>
                ) : workflows.length > 0 ? (
                  <Select value={selectedWorkflowId} onValueChange={setSelectedWorkflowId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a workflow" />
                    </SelectTrigger>
                    <SelectContent>
                      {workflows.map((workflow) => (
                        <SelectItem key={workflow.id} value={workflow.id}>
                          {workflow.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-sm text-muted-foreground">No workflows found for this project yet.</p>
                )}
                {timelineQuery.error ? (
                  <p className="text-sm text-red-600">Failed to load project workflows.</p>
                ) : null}
              </div>

              {selectedWorkflow ? (
                <div className="rounded-md border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="secondary">{selectedWorkflow.state}</Badge>
                    <Link
                      className="text-sm text-accent hover:underline"
                      to={`/work/workflows/${selectedWorkflow.id}`}
                    >
                      Open workflow
                    </Link>
                  </div>
                  <p className="mt-2 text-sm font-medium">{selectedWorkflow.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Created {new Date(selectedWorkflow.createdAt).toLocaleString()}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {workItems.length} work items • {tasks.length} tasks
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {selectedWorkflowId ? (
            <Tabs
              value={activeTab}
              onValueChange={(value) => {
                const next = new URLSearchParams(searchParams);
                if (value === 'documents') {
                  next.delete('tab');
                } else {
                  next.set('tab', value);
                }
                setSearchParams(next, { replace: true });
              }}
            >
              <TabsList>
                <TabsTrigger value="documents">Documents</TabsTrigger>
                <TabsTrigger value="artifacts">Artifacts</TabsTrigger>
              </TabsList>

              <TabsContent value="documents">
                {documentsQuery.error ? (
                  <p className="text-sm text-red-600">Failed to load workflow documents.</p>
                ) : null}
                <DocumentsTable
                  documents={documentsQuery.data ?? []}
                  isLoading={documentsQuery.isLoading}
                  workflowId={selectedWorkflowId}
                />
              </TabsContent>

              <TabsContent value="artifacts" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Execution Scope</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_240px]">
                    <div className="space-y-2">
                      <label className="block text-sm font-medium">Work item</label>
                      {workItemsQuery.isLoading ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
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
                        <p className="text-sm text-muted-foreground">No work items found for this workflow yet.</p>
                      )}
                      {workItemsQuery.error ? (
                        <p className="text-sm text-red-600">Failed to load workflow work items.</p>
                      ) : null}
                    </div>

                    <div className="space-y-2">
                      <label className="block text-sm font-medium">Task</label>
                      {tasksQuery.isLoading ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Loading workflow tasks...
                        </div>
                      ) : filteredTasks.length > 0 ? (
                        <Select value={selectedTaskId} onValueChange={setSelectedTaskId}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select a task" />
                          </SelectTrigger>
                          <SelectContent>
                            {filteredTasks.map((task) => (
                              <SelectItem key={task.id} value={task.id}>
                                {task.title}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          {selectedWorkItemId
                            ? 'No tasks found for this work item yet.'
                            : 'No tasks found for this workflow yet.'}
                        </p>
                      )}
                      {tasksQuery.error ? (
                        <p className="text-sm text-red-600">Failed to load workflow tasks.</p>
                      ) : null}
                    </div>

                    {selectedTask || selectedWorkItem ? (
                      <div className="rounded-md border p-3">
                        <div className="flex items-center justify-between gap-2">
                          <Badge variant="secondary">
                            {selectedTask?.state ?? selectedWorkItem?.columnId ?? 'scoped'}
                          </Badge>
                          {selectedTask ? (
                            <Link
                              className="text-sm text-accent hover:underline"
                              to={`/work/tasks/${selectedTask.id}`}
                            >
                              Open task
                            </Link>
                          ) : (
                            <Link
                              className="text-sm text-accent hover:underline"
                              to={`/work/workflows/${selectedWorkflowId}`}
                            >
                              Open workflow
                            </Link>
                          )}
                        </div>
                        <p className="mt-2 text-sm font-medium">
                          {selectedTask?.title ?? selectedWorkItem?.title}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {selectedTask?.stageName ?? selectedWorkItem?.stageName ?? 'No stage attached'}
                        </p>
                        {selectedTask ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {selectedTask.workItemId ? `Work item ${selectedTask.workItemId}` : 'No work item linked'}
                            {selectedTask.activationId ? ` • Activation ${selectedTask.activationId}` : ''}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </CardContent>
                </Card>

                {selectedTaskId ? (
                  <ArtifactsTable
                    artifacts={artifactsQuery.data ?? []}
                    isLoading={artifactsQuery.isLoading}
                    taskId={selectedTaskId}
                  />
                ) : (
                  <div className="flex flex-col items-center rounded-md border py-12 text-muted-foreground">
                    <FileText className="mb-3 h-10 w-10" />
                    <p className="font-medium">Select a task to browse artifacts</p>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
