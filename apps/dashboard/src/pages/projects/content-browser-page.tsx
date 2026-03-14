import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { FileText, Loader2, Package } from 'lucide-react';

import {
  dashboardApi,
  type DashboardResolvedDocumentReference,
  type DashboardTaskArtifactRecord,
  type DashboardWorkflowDocumentCreateInput,
  type DashboardWorkflowDocumentUpdateInput,
} from '../../lib/api.js';
import { buildArtifactPermalink as buildArtifactPreviewPath } from '../../components/artifact-preview-support.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs.js';
import { Textarea } from '../../components/ui/textarea.js';
import { Badge } from '../../components/ui/badge.js';
import { StructuredRecordView } from '../../components/structured-data.js';
import {
  buildWorkflowOptions,
  filterTasksByWorkItem,
  formatContentRelativeTimestamp,
  normalizeArtifactRecords,
  normalizeDocumentRecords,
  normalizeProjectList,
  normalizeTaskOptions,
  normalizeWorkItemOptions,
  summarizeArtifactExecutionScope,
  summarizeArtifactInventory,
  summarizeArtifactUploadPosture,
  summarizeDocumentInventory,
} from './project-content-browser-support.js';
import {
  buildMetadataRecord,
  createMetadataDraft,
  createMetadataDraftsFromRecord,
  type MetadataDraft,
  type MetadataValueType,
  updateMetadataDraft,
} from './content-browser-metadata-support.js';
import { ContentBrowserOverview } from './project-content-browser-presentation.js';
import { ArtifactsTable, DocumentsTable } from './project-content-tables.js';

interface ContentBrowserPageProps {
  scopedProjectId?: string;
  scopedWorkflowId?: string;
  preferredTab?: 'documents' | 'artifacts';
  showHeader?: boolean;
}

const PROJECT_DOCUMENTS_TITLE = 'Project Documents';
const PROJECT_DOCUMENTS_BREADCRUMB = 'Project documents';

export function ContentBrowserPage(): JSX.Element {
  return <ContentBrowserSurface />;
}

