import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import {
  dashboardApi,
  type DashboardWorkspaceRecord,
  type DashboardResolvedDocumentReference,
} from '../../lib/api.js';
import { buildArtifactPermalink } from '../../components/artifact-preview-support.js';
import { ChainStructuredEntryEditor } from '../../components/chain-workflow-parameters.js';
import { StructuredRecordView } from '../../components/structured-data.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { Textarea } from '../../components/ui/textarea.js';
import type {
  DashboardWorkspaceMemoryEntry,
  DashboardWorkflowTaskRow,
} from './workflow-detail-support.js';
import {
  describeDocumentReference,
  describeWorkspaceMemoryEntry,
} from './workflow-detail-content-support.js';
import {
  readPacketNestedKeys,
  readPacketScalarFacts,
} from './workflow-detail-support.js';
import {
  describeReviewPacket,
  formatAbsoluteTimestamp,
  formatRelativeTimestamp,
  toStructuredDetailViewData,
} from './workflow-detail-presentation.js';
import {
  buildStructuredObject,
  type StructuredEntryDraft,
} from '../workspaces/workspace-detail/workspace-detail-support.js';
import {
  buildMetadataRecord,
  createMetadataDraft,
  createMetadataDraftsFromRecord,
  type MetadataDraft,
  type MetadataValueType,
  updateMetadataDraft,
} from '../workspaces/content-browser-metadata-support.js';
import {
  buildWorkflowDocumentCreatePayload,
  buildWorkflowDocumentUpdatePayload,
  createEmptyWorkflowDocumentDraft,
  createWorkflowDocumentDraft,
  type WorkflowDocumentDraft,
  type WorkflowDocumentField,
  validateWorkflowDocumentDraft,
} from './workflow-detail-document-support.js';
import { WorkflowSurfaceRecoveryState } from './workflow-surface-recovery-state.js';