export function ContentBrowserSurface(props: ContentBrowserPageProps = {}): JSX.Element {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const scopedProjectId = props.scopedProjectId?.trim() ?? '';
  const scopedWorkflowId = props.scopedWorkflowId?.trim() ?? '';
  const preferredTab = props.preferredTab ?? 'documents';
  const [selectedProjectId, setSelectedProjectId] = useState(
    scopedProjectId || (searchParams.get('project') ?? ''),
  );
  const [selectedWorkflowId, setSelectedWorkflowId] = useState(
    scopedWorkflowId || (searchParams.get('workflow') ?? ''),
  );
  const [selectedWorkItemId, setSelectedWorkItemId] = useState(searchParams.get('work_item') ?? '');
  const [selectedTaskId, setSelectedTaskId] = useState(searchParams.get('task') ?? '');
  const [documentMode, setDocumentMode] = useState<'create' | 'edit'>('create');
  const [editingLogicalName, setEditingLogicalName] = useState('');
  const [documentDraft, setDocumentDraft] = useState(createEmptyDocumentDraft());
  const [documentMetadataDrafts, setDocumentMetadataDrafts] = useState<MetadataDraft[]>([]);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [documentMessage, setDocumentMessage] = useState<string | null>(null);
  const [artifactPath, setArtifactPath] = useState('');
  const [artifactContentType, setArtifactContentType] = useState('');
  const [artifactMetadataDrafts, setArtifactMetadataDrafts] = useState<MetadataDraft[]>([]);
  const [artifactFile, setArtifactFile] = useState<File | null>(null);
  const [artifactError, setArtifactError] = useState<string | null>(null);
  const [artifactMessage, setArtifactMessage] = useState<string | null>(null);
  const activeTab = searchParams.get('tab') === 'artifacts' ? 'artifacts' : preferredTab;

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
  const documentArtifactOptionsQuery = useQuery({
    queryKey: ['document-artifact-options', documentDraft.taskId],
    queryFn: () => dashboardApi.listTaskArtifacts(documentDraft.taskId),
    enabled: documentDraft.source === 'artifact' && documentDraft.taskId.length > 0,
  });

  const projects = useMemo(() => normalizeProjectList(projectsQuery.data), [projectsQuery.data]);
  const workflows = useMemo(() => buildWorkflowOptions(timelineQuery.data), [timelineQuery.data]);
  const workItems = useMemo(
    () => normalizeWorkItemOptions(workItemsQuery.data),
    [workItemsQuery.data],
  );
  const tasks = useMemo(() => normalizeTaskOptions(tasksQuery.data), [tasksQuery.data]);
  const documents = useMemo(
    () => normalizeDocumentRecords(documentsQuery.data),
    [documentsQuery.data],
  );
  const artifacts = useMemo(
    () => normalizeArtifactRecords(artifactsQuery.data),
    [artifactsQuery.data],
  );
  const documentArtifactOptions = useMemo(
    () => normalizeArtifactRecords(documentArtifactOptionsQuery.data),
    [documentArtifactOptionsQuery.data],
  );
  const filteredTasks = useMemo(
    () => filterTasksByWorkItem(tasks, selectedWorkItemId),
    [tasks, selectedWorkItemId],
  );
  const selectedWorkflow = workflows.find((workflow) => workflow.id === selectedWorkflowId) ?? null;
  const selectedWorkItem = workItems.find((workItem) => workItem.id === selectedWorkItemId) ?? null;
  const selectedTask = filteredTasks.find((task) => task.id === selectedTaskId) ?? null;
  const selectedDocumentTask = tasks.find((task) => task.id === documentDraft.taskId) ?? null;
  const selectedDocumentArtifact =
    documentArtifactOptions.find((artifact) => artifact.id === documentDraft.artifactId) ?? null;
  const parsedDocumentMetadata = useMemo(
    () => buildMetadataRecord(documentMetadataDrafts),
    [documentMetadataDrafts],
  );
  const parsedArtifactMetadata = useMemo(
    () => buildMetadataRecord(artifactMetadataDrafts),
    [artifactMetadataDrafts],
  );
  const documentSummary = useMemo(
    () => summarizeDocumentInventory(documents),
    [documents],
  );
  const artifactSummary = useMemo(
    () => summarizeArtifactInventory(artifacts),
    [artifacts],
  );
  const artifactScopeSummary = useMemo(
    () =>
      summarizeArtifactExecutionScope({
        selectedWorkflow,
        selectedWorkItem,
        selectedTask,
        filteredTaskCount: filteredTasks.length,
      }),
    [filteredTasks.length, selectedTask, selectedWorkflow, selectedWorkItem],
  );
  const artifactUploadPosture = useMemo(
    () =>
      summarizeArtifactUploadPosture({
        selectedTask,
        fileName: artifactFile?.name ?? null,
        logicalPath: artifactPath,
        metadataError: parsedArtifactMetadata.error,
      }),
    [artifactFile?.name, artifactPath, parsedArtifactMetadata.error, selectedTask],
  );
  const artifactPreviewReturnPath = useMemo(() => {
    const pathname = scopedProjectId
      ? `/projects/${scopedProjectId}/content`
      : '/projects/content';
    const search = new URLSearchParams({ tab: 'artifacts' });
    if (selectedProjectId) {
      search.set('project', selectedProjectId);
    }
    if (selectedWorkflowId) {
      search.set('workflow', selectedWorkflowId);
    }
    if (selectedWorkItemId) {
      search.set('work_item', selectedWorkItemId);
    }
    if (selectedTaskId) {
      search.set('task', selectedTaskId);
    }
    return `${pathname}?${search.toString()}`;
  }, [
    scopedProjectId,
    selectedProjectId,
    selectedTaskId,
    selectedWorkItemId,
    selectedWorkflowId,
  ]);

  useEffect(() => {
    if (scopedProjectId && selectedProjectId !== scopedProjectId) {
      setSelectedProjectId(scopedProjectId);
    }
  }, [scopedProjectId, selectedProjectId]);

  useEffect(() => {
    if (scopedWorkflowId && selectedWorkflowId !== scopedWorkflowId) {
      setSelectedWorkflowId(scopedWorkflowId);
    }
  }, [scopedWorkflowId, selectedWorkflowId]);

  const saveDocumentMutation = useMutation({
    mutationFn: async () => {
      if (!selectedWorkflowId) {
        throw new Error('Select a workflow before managing documents.');
      }
      if (!documentDraft.logicalName.trim()) {
        throw new Error('Logical name is required.');
      }
      if (parsedDocumentMetadata.error) {
        throw new Error(parsedDocumentMetadata.error);
      }

      if (documentMode === 'edit' && editingLogicalName) {
        return dashboardApi.updateWorkflowDocument(
          selectedWorkflowId,
          editingLogicalName,
          buildDocumentUpdatePayload(documentDraft, parsedDocumentMetadata.value ?? {}),
        );
      }
      return dashboardApi.createWorkflowDocument(
        selectedWorkflowId,
        buildDocumentCreatePayload(documentDraft, parsedDocumentMetadata.value ?? {}),
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['content-documents', selectedWorkflowId] });
      setDocumentError(null);
      setDocumentMessage(
        documentMode === 'edit' ? 'Updated workflow document.' : 'Created workflow document.',
      );
      setDocumentMode('create');
      setEditingLogicalName('');
      setDocumentDraft(createEmptyDocumentDraft());
      setDocumentMetadataDrafts([]);
    },
    onError: (error) => {
      setDocumentMessage(null);
      setDocumentError(
        error instanceof Error ? error.message : 'Failed to save workflow document.',
      );
    },
  });

  const deleteDocumentMutation = useMutation({
    mutationFn: async (document: DashboardResolvedDocumentReference) => {
      if (!selectedWorkflowId) {
        throw new Error('Select a workflow before deleting documents.');
      }
      await dashboardApi.deleteWorkflowDocument(selectedWorkflowId, document.logical_name);
      return document.logical_name;
    },
    onSuccess: async (logicalName) => {
      await queryClient.invalidateQueries({ queryKey: ['content-documents', selectedWorkflowId] });
      if (editingLogicalName === logicalName) {
        setDocumentMode('create');
        setEditingLogicalName('');
        setDocumentDraft(createEmptyDocumentDraft());
        setDocumentMetadataDrafts([]);
      }
      setDocumentError(null);
      setDocumentMessage('Deleted workflow document.');
    },
    onError: (error) => {
      setDocumentMessage(null);
      setDocumentError(
        error instanceof Error ? error.message : 'Failed to delete workflow document.',
      );
    },
  });

  const uploadArtifactMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTaskId) {
        throw new Error('Select a task before uploading artifacts.');
      }
      if (!artifactFile) {
        throw new Error('Choose a file to upload.');
      }
      if (!artifactPath.trim()) {
        throw new Error('Artifact path is required.');
      }
      if (parsedArtifactMetadata.error) {
        throw new Error(parsedArtifactMetadata.error);
      }
      const contentBase64 = await readFileAsBase64(artifactFile);
      return dashboardApi.uploadTaskArtifact(selectedTaskId, {
        path: artifactPath.trim(),
        content_base64: contentBase64,
        content_type: artifactContentType.trim() || artifactFile.type || undefined,
        metadata: parsedArtifactMetadata.value ?? {},
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['content-artifacts', selectedTaskId] });
      setArtifactError(null);
      setArtifactMessage('Uploaded task artifact.');
      setArtifactFile(null);
      setArtifactPath('');
      setArtifactContentType('');
      setArtifactMetadataDrafts([]);
    },
    onError: (error) => {
      setArtifactMessage(null);
      setArtifactError(error instanceof Error ? error.message : 'Failed to upload artifact.');
    },
  });

  const deleteArtifactMutation = useMutation({
    mutationFn: async (artifact: DashboardTaskArtifactRecord) => {
      await dashboardApi.deleteTaskArtifact(artifact.task_id, artifact.id);
      return artifact.id;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['content-artifacts', selectedTaskId] });
      setArtifactError(null);
      setArtifactMessage('Deleted task artifact.');
    },
    onError: (error) => {
      setArtifactMessage(null);
      setArtifactError(error instanceof Error ? error.message : 'Failed to delete artifact.');
    },
  });

  useEffect(() => {
    const next = new URLSearchParams();
    if (!scopedProjectId && selectedProjectId) next.set('project', selectedProjectId);
    else next.delete('project');
    if (!scopedWorkflowId && selectedWorkflowId) next.set('workflow', selectedWorkflowId);
    else next.delete('workflow');
    if (selectedWorkItemId) next.set('work_item', selectedWorkItemId);
    else next.delete('work_item');
    if (selectedTaskId) next.set('task', selectedTaskId);
    else next.delete('task');
    if (activeTab !== preferredTab) next.set('tab', activeTab);
    else next.delete('tab');
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [
    activeTab,
    preferredTab,
    scopedProjectId,
    scopedWorkflowId,
    searchParams,
    selectedProjectId,
    selectedTaskId,
    selectedWorkflowId,
    selectedWorkItemId,
    setSearchParams,
  ]);

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

  useEffect(() => {
    setDocumentMode('create');
    setEditingLogicalName('');
    setDocumentDraft(createEmptyDocumentDraft());
    setDocumentMetadataDrafts([]);
    setDocumentError(null);
    setDocumentMessage(null);
  }, [selectedWorkflowId]);

  useEffect(() => {
    if (documentDraft.source !== 'artifact') {
      return;
    }
    if (!documentDraft.taskId) {
      if (documentDraft.artifactId || documentDraft.logicalPath) {
        setDocumentDraft((current) => ({
          ...current,
          artifactId: '',
          logicalPath: '',
        }));
      }
      return;
    }
    if (
      documentDraft.artifactId &&
      !documentArtifactOptions.some((artifact) => artifact.id === documentDraft.artifactId)
    ) {
      setDocumentDraft((current) => ({
        ...current,
        artifactId: '',
        logicalPath: '',
      }));
    }
  }, [
    documentArtifactOptions,
    documentDraft.artifactId,
    documentDraft.logicalPath,
    documentDraft.source,
    documentDraft.taskId,
  ]);

  useEffect(() => {
    if (
      documentDraft.source !== 'artifact' ||
      !selectedDocumentArtifact ||
      documentDraft.logicalPath.trim().length > 0
    ) {
      return;
    }
    setDocumentDraft((current) => ({
      ...current,
      logicalPath: selectedDocumentArtifact.logical_path,
    }));
  }, [documentDraft.logicalPath, documentDraft.source, selectedDocumentArtifact]);

  useEffect(() => {
    setArtifactError(null);
    setArtifactMessage(null);
    setArtifactFile(null);
    setArtifactPath('');
    setArtifactContentType('');
    setArtifactMetadataDrafts([]);
  }, [selectedTaskId]);

  return (
    <div className="space-y-6 p-6">
      {props.showHeader === false ? null : (
        <div>
          <h1 className="text-2xl font-semibold">
            {scopedProjectId ? PROJECT_DOCUMENTS_TITLE : 'Content Browser'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {scopedProjectId
              ? `${PROJECT_DOCUMENTS_BREADCRUMB} keep workflow documents, artifacts, and execution filters inside the parent project scope.`
              : 'Browse workflow documents and work-item scoped artifacts with deep-linkable project, workflow, work item, and task filters.'}
          </p>
          {scopedProjectId ? (
            <div className="mt-2 flex flex-wrap gap-2 text-sm">
              <Link
                className="underline-offset-4 hover:underline"
                to={`/projects/${scopedProjectId}`}
              >
                Back to Project
              </Link>
              {selectedWorkflowId ? (
                <Link
                  className="underline-offset-4 hover:underline"
                  to={`/work/boards/${selectedWorkflowId}`}
                >
                  Open Workflow Board
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

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
                disabled={scopedProjectId.length > 0}
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

          <InlineStatusNotice
            tone="error"
            show={Boolean(projectsQuery.error)}
            title="Project scope unavailable"
            message="The dashboard could not load project options. Retry after the project list becomes available."
          />

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
                  <p className="text-sm text-muted-foreground">
                    No workflows found for this project yet.
                  </p>
                )}
                <InlineStatusNotice
                  tone="error"
                  show={Boolean(timelineQuery.error)}
                  title="Workflow scope unavailable"
                  message="The dashboard could not load workflows for this project."
                />
              </div>

              {selectedWorkflow ? (
                <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="secondary">{selectedWorkflow.state}</Badge>
                    <Link
                      className="text-sm text-accent hover:underline"
                      to={`/work/boards/${selectedWorkflow.id}`}
                    >
                      Open workflow
                    </Link>
                  </div>
                  <p className="mt-2 text-sm font-medium">{selectedWorkflow.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Created {formatContentRelativeTimestamp(selectedWorkflow.createdAt)}
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
              <ContentBrowserOverview
                activeTab={activeTab}
                workflowId={selectedWorkflowId}
                selectedWorkflow={selectedWorkflow}
                selectedWorkItem={selectedWorkItem}
                selectedTask={selectedTask}
                documentSummary={documentSummary}
                artifactSummary={artifactSummary}
              />
              <TabsList>
                <TabsTrigger value="documents">Documents</TabsTrigger>
                <TabsTrigger value="artifacts">Artifacts</TabsTrigger>
              </TabsList>

              <TabsContent value="documents">
                <InlineStatusNotice
                  tone="error"
                  show={Boolean(documentsQuery.error)}
                  title="Document inventory unavailable"
                  message="The workflow document list could not be loaded."
                />
                <Card className="mb-4">
                  <CardHeader>
                    <CardTitle>Document Operator Controls</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-4">
                    <p className="text-sm text-muted-foreground">
                      Create, edit, and delete resolved workflow references without leaving the
                      operator content browser.
                    </p>
                    <div className="grid gap-4 lg:grid-cols-2">
                      <label className="grid gap-2">
                        <span className="text-sm font-medium">Logical name</span>
                        <Input
                          value={documentDraft.logicalName}
                          disabled={documentMode === 'edit'}
                          onChange={(event) =>
                            setDocumentDraft((current) => ({
                              ...current,
                              logicalName: event.target.value,
                            }))
                          }
                          placeholder="e.g. project_brief"
                        />
                      </label>
                      <label className="grid gap-2">
                        <span className="text-sm font-medium">Source</span>
                        <Select
                          value={documentDraft.source}
                          onValueChange={(value) =>
                            setDocumentDraft((current) => ({
                              ...current,
                              source: value as DocumentDraft['source'],
                            }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="repository">Repository</SelectItem>
                            <SelectItem value="artifact">Artifact</SelectItem>
                            <SelectItem value="external">External</SelectItem>
                          </SelectContent>
                        </Select>
                      </label>
                      <label className="grid gap-2">
                        <span className="text-sm font-medium">Title</span>
                        <Input
                          value={documentDraft.title}
                          onChange={(event) =>
                            setDocumentDraft((current) => ({
                              ...current,
                              title: event.target.value,
                            }))
                          }
                          placeholder="Visible operator title"
                        />
                      </label>
                      <label className="grid gap-2">
                        <span className="text-sm font-medium">Description</span>
                        <Input
                          value={documentDraft.description}
                          onChange={(event) =>
                            setDocumentDraft((current) => ({
                              ...current,
                              description: event.target.value,
                            }))
                          }
                          placeholder="What this document is for"
                        />
                      </label>
                      {documentDraft.source === 'repository' ? (
                        <>
                          <label className="grid gap-2">
                            <span className="text-sm font-medium">Repository</span>
                            <Input
                              value={documentDraft.repository}
                              onChange={(event) =>
                                setDocumentDraft((current) => ({
                                  ...current,
                                  repository: event.target.value,
                                }))
                              }
                              placeholder="owner/repo"
                            />
                          </label>
                          <label className="grid gap-2">
                            <span className="text-sm font-medium">Path</span>
                            <Input
                              value={documentDraft.path}
                              onChange={(event) =>
                                setDocumentDraft((current) => ({
                                  ...current,
                                  path: event.target.value,
                                }))
                              }
                              placeholder="docs/brief.md"
                            />
                          </label>
                        </>
                      ) : null}
                      {documentDraft.source === 'external' ? (
                        <label className="grid gap-2 lg:col-span-2">
                          <span className="text-sm font-medium">External URL</span>
                          <Input
                            value={documentDraft.url}
                            onChange={(event) =>
                              setDocumentDraft((current) => ({
                                ...current,
                                url: event.target.value,
                              }))
                            }
                            placeholder="https://example.com/reference"
                          />
                        </label>
                      ) : null}
                      {documentDraft.source === 'artifact' ? (
                        <>
                          <label className="grid gap-2">
                            <span className="text-sm font-medium">Source task</span>
                            {tasks.length > 0 ? (
                              <Select
                                value={documentDraft.taskId || '__unset__'}
                                onValueChange={(value) =>
                                  setDocumentDraft((current) => ({
                                    ...current,
                                    taskId: value === '__unset__' ? '' : value,
                                    artifactId: '',
                                    logicalPath: '',
                                  }))
                                }
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="Select a source task" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__unset__">Select a source task</SelectItem>
                                  {tasks.map((task) => (
                                    <SelectItem key={task.id} value={task.id}>
                                      {task.title}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <p className="text-sm text-muted-foreground">
                                No workflow tasks available yet. Create or run a task before linking
                                an artifact-backed document.
                              </p>
                            )}
                            {selectedDocumentTask ? (
                              <p className="text-xs text-muted-foreground">
                                {selectedDocumentTask.stageName ?? 'No stage'} •{' '}
                                {selectedDocumentTask.state}
                              </p>
                            ) : null}
                          </label>
                          <label className="grid gap-2">
                            <span className="text-sm font-medium">Artifact</span>
                            {documentDraft.taskId ? (
                              documentArtifactOptionsQuery.isLoading ? (
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  Loading task artifacts...
                                </div>
                              ) : documentArtifactOptions.length > 0 ? (
                                <Select
                                  value={documentDraft.artifactId || '__unset__'}
                                  onValueChange={(value) =>
                                    setDocumentDraft((current) => {
                                      const artifact = documentArtifactOptions.find(
                                        (entry) => entry.id === value,
                                      );
                                      return {
                                        ...current,
                                        artifactId: value === '__unset__' ? '' : value,
                                        logicalPath:
                                          value === '__unset__'
                                            ? ''
                                            : (artifact?.logical_path ?? current.logicalPath),
                                      };
                                    })
                                  }
                                >
                                  <SelectTrigger>
                                    <SelectValue placeholder="Select an artifact" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="__unset__">Select an artifact</SelectItem>
                                    {documentArtifactOptions.map((artifact) => (
                                      <SelectItem key={artifact.id} value={artifact.id}>
                                        {artifact.logical_path}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              ) : (
                                <p className="text-sm text-muted-foreground">
                                  This task has not produced any artifacts yet.
                                </p>
                              )
                            ) : (
                              <p className="text-sm text-muted-foreground">
                                Select a source task to see artifact options.
                              </p>
                            )}
                            {selectedDocumentArtifact ? (
                              <p className="text-xs text-muted-foreground">
                                {selectedDocumentArtifact.content_type} •{' '}
                                {selectedDocumentArtifact.size_bytes.toLocaleString()} bytes
                              </p>
                            ) : null}
                            <InlineStatusNotice
                              tone="error"
                              show={Boolean(documentArtifactOptionsQuery.error)}
                              title="Artifact options unavailable"
                              message="The selected task's artifacts could not be loaded."
                            />
                          </label>
                          <label className="grid gap-2 lg:col-span-2">
                            <span className="text-sm font-medium">Logical path</span>
                            <Input
                              value={documentDraft.logicalPath}
                              onChange={(event) =>
                                setDocumentDraft((current) => ({
                                  ...current,
                                  logicalPath: event.target.value,
                                }))
                              }
                              placeholder="artifact:task-id/brief.md"
                            />
                            <p className="text-xs text-muted-foreground">
                              Auto-filled from the selected artifact. Override only if the
                              operator-facing path should differ.
                            </p>
                          </label>
                        </>
                      ) : null}
                      <MetadataEntryEditor
                        title="Metadata"
                        description="Attach structured document metadata as typed key/value entries."
                        drafts={documentMetadataDrafts}
                        onChange={setDocumentMetadataDrafts}
                      />
                    </div>
                    <InlineStatusNotice
                      tone="error"
                      show={Boolean(parsedDocumentMetadata.error)}
                      title="Metadata needs attention"
                      message={parsedDocumentMetadata.error}
                    />
                    <InlineStatusNotice
                      tone="error"
                      show={Boolean(documentError)}
                      title="Document action failed"
                      message={documentError}
                    />
                    <InlineStatusNotice
                      tone="success"
                      show={Boolean(documentMessage)}
                      title="Document action complete"
                      message={documentMessage}
                    />
                    <div className="flex flex-wrap justify-end gap-2">
                      {documentMode === 'edit' ? (
                        <Button
                          variant="outline"
                          onClick={() => {
                            setDocumentMode('create');
                            setEditingLogicalName('');
                            setDocumentDraft(createEmptyDocumentDraft());
                            setDocumentMetadataDrafts([]);
                            setDocumentError(null);
                            setDocumentMessage(null);
                          }}
                        >
                          Cancel Edit
                        </Button>
                      ) : null}
                      <Button
                        onClick={() => saveDocumentMutation.mutate()}
                        disabled={
                          saveDocumentMutation.isPending || Boolean(parsedDocumentMetadata.error)
                        }
                      >
                        {saveDocumentMutation.isPending
                          ? 'Saving…'
                          : documentMode === 'edit'
                            ? 'Save Document Changes'
                            : 'Create Workflow Document'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
                <DocumentsTable
                  documents={documents}
                  isLoading={documentsQuery.isLoading}
                  workflowId={selectedWorkflowId}
                  activeLogicalName={editingLogicalName}
                  deletingLogicalName={deleteDocumentMutation.variables?.logical_name ?? null}
                  onEdit={(document) => {
                    setDocumentMode('edit');
                    setEditingLogicalName(document.logical_name);
                    setDocumentDraft(createDocumentDraft(document));
                    setDocumentMetadataDrafts(
                      createMetadataDraftsFromRecord(document.metadata ?? {}),
                    );
                    setDocumentError(null);
                    setDocumentMessage(null);
                  }}
                  onDelete={(document) => deleteDocumentMutation.mutate(document)}
                />
              </TabsContent>

              <TabsContent value="artifacts" className="space-y-4">
                <div className="grid gap-4 xl:grid-cols-3">
                  <ArtifactFlowPacket
                    label="Execution target"
                    title={artifactScopeSummary.headline}
                    detail={artifactScopeSummary.detail}
                    helper={artifactScopeSummary.nextAction}
                    badgeLabel={
                      selectedTask
                        ? selectedTask.state
                        : selectedWorkItem
                          ? selectedWorkItem.columnId
                          : selectedWorkflow?.state ?? 'scope required'
                    }
                  />
                  <ArtifactFlowPacket
                    label="Upload readiness"
                    title={artifactUploadPosture.headline}
                    detail={artifactUploadPosture.detail}
                    helper={
                      artifactUploadPosture.blockers.length > 0
                        ? artifactUploadPosture.blockers.join(' • ')
                        : 'The upload packet is complete enough to publish from this page.'
                    }
                    badgeLabel={
                      artifactUploadPosture.isReady
                        ? 'ready'
                        : `${artifactUploadPosture.blockers.length} blocker${artifactUploadPosture.blockers.length === 1 ? '' : 's'}`
                    }
                    tone={artifactUploadPosture.isReady ? 'success' : 'warning'}
                  />
                  <ArtifactFlowPacket
                    label="Artifact inventory"
                    title={
                      selectedTask
                        ? `${artifactSummary.totalArtifacts} artifacts`
                        : 'Waiting for task scope'
                    }
                    detail={
                      selectedTask
                        ? `${artifactSummary.metadataBackedArtifacts} with metadata • ${artifactSummary.uniqueContentTypes} content types`
                        : 'Pick a task before the browser can load artifact inventory.'
                    }
                    helper={
                      selectedTask && artifactSummary.totalArtifacts > 0
                        ? `Latest artifact ${formatContentRelativeTimestamp(artifactSummary.latestCreatedAt)} • ${artifactSummary.totalBytes.toLocaleString()} bytes total`
                        : selectedTask
                          ? 'This task has not published artifacts yet.'
                          : 'Inventory updates once a task is selected.'
                    }
                    badgeLabel={selectedTask ? (selectedTask.role ?? 'unassigned role') : 'task required'}
                  />
                </div>
                <Card>
                  <CardHeader>
                    <CardTitle>Execution Scope</CardTitle>
                    <p className="text-sm text-muted-foreground">
                      Narrow artifact work to a specific board work item and execution step before
                      uploading or deleting outputs.
                    </p>
                  </CardHeader>
                  <CardContent className="grid gap-4">
                    <div className="grid gap-3 md:grid-cols-3">
                      <ArtifactScopeStep
                        label="1. Pick board scope"
                        detail={
                          selectedWorkItem
                            ? selectedWorkItem.title
                            : 'Choose a work item when you want uploads tied to one board outcome.'
                        }
                      />
                      <ArtifactScopeStep
                        label="2. Pick execution step"
                        detail={
                          selectedTask
                            ? `${selectedTask.title} • ${selectedTask.role ?? 'unassigned role'}`
                            : 'Select the task that should own the artifact packet and history.'
                        }
                      />
                      <ArtifactScopeStep
                        label="3. Publish or review"
                        detail={
                          selectedTask
                            ? 'Upload, review, or remove task outputs from the selected execution step.'
                            : 'Artifact inventory and upload controls unlock once a task is selected.'
                        }
                      />
                    </div>
                    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_240px]">
                      <div className="space-y-2">
                        <label className="block text-sm font-medium">Work item</label>
                        {workItemsQuery.isLoading ? (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Loading workflow work items...
                          </div>
                        ) : workItems.length > 0 ? (
                          <Select
                            value={selectedWorkItemId || '__all__'}
                            onValueChange={(value) =>
                              setSelectedWorkItemId(value === '__all__' ? '' : value)
                            }
                          >
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
                          <p className="text-sm text-muted-foreground">
                            No work items found for this workflow yet.
                          </p>
                        )}
                        <InlineStatusNotice
                          tone="error"
                          show={Boolean(workItemsQuery.error)}
                          title="Work-item scope unavailable"
                          message="The dashboard could not load work items for this workflow."
                        />
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
                        <InlineStatusNotice
                          tone="error"
                          show={Boolean(tasksQuery.error)}
                          title="Task scope unavailable"
                          message="The dashboard could not load tasks for this workflow."
                        />
                      </div>

                      {selectedTask || selectedWorkItem ? (
                        <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
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
                                to={`/work/boards/${selectedWorkflowId}`}
                              >
                                Open workflow
                              </Link>
                            )}
                          </div>
                          <p className="mt-2 text-sm font-medium">
                            {selectedTask?.title ?? selectedWorkItem?.title}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {selectedTask?.stageName ??
                              selectedWorkItem?.stageName ??
                              'No stage attached'}
                          </p>
                          {selectedTask ? (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {selectedTask.workItemId
                                ? `Work item ${selectedTask.workItemId}`
                                : 'No work item linked'}
                              {selectedTask.activationId
                                ? ` • Activation ${selectedTask.activationId}`
                                : ''}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>

                {selectedTaskId ? (
                  <>
                    <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_320px]">
                      <Card>
                        <CardHeader>
                          <CardTitle>Artifact Operator Controls</CardTitle>
                          <p className="text-sm text-muted-foreground">
                            Publish or remove task artifacts from the selected execution target.
                            Rename and in-place metadata editing are still outside the current
                            backend contract, so this surface focuses on clean upload packets and
                            safe delete.
                          </p>
                        </CardHeader>
                        <CardContent className="grid gap-4">
                          <div className="grid gap-4 lg:grid-cols-2">
                            <div className="grid gap-4 rounded-xl border border-border/70 bg-background/60 p-4 lg:col-span-2">
                              <div className="space-y-1">
                                <div className="text-sm font-medium text-foreground">
                                  Upload source
                                </div>
                                <p className="text-xs leading-5 text-muted-foreground">
                                  Choose the source file first. The browser will prefill the
                                  logical path and content type when it can.
                                </p>
                              </div>
                              <label className="grid gap-2">
                                <span className="text-sm font-medium">Source file</span>
                                <Input
                                  type="file"
                                  onChange={(event) => {
                                    const nextFile = event.target.files?.[0] ?? null;
                                    setArtifactFile(nextFile);
                                    if (nextFile) {
                                      setArtifactPath((current) => current || nextFile.name);
                                      setArtifactContentType(
                                        (current) => current || nextFile.type,
                                      );
                                    }
                                  }}
                                />
                              </label>
                            </div>
                            <div className="grid gap-4 rounded-xl border border-border/70 bg-background/60 p-4">
                              <div className="space-y-1">
                                <div className="text-sm font-medium text-foreground">
                                  Artifact packet
                                </div>
                                <p className="text-xs leading-5 text-muted-foreground">
                                  Name the artifact the way operators and downstream tasks should
                                  see it in the browser and review flows.
                                </p>
                              </div>
                              <label className="grid gap-2">
                                <span className="text-sm font-medium">Logical path</span>
                                <Input
                                  value={artifactPath}
                                  onChange={(event) => setArtifactPath(event.target.value)}
                                  placeholder="artifact:task-id/report.md"
                                />
                              </label>
                              <label className="grid gap-2">
                                <span className="text-sm font-medium">Content type</span>
                                <Input
                                  value={artifactContentType}
                                  onChange={(event) => setArtifactContentType(event.target.value)}
                                  placeholder="text/markdown"
                                />
                              </label>
                            </div>
                            <MetadataEntryEditor
                              title="Metadata"
                              description="Attach structured artifact metadata as typed key/value entries."
                              drafts={artifactMetadataDrafts}
                              onChange={setArtifactMetadataDrafts}
                            />
                          </div>
                          <InlineStatusNotice
                            tone="error"
                            show={Boolean(parsedArtifactMetadata.error)}
                            title="Metadata needs attention"
                            message={parsedArtifactMetadata.error}
                          />
                          <InlineStatusNotice
                            tone="error"
                            show={Boolean(artifactError)}
                            title="Artifact action failed"
                            message={artifactError}
                          />
                          <InlineStatusNotice
                            tone="success"
                            show={Boolean(artifactMessage)}
                            title="Artifact action complete"
                            message={artifactMessage}
                          />
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-sm text-muted-foreground">
                              Selected task: {selectedTask?.title ?? selectedTaskId}
                            </div>
                            <Button
                              onClick={() => uploadArtifactMutation.mutate()}
                              disabled={
                                uploadArtifactMutation.isPending ||
                                !artifactFile ||
                                artifactPath.trim().length === 0 ||
                                Boolean(parsedArtifactMetadata.error)
                              }
                            >
                              {uploadArtifactMutation.isPending ? 'Uploading…' : 'Upload Artifact'}
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                      <div className="grid gap-4 self-start">
                        <ArtifactFlowPacket
                          label="Current execution packet"
                          title={selectedTask?.title ?? selectedTaskId}
                          detail={`${selectedTask?.stageName ?? 'No stage'} • ${selectedTask?.role ?? 'unassigned role'} • ${selectedTask?.state ?? 'unknown state'}`}
                          helper={
                            selectedTask?.activationId
                              ? `Activation ${selectedTask.activationId} is currently linked to this execution step.`
                              : 'This task owns the artifact history shown below.'
                          }
                          badgeLabel={selectedTask?.state ?? 'task scoped'}
                        />
                        <Card className="border-border/70 bg-card/70 shadow-sm">
                          <CardHeader className="space-y-2">
                            <CardTitle className="text-base">Upload readiness</CardTitle>
                            <p className="text-sm text-muted-foreground">
                              Confirm the execution target, file, path, and metadata posture before
                              publishing a new artifact packet.
                            </p>
                          </CardHeader>
                          <CardContent className="grid gap-3">
                            <Badge
                              className="w-fit"
                              variant={artifactUploadPosture.isReady ? 'success' : 'warning'}
                            >
                              {artifactUploadPosture.isReady
                                ? 'Ready to upload'
                                : 'Action required'}
                            </Badge>
                            {artifactUploadPosture.blockers.length > 0 ? (
                              <ArtifactRecoveryList blockers={artifactUploadPosture.blockers} />
                            ) : (
                              <p className="text-sm text-muted-foreground">
                                The selected task, upload source, logical path, and metadata packet
                                are ready for publish.
                              </p>
                            )}
                          </CardContent>
                        </Card>
                        <Card className="border-border/70 bg-card/70 shadow-sm">
                          <CardHeader className="space-y-2">
                            <CardTitle className="text-base">Operator flow</CardTitle>
                            <p className="text-sm text-muted-foreground">
                              Use this order when the packet needs recovery or clarification.
                            </p>
                          </CardHeader>
                          <CardContent className="grid gap-3 text-sm text-muted-foreground">
                            <ArtifactFlowNote
                              title="Start with the task"
                              detail="Keep uploads attached to the execution step that produced or reviewed the output."
                            />
                            <ArtifactFlowNote
                              title="Name for downstream review"
                              detail="Logical paths should tell specialists and approvers what they are opening."
                            />
                            <ArtifactFlowNote
                              title="Add metadata when handoff matters"
                              detail="Structured metadata is the fastest way to expose provenance, retention, or review signals."
                            />
                          </CardContent>
                        </Card>
                      </div>
                    </div>
                    <ArtifactsTable
                      artifacts={artifacts}
                      isLoading={artifactsQuery.isLoading}
                      taskId={selectedTaskId}
                      buildPreviewHref={(artifact) =>
                        buildArtifactPreviewPath(artifact.task_id, artifact.id, {
                          returnTo: artifactPreviewReturnPath,
                          returnSource: 'project-content',
                        })
                      }
                      deletingArtifactId={deleteArtifactMutation.variables?.id ?? null}
                      onDelete={(artifact) => deleteArtifactMutation.mutate(artifact)}
                    />
                  </>
                ) : (
                  <div className="flex flex-col items-center rounded-xl border border-dashed border-border/70 py-12 text-center text-muted-foreground">
                    <FileText className="mb-3 h-10 w-10" />
                    <p className="font-medium">Select a task to unlock artifact management</p>
                    <p className="mt-1 max-w-md text-sm">
                      Start with workflow scope, then pick a work item and task so uploads,
                      previews, and deletes stay anchored to a real execution step.
                    </p>
                    <div className="mt-6 grid max-w-3xl gap-3 px-4 text-left md:grid-cols-3">
                      <ArtifactScopeStep
                        label="Choose board scope"
                        detail="Select the work item when artifact review should stay tied to one board outcome."
                      />
                      <ArtifactScopeStep
                        label="Choose task ownership"
                        detail="Artifact inventory and uploads attach to the task that produced or reviewed the output."
                      />
                      <ArtifactScopeStep
                        label="Review the packet"
                        detail="Once a task is selected, use the readiness packet to confirm file, path, and metadata."
                      />
                    </div>
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

interface DocumentDraft {
  logicalName: string;
  source: 'repository' | 'artifact' | 'external';
  title: string;
  description: string;
  repository: string;
  path: string;
  url: string;
  taskId: string;
  artifactId: string;
  logicalPath: string;
}

function createEmptyDocumentDraft(): DocumentDraft {
  return {
    logicalName: '',
    source: 'repository',
    title: '',
    description: '',
    repository: '',
    path: '',
    url: '',
    taskId: '',
    artifactId: '',
    logicalPath: '',
  };
}

function createDocumentDraft(document: DashboardResolvedDocumentReference): DocumentDraft {
  return {
    logicalName: document.logical_name,
    source: document.source,
    title: document.title ?? '',
    description: document.description ?? '',
    repository: document.repository ?? '',
    path: document.path ?? '',
    url: document.url ?? '',
    taskId: document.task_id ?? '',
    artifactId: document.artifact?.id ?? '',
    logicalPath: document.artifact?.logical_path ?? '',
  };
}

function buildDocumentCreatePayload(
  draft: DocumentDraft,
  metadata: Record<string, unknown>,
): DashboardWorkflowDocumentCreateInput {
  const base = {
    logical_name: draft.logicalName.trim(),
    source: draft.source,
    title: normalizeUndefinedString(draft.title),
    description: normalizeUndefinedString(draft.description),
    metadata,
  };

  if (draft.source === 'repository') {
    return {
      ...base,
      repository: normalizeUndefinedString(draft.repository),
      path: normalizeUndefinedString(draft.path),
    };
  }

  if (draft.source === 'external') {
    return {
      ...base,
      url: normalizeUndefinedString(draft.url),
    };
  }

  return {
    ...base,
    task_id: normalizeUndefinedString(draft.taskId),
    artifact_id: normalizeUndefinedString(draft.artifactId),
    logical_path: normalizeUndefinedString(draft.logicalPath),
  };
}

function buildDocumentUpdatePayload(
  draft: DocumentDraft,
  metadata: Record<string, unknown>,
): DashboardWorkflowDocumentUpdateInput {
  const base: DashboardWorkflowDocumentUpdateInput = {
    source: draft.source,
    title: normalizeNullableString(draft.title),
    description: normalizeNullableString(draft.description),
    metadata,
  };

  if (draft.source === 'repository') {
    return {
      ...base,
      repository: normalizeNullableString(draft.repository),
      path: normalizeNullableString(draft.path),
      url: null,
      task_id: null,
      artifact_id: null,
      logical_path: null,
    };
  }

  if (draft.source === 'external') {
    return {
      ...base,
      repository: null,
      path: null,
      url: normalizeNullableString(draft.url),
      task_id: null,
      artifact_id: null,
      logical_path: null,
    };
  }

  return {
    ...base,
    repository: null,
    path: null,
    url: null,
    task_id: normalizeNullableString(draft.taskId),
    artifact_id: normalizeNullableString(draft.artifactId),
    logical_path: normalizeNullableString(draft.logicalPath),
  };
}

function normalizeNullableString(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeUndefinedString(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function MetadataEntryEditor(props: {
  title: string;
  description: string;
  drafts: MetadataDraft[];
  onChange(drafts: MetadataDraft[]): void;
}) {
  const preview = buildMetadataRecord(props.drafts);
  return (
    <div className="grid gap-3 lg:col-span-2 rounded-md border border-dashed border-border/70 p-4">
      <div className="space-y-1">
        <div className="text-sm font-medium">{props.title}</div>
        <p className="text-xs text-muted-foreground">{props.description}</p>
      </div>
      {props.drafts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No metadata entries added.</p>
      ) : (
        props.drafts.map((draft) => (
          <div
            key={draft.id}
            className="grid gap-3 rounded-md border border-border/70 p-3 md:grid-cols-[1fr,160px,1fr,auto]"
          >
            <label className="grid gap-1">
              <span className="text-xs font-medium">Key</span>
              <Input
                value={draft.key}
                onChange={(event) =>
                  props.onChange(
                    updateMetadataDraft(props.drafts, draft.id, { key: event.target.value }),
                  )
                }
              />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium">Type</span>
              <Select
                value={draft.valueType}
                onValueChange={(value) =>
                  props.onChange(
                    updateMetadataDraft(props.drafts, draft.id, {
                      valueType: value as MetadataValueType,
                    }),
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="string">String</SelectItem>
                  <SelectItem value="number">Number</SelectItem>
                  <SelectItem value="boolean">Boolean</SelectItem>
                  <SelectItem value="json">JSON object</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium">Value</span>
              {draft.valueType === 'boolean' ? (
                <Select
                  value={draft.value}
                  onValueChange={(value) =>
                    props.onChange(updateMetadataDraft(props.drafts, draft.id, { value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">True</SelectItem>
                    <SelectItem value="false">False</SelectItem>
                  </SelectContent>
                </Select>
              ) : draft.valueType === 'json' ? (
                <Textarea
                  rows={4}
                  className="font-mono text-xs"
                  value={draft.value}
                  onChange={(event) =>
                    props.onChange(
                      updateMetadataDraft(props.drafts, draft.id, { value: event.target.value }),
                    )
                  }
                />
              ) : (
                <Input
                  value={draft.value}
                  onChange={(event) =>
                    props.onChange(
                      updateMetadataDraft(props.drafts, draft.id, { value: event.target.value }),
                    )
                  }
                />
              )}
            </label>
            <div className="flex items-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  props.onChange(props.drafts.filter((entry) => entry.id !== draft.id))
                }
              >
                Remove
              </Button>
            </div>
          </div>
        ))
      )}
      {preview.value ? (
        <StructuredRecordView data={preview.value} emptyMessage="No metadata entries added." />
      ) : null}
      <div className="flex justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => props.onChange([...props.drafts, createMetadataDraft()])}
        >
          Add metadata entry
        </Button>
      </div>
    </div>
  );
}

function InlineStatusNotice(props: {
  tone: 'error' | 'success';
  show: boolean;
  title: string;
  message?: string | null;
}) {
  if (!props.show || !props.message) {
    return null;
  }
  const className =
    props.tone === 'error'
      ? 'border-rose-200 bg-rose-50/80 text-rose-900'
      : 'border-emerald-200 bg-emerald-50/80 text-emerald-900';
  return (
    <div className={`rounded-md border p-3 text-sm ${className}`}>
      <div className="font-medium">{props.title}</div>
      <div className="mt-1 text-muted-foreground">{props.message}</div>
    </div>
  );
}

function ArtifactFlowPacket(props: {
  label: string;
  title: string;
  detail: string;
  helper: string;
  badgeLabel: string;
  tone?: 'default' | 'success' | 'warning';
}): JSX.Element {
  const badgeVariant =
    props.tone === 'success'
      ? 'success'
      : props.tone === 'warning'
        ? 'warning'
        : 'outline';

  return (
    <Card className="border-border/70 bg-card/70 shadow-sm">
      <CardContent className="grid gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              {props.label}
            </div>
            <div className="text-base font-semibold text-foreground">{props.title}</div>
          </div>
          <Badge variant={badgeVariant}>{props.badgeLabel}</Badge>
        </div>
        <p className="text-sm text-foreground/90">{props.detail}</p>
        <p className="text-xs leading-5 text-muted-foreground">{props.helper}</p>
      </CardContent>
    </Card>
  );
}

function ArtifactRecoveryList(props: { blockers: string[] }): JSX.Element {
  return (
    <ul className="grid gap-2 text-sm text-muted-foreground">
      {props.blockers.map((blocker) => (
        <li
          key={blocker}
          className="rounded-lg border border-amber-300/70 bg-amber-50/80 px-3 py-2 text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/20 dark:text-amber-100"
        >
          {blocker}
        </li>
      ))}
    </ul>
  );
}

function ArtifactScopeStep(props: { label: string; detail: string }): JSX.Element {
  return (
    <div className="rounded-xl border border-border/70 bg-background/60 p-4">
      <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
        {props.label}
      </div>
      <p className="mt-2 text-sm text-foreground/90">{props.detail}</p>
    </div>
  );
}

function ArtifactFlowNote(props: { title: string; detail: string }): JSX.Element {
  return (
    <div className="rounded-xl border border-border/70 bg-background/60 p-3">
      <div className="text-sm font-medium text-foreground">{props.title}</div>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{props.detail}</p>
    </div>
  );
}

async function readFileAsBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