export function WorkflowDocumentsCard(props: {
  workflowId: string;
  isLoading: boolean;
  hasError: boolean;
  onRetry?(): void;
  documents: DashboardResolvedDocumentReference[];
  tasks: DashboardWorkflowTaskRow[];
  areTasksLoading: boolean;
  hasTasksError: boolean;
}) {
  const queryClient = useQueryClient();
  const [documentMode, setDocumentMode] = useState<'create' | 'edit'>('create');
  const [editingLogicalName, setEditingLogicalName] = useState('');
  const [documentDraft, setDocumentDraft] = useState<WorkflowDocumentDraft>(
    createEmptyWorkflowDocumentDraft(),
  );
  const [documentMetadataDrafts, setDocumentMetadataDrafts] = useState<MetadataDraft[]>([]);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [documentMessage, setDocumentMessage] = useState<string | null>(null);
  const [pendingDeleteLogicalName, setPendingDeleteLogicalName] = useState<string | null>(null);
  const [touchedFields, setTouchedFields] = useState<
    Partial<Record<WorkflowDocumentField, boolean>>
  >({});
  const documentArtifactOptionsQuery = useQuery({
    queryKey: ['workflow-document-artifacts', props.workflowId, documentDraft.taskId],
    queryFn: () => dashboardApi.listTaskArtifacts(documentDraft.taskId),
    enabled:
      documentDraft.source === 'artifact' &&
      props.workflowId.length > 0 &&
      documentDraft.taskId.trim().length > 0,
  });
  const parsedMetadata = useMemo(
    () => buildMetadataRecord(documentMetadataDrafts),
    [documentMetadataDrafts],
  );
  const validation = useMemo(
    () => validateWorkflowDocumentDraft(documentDraft, parsedMetadata.error),
    [documentDraft, parsedMetadata.error],
  );
  const selectedTask =
    props.tasks.find((task) => task.id === documentDraft.taskId) ?? null;
  const documentArtifactOptions = documentArtifactOptionsQuery.data ?? [];
  const selectedDocumentArtifact =
    documentArtifactOptions.find((artifact) => artifact.id === documentDraft.artifactId) ?? null;
  const composeStatusValue = validation.isValid
    ? documentMode === 'edit'
      ? 'Ready to update'
      : 'Ready to create'
    : 'Needs review';
  const composeStatusDetail =
    documentMode === 'edit'
      ? `Editing ${editingLogicalName}. ${validation.summary}`
      : validation.summary;
  const taskScopeValue =
    documentDraft.source === 'artifact'
      ? selectedTask?.title ?? (documentDraft.taskId ? `Task ${documentDraft.taskId}` : 'Task required')
      : 'Not required';
  const taskScopeDetail =
    documentDraft.source === 'artifact'
      ? selectedDocumentArtifact
        ? `${selectedDocumentArtifact.logical_path} selected for linkage.`
        : documentDraft.logicalPath.trim()
          ? `Using manual logical path ${documentDraft.logicalPath.trim()}.`
          : props.areTasksLoading
            ? 'Loading workflow tasks for artifact linkage.'
            : 'Choose a task and artifact, or provide a logical path.'
      : 'Repository and external references do not need workflow task linkage.';

  const saveDocumentMutation = useMutation({
    mutationFn: async (
      variables:
        | {
            mode: 'create';
            draft: WorkflowDocumentDraft;
            metadata: Record<string, unknown>;
          }
        | {
            mode: 'edit';
            logicalName: string;
            draft: WorkflowDocumentDraft;
            metadata: Record<string, unknown>;
          },
    ) => {
      if (variables.mode === 'edit') {
        return dashboardApi.updateWorkflowDocument(
          props.workflowId,
          variables.logicalName,
          buildWorkflowDocumentUpdatePayload(variables.draft, variables.metadata),
        );
      }
      return dashboardApi.createWorkflowDocument(
        props.workflowId,
        buildWorkflowDocumentCreatePayload(variables.draft, variables.metadata),
      );
    },
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['workflow-documents', props.workflowId] });
      resetDocumentComposer();
      setPendingDeleteLogicalName(null);
      setDocumentError(null);
      setDocumentMessage(
        variables.mode === 'edit'
          ? `Updated workflow document '${variables.logicalName}'.`
          : `Created workflow document '${variables.draft.logicalName.trim()}'.`,
      );
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
      await dashboardApi.deleteWorkflowDocument(props.workflowId, document.logical_name);
      return document.logical_name;
    },
    onSuccess: async (logicalName) => {
      await queryClient.invalidateQueries({ queryKey: ['workflow-documents', props.workflowId] });
      if (editingLogicalName === logicalName) {
        resetDocumentComposer();
      }
      setPendingDeleteLogicalName(null);
      setDocumentError(null);
      setDocumentMessage(`Deleted workflow document '${logicalName}'.`);
    },
    onError: (error) => {
      setDocumentMessage(null);
      setDocumentError(
        error instanceof Error ? error.message : 'Failed to delete workflow document.',
      );
    },
  });

  useEffect(() => {
    resetDocumentComposer();
    setPendingDeleteLogicalName(null);
    setDocumentError(null);
    setDocumentMessage(null);
  }, [props.workflowId]);

  useEffect(() => {
    if (
      documentMode === 'edit' &&
      editingLogicalName &&
      !props.documents.some((document) => document.logical_name === editingLogicalName)
    ) {
      resetDocumentComposer();
    }
  }, [documentMode, editingLogicalName, props.documents]);

  useEffect(() => {
    if (
      pendingDeleteLogicalName &&
      !props.documents.some((document) => document.logical_name === pendingDeleteLogicalName)
    ) {
      setPendingDeleteLogicalName(null);
    }
  }, [pendingDeleteLogicalName, props.documents]);

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

  function resetDocumentComposer(): void {
    setDocumentMode('create');
    setEditingLogicalName('');
    setDocumentDraft(createEmptyWorkflowDocumentDraft());
    setDocumentMetadataDrafts([]);
    setTouchedFields({});
  }

  function markFieldTouched(field: WorkflowDocumentField): void {
    setTouchedFields((current) => (current[field] ? current : { ...current, [field]: true }));
  }

  function markInvalidFields(): void {
    setTouchedFields((current) => {
      const next = { ...current };
      for (const field of Object.keys(validation.fieldErrors) as WorkflowDocumentField[]) {
        next[field] = true;
      }
      return next;
    });
  }

  function updateDocumentDraft(patch: Partial<WorkflowDocumentDraft>): void {
    setDocumentDraft((current) => ({
      ...current,
      ...patch,
    }));
    setDocumentError(null);
    setDocumentMessage(null);
  }

  function showFieldError(field: WorkflowDocumentField): string | null {
    if (!touchedFields[field]) {
      return null;
    }
    return validation.fieldErrors[field] ?? null;
  }

  function handleDocumentSave(): void {
    const metadata = parsedMetadata.value ?? {};
    if (!validation.isValid) {
      markInvalidFields();
      setDocumentMessage(null);
      setDocumentError(validation.summary);
      return;
    }
    setDocumentError(null);
    setDocumentMessage(null);
    if (documentMode === 'edit' && editingLogicalName) {
      saveDocumentMutation.mutate({
        mode: 'edit',
        logicalName: editingLogicalName,
        draft: documentDraft,
        metadata,
      });
      return;
    }
    saveDocumentMutation.mutate({
      mode: 'create',
      draft: documentDraft,
      metadata,
    });
  }

  function handleDocumentEdit(document: DashboardResolvedDocumentReference): void {
    setDocumentMode('edit');
    setEditingLogicalName(document.logical_name);
    setDocumentDraft(createWorkflowDocumentDraft(document));
    setDocumentMetadataDrafts(createMetadataDraftsFromRecord(document.metadata ?? {}));
    setTouchedFields({});
    setPendingDeleteLogicalName(null);
    setDocumentError(null);
    setDocumentMessage(null);
  }

  function handleCancelEdit(): void {
    resetDocumentComposer();
    setPendingDeleteLogicalName(null);
    setDocumentError(null);
    setDocumentMessage(null);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Workflow Documents</CardTitle>
        <CardDescription>
          Reference material available to workers in this workflow.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <SurfaceMessage tone="default" show={props.isLoading}>
          Loading documents...
        </SurfaceMessage>
        {props.hasError ? (
          <WorkflowSurfaceRecoveryState
            title="Workflow documents are unavailable"
            detail="The board may not have published its document index yet, or the workflow-document request failed. Retry this tab before asking specialists to rely on shared reference material."
            onRetry={props.onRetry}
            actionLabel="Retry documents"
          />
        ) : null}
        {!props.isLoading && !props.hasError ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <SummaryPanel
              label="Available references"
              value={String(props.documents.length)}
              detail="Resolved documents in operator scope."
            />
            <SummaryPanel
              label="Artifact-backed"
              value={String(props.documents.filter((document) => document.artifact).length)}
              detail="Documents backed by downloadable board artifacts."
            />
          </div>
        ) : null}
        <div className="grid gap-4 rounded-xl border border-border/70 bg-gradient-to-br from-border/10 via-surface to-surface p-4 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="grid gap-1">
              <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
                Document Operator Controls
              </div>
              <div className="text-sm leading-6 text-muted">
                Create, edit, and retire workflow references without leaving the board detail
                surface.
              </div>
            </div>
            <Badge variant={documentMode === 'edit' ? 'secondary' : 'outline'}>
              {documentMode === 'edit' ? `Editing ${editingLogicalName}` : 'Create mode'}
            </Badge>
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            <SummaryPanel
              label="Compose posture"
              value={composeStatusValue}
              detail={composeStatusDetail}
            />
            <SummaryPanel
              label="Selected source"
              value={humanizeDocumentSource(documentDraft.source)}
              detail={documentDraft.source === 'artifact'
                ? 'Link an existing workflow artifact for board-native reference packets.'
                : documentDraft.source === 'external'
                  ? 'Use a validated external URL when the source lives outside the board.'
                  : 'Reference repository material already available to the operator.'}
            />
            <SummaryPanel
              label="Task linkage"
              value={taskScopeValue}
              detail={taskScopeDetail}
            />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <label className="grid gap-1.5">
              <span className="text-sm font-medium text-foreground">Logical name</span>
              <Input
                value={documentDraft.logicalName}
                disabled={documentMode === 'edit'}
                onBlur={() => markFieldTouched('logicalName')}
                onChange={(event) => updateDocumentDraft({ logicalName: event.target.value })}
                placeholder="e.g. workspace_brief"
              />
              <FieldMessage message={showFieldError('logicalName')} />
            </label>

            <label className="grid gap-1.5">
              <span className="text-sm font-medium text-foreground">Source</span>
              <Select
                value={documentDraft.source}
                onValueChange={(value) => {
                  updateDocumentDraft({
                    source: value as WorkflowDocumentDraft['source'],
                  });
                }}
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

            <label className="grid gap-1.5">
              <span className="text-sm font-medium text-foreground">Title</span>
              <Input
                value={documentDraft.title}
                onBlur={() => markFieldTouched('title')}
                onChange={(event) => updateDocumentDraft({ title: event.target.value })}
                placeholder="Visible operator title"
              />
              <FieldMessage message={showFieldError('title')} />
            </label>

            <label className="grid gap-1.5 lg:col-span-2">
              <span className="text-sm font-medium text-foreground">Description</span>
              <Textarea
                value={documentDraft.description}
                onBlur={() => markFieldTouched('description')}
                onChange={(event) => updateDocumentDraft({ description: event.target.value })}
                className="min-h-[96px]"
                placeholder="Explain what this document is for and when operators should use it."
              />
              <FieldMessage message={showFieldError('description')} />
            </label>

            {documentDraft.source === 'repository' ? (
              <>
                <label className="grid gap-1.5">
                  <span className="text-sm font-medium text-foreground">Repository</span>
                  <Input
                    value={documentDraft.repository}
                    onBlur={() => markFieldTouched('repository')}
                    onChange={(event) => updateDocumentDraft({ repository: event.target.value })}
                    placeholder="owner/repo"
                  />
                  <div className="text-xs text-muted">
                    Optional repository identifier to help operators locate the source.
                  </div>
                  <FieldMessage message={showFieldError('repository')} />
                </label>
                <label className="grid gap-1.5">
                  <span className="text-sm font-medium text-foreground">Path</span>
                  <Input
                    value={documentDraft.path}
                    onBlur={() => markFieldTouched('path')}
                    onChange={(event) => updateDocumentDraft({ path: event.target.value })}
                    placeholder="docs/brief.md"
                  />
                  <FieldMessage message={showFieldError('path')} />
                </label>
              </>
            ) : null}

            {documentDraft.source === 'external' ? (
              <label className="grid gap-1.5 lg:col-span-2">
                <span className="text-sm font-medium text-foreground">External URL</span>
                <Input
                  value={documentDraft.url}
                  onBlur={() => markFieldTouched('url')}
                  onChange={(event) => updateDocumentDraft({ url: event.target.value })}
                  placeholder="https://example.com/reference"
                />
                <FieldMessage message={showFieldError('url')} />
              </label>
            ) : null}

            {documentDraft.source === 'artifact' ? (
              <>
                <div className="grid gap-1.5">
                  <span className="text-sm font-medium text-foreground">Source task</span>
                  {props.areTasksLoading ? (
                    <p className="rounded-lg border border-dashed border-border/70 bg-border/5 px-3 py-2 text-sm text-muted">
                      Loading workflow tasks...
                    </p>
                  ) : props.tasks.length > 0 ? (
                    <Select
                      value={documentDraft.taskId || '__unset__'}
                      onValueChange={(value) => {
                        markFieldTouched('taskId');
                        updateDocumentDraft({
                          taskId: value === '__unset__' ? '' : value,
                          artifactId: '',
                          logicalPath: '',
                        });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a workflow task" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__unset__">Select a workflow task</SelectItem>
                        {props.tasks.map((task) => (
                          <SelectItem key={task.id} value={task.id}>
                            {task.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="rounded-lg border border-dashed border-border/70 bg-border/5 px-3 py-2 text-sm text-muted">
                      No workflow tasks are available yet. Run or create a task before linking an
                      artifact-backed document.
                    </p>
                  )}
                  {selectedTask ? (
                    <p className="text-xs text-muted">
                      {selectedTask.stage_name ?? 'No stage'} • {selectedTask.state}
                    </p>
                  ) : null}
                  {props.hasTasksError ? (
                    <FieldMessage message="Workflow tasks could not be loaded for artifact linkage." />
                  ) : null}
                  <FieldMessage message={showFieldError('taskId')} />
                </div>

                <div className="grid gap-1.5">
                  <span className="text-sm font-medium text-foreground">Artifact</span>
                  {documentDraft.taskId ? (
                    documentArtifactOptionsQuery.isLoading ? (
                      <p className="rounded-lg border border-dashed border-border/70 bg-border/5 px-3 py-2 text-sm text-muted">
                        Loading task artifacts...
                      </p>
                    ) : documentArtifactOptions.length > 0 ? (
                      <Select
                        value={documentDraft.artifactId || '__unset__'}
                        onValueChange={(value) => {
                          markFieldTouched('artifactReference');
                          const artifact = documentArtifactOptions.find((entry) => entry.id === value);
                          updateDocumentDraft({
                            artifactId: value === '__unset__' ? '' : value,
                            logicalPath:
                              value === '__unset__'
                                ? ''
                                : (artifact?.logical_path ?? documentDraft.logicalPath),
                          });
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select a task artifact" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__unset__">Select a task artifact</SelectItem>
                          {documentArtifactOptions.map((artifact) => (
                            <SelectItem key={artifact.id} value={artifact.id}>
                              {artifact.logical_path}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <p className="rounded-lg border border-dashed border-border/70 bg-border/5 px-3 py-2 text-sm text-muted">
                        This task has not produced any artifacts yet.
                      </p>
                    )
                  ) : (
                    <p className="rounded-lg border border-dashed border-border/70 bg-border/5 px-3 py-2 text-sm text-muted">
                      Select a source task to load artifact options.
                    </p>
                  )}
                  {selectedDocumentArtifact ? (
                    <p className="text-xs text-muted">
                      {selectedDocumentArtifact.content_type} •{' '}
                      {selectedDocumentArtifact.size_bytes.toLocaleString()} bytes
                    </p>
                  ) : null}
                  {documentArtifactOptionsQuery.error ? (
                    <FieldMessage message="Task artifacts could not be loaded for this document." />
                  ) : null}
                  <FieldMessage message={showFieldError('artifactReference')} />
                </div>

                <label className="grid gap-1.5 lg:col-span-2">
                  <span className="text-sm font-medium text-foreground">Logical path</span>
                  <Input
                    value={documentDraft.logicalPath}
                    onBlur={() => {
                      markFieldTouched('artifactReference');
                      markFieldTouched('logicalPath');
                    }}
                    onChange={(event) =>
                      updateDocumentDraft({ logicalPath: event.target.value })
                    }
                    placeholder="artifact:task-id/brief.md"
                  />
                  <div className="text-xs text-muted">
                    Auto-filled from the selected artifact. Override only when the operator-facing
                    path must differ from the stored artifact path.
                  </div>
                  <FieldMessage message={showFieldError('logicalPath')} />
                </label>
              </>
            ) : null}

            <DocumentMetadataEntryEditor
              drafts={documentMetadataDrafts}
              error={showFieldError('metadata')}
              onChange={(drafts) => {
                markFieldTouched('metadata');
                setDocumentMetadataDrafts(drafts);
                setDocumentError(null);
                setDocumentMessage(null);
              }}
            />
          </div>

          <SurfaceMessage tone="destructive" show={Boolean(documentError)}>
            {documentError}
          </SurfaceMessage>
          <SurfaceMessage tone="success" show={Boolean(documentMessage)}>
            {documentMessage}
          </SurfaceMessage>
          <div className="flex flex-wrap justify-end gap-2">
            {documentMode === 'edit' ? (
              <Button type="button" variant="outline" onClick={handleCancelEdit}>
                Cancel Edit
              </Button>
            ) : null}
            <Button
              type="button"
              onClick={handleDocumentSave}
              disabled={saveDocumentMutation.isPending}
            >
              {saveDocumentMutation.isPending
                ? 'Saving…'
                : documentMode === 'edit'
                  ? 'Save Document Changes'
                  : 'Create Workflow Document'}
            </Button>
          </div>
        </div>
        <div className="grid gap-3">
          {props.documents.map((document) => (
            <DocumentCard
              key={document.logical_name}
              document={document}
              isEditing={editingLogicalName === document.logical_name}
              isDeletePending={deleteDocumentMutation.isPending && pendingDeleteLogicalName === document.logical_name}
              showDeleteConfirmation={pendingDeleteLogicalName === document.logical_name}
              onEdit={() => handleDocumentEdit(document)}
              onDeleteRequest={() => {
                setPendingDeleteLogicalName((current) =>
                  current === document.logical_name ? null : document.logical_name,
                );
                setDocumentError(null);
                setDocumentMessage(null);
              }}
              onDeleteCancel={() => setPendingDeleteLogicalName(null)}
              onDeleteConfirm={() => deleteDocumentMutation.mutate(document)}
            />
          ))}
          {props.documents.length === 0 && !props.isLoading && !props.hasError ? (
            <ContentEmptyState
              title="No workflow documents registered yet"
              badge="Reference library empty"
              summary="Use the operator controls above to create the first workflow reference packet."
              detail="Documents become the reusable knowledge packet for this board run, including repository references, artifact-backed documents, and external links."
            />
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export function WorkspaceMemoryCard(props: {
  workspace?: DashboardWorkspaceRecord;
  entries: DashboardWorkspaceMemoryEntry[];
  isLoading: boolean;
  hasError: boolean;
  memoryKey: string;
  memoryDrafts: StructuredEntryDraft[];
  memoryError?: string | null;
  memoryMessage?: string | null;
  onMemoryKeyChange(value: string): void;
  onMemoryDraftsChange(value: StructuredEntryDraft[]): void;
  onSave(): void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Workspace Memory</CardTitle>
        <CardDescription>
          Operator-visible shared memory for future runs and workers.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <SurfaceMessage tone="default" show={props.isLoading}>
          Loading workspace memory...
        </SurfaceMessage>
        <SurfaceMessage tone="destructive" show={props.hasError}>
          Failed to load workspace memory.
        </SurfaceMessage>
        {props.workspace ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <SummaryPanel
              label="Workspace"
              value={props.workspace.name}
              detail="Shared memory propagates to future board runs and operators."
            />
            <SummaryPanel
              label="Memory entries"
              value={String(props.entries.length)}
              detail="Current operator-visible keys."
            />
          </div>
        ) : null}
        <div className="grid gap-3">
          {props.entries.map((entry) => (
            <WorkspaceMemoryEntryCard key={entry.key} entry={entry} />
          ))}
          {props.entries.length === 0 && !props.isLoading && !props.hasError ? (
            <ContentEmptyState
              title="No workspace memory recorded yet"
              badge="No shared handoff notes"
              summary="Workspace memory is still empty for this workflow family."
              detail="Write a structured memory entry below when you need future runs, child boards, or downstream operators to inherit shared context."
            />
          ) : null}
        </div>
        <div className="grid gap-4 rounded-xl border border-border/70 bg-gradient-to-br from-border/10 via-surface to-surface p-4 shadow-sm">
          <div className="grid gap-1">
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
              Memory compose
            </div>
            <div className="text-sm leading-6 text-muted">
              Add a structured workspace note for future runs, downstream child boards, and operator handoff.
            </div>
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="workspace-memory-key" className="text-sm font-medium text-foreground">
              Memory key
            </label>
            <Input
              id="workspace-memory-key"
              value={props.memoryKey}
              onChange={(event) => props.onMemoryKeyChange(event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <div className="text-sm font-medium text-foreground">Memory fields</div>
            <p className="text-xs text-muted">
              Add structured key/value memory fields instead of hand-authoring a raw JSON object.
              Use the JSON value type only when a single field needs nested object data.
            </p>
            <ChainStructuredEntryEditor
              drafts={props.memoryDrafts}
              onChange={props.onMemoryDraftsChange}
              addLabel="Add memory field"
            />
          </div>
          <MemoryDraftPreview drafts={props.memoryDrafts} />
          <SurfaceMessage tone="destructive" show={Boolean(props.memoryError)}>
            {props.memoryError}
          </SurfaceMessage>
          <SurfaceMessage tone="success" show={Boolean(props.memoryMessage)}>
            {props.memoryMessage}
          </SurfaceMessage>
          <div className="flex justify-end">
            <Button type="button" onClick={props.onSave}>
              Save Memory Entry
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function WorkspaceMemoryEntryCard(props: {
  entry: DashboardWorkspaceMemoryEntry;
}): JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);
  const packet = describeWorkspaceMemoryEntry(props.entry.value);
  const scalarFacts = readPacketScalarFacts(props.entry.value, 4);
  const nestedKeys = readPacketNestedKeys(props.entry.value, 4);

  return (
    <Card className="border-border/70 bg-border/10 shadow-none">
      <CardHeader className="gap-3 pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="grid gap-1">
            <CardTitle className="text-base">{props.entry.key}</CardTitle>
            <CardDescription>Shared operator memory entry</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">Memory</Badge>
            <Badge variant="secondary">{packet.typeLabel}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 rounded-xl border border-border/70 bg-background/80 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
          <div className="grid gap-2">
            <div className="text-sm font-semibold text-foreground">{packet.summary}</div>
            <p className="text-sm leading-6 text-muted">{packet.detail}</p>
          </div>
          {packet.badges.length > 0 ? (
            <div className="flex flex-wrap gap-2 sm:justify-end">
              {packet.badges.map((badge) => (
                <Badge key={badge} variant="outline">
                  {badge}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
        {scalarFacts.length > 0 ? (
          <FactGrid
            title="Operator-ready facts"
            description="Quick memory signals surfaced from this key before opening the full packet."
            facts={scalarFacts}
          />
        ) : null}
        {nestedKeys.length > 0 ? (
          <div className="grid gap-2 rounded-xl border border-border/70 bg-background/80 p-4">
            <div className="text-sm font-medium text-foreground">Nested sections</div>
            <div className="flex flex-wrap gap-2">
              {nestedKeys.map((key) => (
                <Badge key={`${props.entry.key}:${key}`} variant="outline">
                  {key}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}
        {packet.hasStructuredDetail ? (
          <div className="grid gap-3">
            <div className="flex justify-start">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsExpanded((current) => !current)}
              >
                {isExpanded ? 'Hide full memory packet' : 'Open full memory packet'}
              </Button>
            </div>
            {isExpanded ? (
              <StructuredRecordView data={props.entry.value} emptyMessage="No memory payload." />
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function DocumentCard(props: {
  document: DashboardResolvedDocumentReference;
  isEditing?: boolean;
  isDeletePending?: boolean;
  showDeleteConfirmation?: boolean;
  onEdit?(): void;
  onDeleteRequest?(): void;
  onDeleteCancel?(): void;
  onDeleteConfirm?(): void;
}): JSX.Element {
  const { document } = props;
  const packet = describeDocumentReference(document);
  const metadataPacket = describeReviewPacket(document.metadata, 'document metadata');
  const referenceFacts = buildDocumentFacts(document);
  const metadataFacts = readPacketScalarFacts(document.metadata, 4);
  const metadataNestedKeys = readPacketNestedKeys(document.metadata, 4);
  const artifactPreviewLink = document.artifact
    ? buildArtifactPermalink(document.artifact.task_id, document.artifact.id)
    : null;

  return (
    <Card className="border-border/70 bg-border/10 shadow-none">
      <CardHeader className="gap-3 pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="grid gap-1">
            <CardTitle className="text-base">{document.title ?? document.logical_name}</CardTitle>
            <CardDescription>{packet.summary}</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{document.scope}</Badge>
            {props.isEditing ? <Badge variant="secondary">Editing</Badge> : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid gap-3 rounded-xl border border-border/70 bg-background/80 p-4">
          <div className="grid gap-2">
            <div className="text-sm font-semibold text-foreground">{packet.summary}</div>
            <p className="text-sm leading-6 text-muted">{packet.detail}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {packet.badges.map((badge) => (
              <Badge key={badge} variant="secondary">
                {badge}
              </Badge>
            ))}
            {document.created_at ? (
              <Badge variant="outline" title={formatAbsoluteTimestamp(document.created_at)}>
                Added {formatRelativeTimestamp(document.created_at)}
              </Badge>
            ) : null}
          </div>
        </div>
        <FactGrid
          title="Reference packet facts"
          description="Source, linkage, and operator access details for this workflow document."
          facts={referenceFacts}
        />
        {packet.locationLabel ? (
          <p className="rounded-lg border border-border/60 bg-background/70 px-3 py-2 text-sm text-muted">
            {packet.locationLabel}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {artifactPreviewLink ? (
            <Button asChild variant="outline" size="sm">
              <Link to={artifactPreviewLink}>Preview Artifact Packet</Link>
            </Button>
          ) : null}
          {document.task_id ? (
            <Button asChild variant="outline" size="sm">
              <Link to={`/work/tasks/${document.task_id}`}>Open Linked Step</Link>
            </Button>
          ) : null}
          {document.url ? (
            <Button asChild variant="outline" size="sm">
              <a href={document.url} target="_blank" rel="noreferrer">
                Open External Reference
              </a>
            </Button>
          ) : null}
          {document.artifact ? (
            <Button asChild variant="outline" size="sm">
              <a href={document.artifact.download_url}>
                Download Artifact-Backed Document
              </a>
            </Button>
          ) : null}
          {props.onEdit ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={props.onEdit}
              disabled={props.isDeletePending}
            >
              {props.isEditing ? 'Editing' : 'Edit Document'}
            </Button>
          ) : null}
          {props.onDeleteRequest ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={props.onDeleteRequest}
              disabled={props.isDeletePending}
            >
              {props.isDeletePending ? 'Deleting…' : 'Delete Reference'}
            </Button>
          ) : null}
        </div>
        {props.showDeleteConfirmation ? (
          <div className="grid gap-3 rounded-xl border border-red-200 bg-red-50/80 p-4 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-100">
            <div className="grid gap-1">
              <div className="font-medium">Delete reference</div>
              <p>
                Remove <span className="font-mono">{document.logical_name}</span> from this
                workflow. This removes the workflow reference packet. Artifact files stay intact.
              </p>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {props.onDeleteCancel ? (
                <Button type="button" variant="outline" size="sm" onClick={props.onDeleteCancel}>
                  Keep Document
                </Button>
              ) : null}
              {props.onDeleteConfirm ? (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={props.onDeleteConfirm}
                  disabled={props.isDeletePending}
                >
                  {props.isDeletePending ? 'Deleting…' : 'Confirm Delete'}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
        {packet.hasMetadata ? (
          <details className="rounded-xl border border-border/70 bg-background/80 p-4">
            <summary className="cursor-pointer text-sm font-medium text-foreground">
              Open document metadata
            </summary>
            <div className="mt-3 grid gap-3">
              <div className="grid gap-2">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">{metadataPacket.typeLabel}</Badge>
                  {metadataPacket.badges.map((badge) => (
                    <Badge key={badge} variant="outline">
                      {badge}
                    </Badge>
                  ))}
                </div>
                <p className="text-sm leading-6 text-muted">{metadataPacket.detail}</p>
              </div>
              {metadataFacts.length > 0 ? (
                <FactGrid
                  title="Metadata facts"
                  description="Top-level metadata values surfaced for operator review."
                  facts={metadataFacts}
                />
              ) : null}
              {metadataNestedKeys.length > 0 ? (
                <div className="grid gap-2 rounded-xl border border-border/70 bg-surface/80 p-4">
                  <div className="text-sm font-medium text-foreground">Metadata sections</div>
                  <div className="flex flex-wrap gap-2">
                    {metadataNestedKeys.map((key) => (
                      <Badge key={`${document.logical_name}:${key}`} variant="outline">
                        {key}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}
              <StructuredRecordView
                data={toStructuredDetailViewData(document.metadata)}
                emptyMessage="No document metadata."
              />
            </div>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}

function DocumentMetadataEntryEditor(props: {
  drafts: MetadataDraft[];
  error?: string | null;
  onChange(drafts: MetadataDraft[]): void;
}): JSX.Element {
  const preview = buildMetadataRecord(props.drafts);

  return (
    <div className="grid gap-3 rounded-xl border border-dashed border-border/70 bg-background/60 p-4 lg:col-span-2">
      <div className="grid gap-1">
        <div className="text-sm font-medium text-foreground">Metadata</div>
        <p className="text-xs text-muted">
          Add structured document metadata as typed key/value entries. JSON object fields are the
          escape hatch for nested data, not the primary path.
        </p>
      </div>
      {props.drafts.length === 0 ? (
        <p className="text-sm text-muted">No metadata entries added.</p>
      ) : (
        props.drafts.map((draft) => (
          <div
            key={draft.id}
            className="grid gap-3 rounded-xl border border-border/70 bg-surface/70 p-3 md:grid-cols-[minmax(0,1fr)_160px_minmax(0,1fr)_auto]"
          >
            <label className="grid gap-1">
              <span className="text-xs font-medium text-foreground">Key</span>
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
              <span className="text-xs font-medium text-foreground">Type</span>
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
              <span className="text-xs font-medium text-foreground">Value</span>
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
      <FieldMessage message={props.error ?? preview.error} />
      <div className="flex justify-start">
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

function FieldMessage(props: { message?: string | null }): JSX.Element | null {
  if (!props.message) {
    return null;
  }

  return <p className="text-xs text-red-600 dark:text-red-300">{props.message}</p>;
}

function SurfaceMessage(props: {
  tone: 'default' | 'destructive' | 'success';
  show: boolean;
  children: ReactNode;
}): JSX.Element | null {
  if (!props.show) {
    return null;
  }

  const className =
    props.tone === 'destructive'
      ? 'rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200'
      : props.tone === 'success'
        ? 'rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200'
        : 'rounded-xl border border-dashed border-border/70 bg-border/5 px-4 py-3 text-sm text-muted';

  return <p className={className}>{props.children}</p>;
}

function MemoryDraftPreview(props: { drafts: StructuredEntryDraft[] }): JSX.Element {
  const parsed = parseMemoryDrafts(props.drafts);
  return (
    <div className="grid gap-2 rounded-md border border-border/70 bg-background/70 p-4">
      <div className="text-sm font-medium">Structured preview</div>
      {parsed.error ? (
        <p className="text-sm text-red-600">{parsed.error}</p>
      ) : (
        <StructuredRecordView data={parsed.value} emptyMessage="No memory payload." />
      )}
    </div>
  );
}

function ContentEmptyState(props: {
  title: string;
  badge: string;
  summary: string;
  detail: string;
}): JSX.Element {
  return (
    <div className="grid gap-3 rounded-xl border border-dashed border-border/70 bg-border/5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <div className="text-sm font-medium text-foreground">{props.title}</div>
          <p className="text-sm leading-6 text-muted">{props.summary}</p>
        </div>
        <Badge variant="outline">{props.badge}</Badge>
      </div>
      <p className="text-sm leading-6 text-muted">{props.detail}</p>
    </div>
  );
}

function parseMemoryDrafts(
  drafts: StructuredEntryDraft[],
): { value: Record<string, unknown> | null; error: string | null } {
  try {
    return { value: buildStructuredObject(drafts, 'Workspace memory') ?? {}, error: null };
  } catch (error) {
    return {
      value: null,
      error: error instanceof Error ? error.message : 'Memory preview contains invalid fields.',
    };
  }
}

function SummaryPanel(props: {
  label: string;
  value: string;
  detail: string;
}): JSX.Element {
  return (
    <div className="grid gap-1 rounded-xl border border-border/70 bg-border/10 p-4">
      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
        {props.label}
      </div>
      <div className="text-base font-semibold text-foreground">{props.value}</div>
      <div className="text-sm leading-6 text-muted">{props.detail}</div>
    </div>
  );
}

function humanizeDocumentSource(
  source: DashboardResolvedDocumentReference['source'],
): string {
  return source === 'repository' ? 'Repository' : source === 'artifact' ? 'Artifact' : 'External';
}

function FactGrid(props: {
  title: string;
  description: string;
  facts: Array<{ label: string; value: string }>;
}): JSX.Element {
  return (
    <div className="grid gap-3 rounded-xl border border-border/70 bg-background/80 p-4">
      <div className="grid gap-1">
        <div className="text-sm font-medium text-foreground">{props.title}</div>
        <p className="text-sm leading-6 text-muted">{props.description}</p>
      </div>
      <dl className="grid gap-2 sm:grid-cols-2">
        {props.facts.map((fact) => (
          <div
            key={`${props.title}:${fact.label}`}
            className="grid gap-1 rounded-lg border border-border/70 bg-surface px-3 py-2"
          >
            <dt className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
              {fact.label}
            </dt>
            <dd className="text-sm text-foreground">{fact.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function buildDocumentFacts(
  document: DashboardResolvedDocumentReference,
): Array<{ label: string; value: string }> {
  const facts: Array<{ label: string; value: string }> = [
    { label: 'Source', value: document.source },
    { label: 'Scope', value: document.scope },
  ];
  if (document.task_id) {
    facts.push({ label: 'Linked step', value: document.task_id });
  }
  if (document.artifact?.content_type) {
    facts.push({ label: 'Content type', value: document.artifact.content_type });
  }
  if (document.created_at) {
    facts.push({ label: 'Added', value: `Added ${formatRelativeTimestamp(document.created_at)}` });
  }
  return facts;
}
