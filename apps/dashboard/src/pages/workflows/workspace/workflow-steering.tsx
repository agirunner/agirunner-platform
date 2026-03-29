import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { Badge } from '../../../components/ui/badge.js';
import { Button } from '../../../components/ui/button.js';
import { Textarea } from '../../../components/ui/textarea.js';
import type {
  DashboardTaskRecord,
  DashboardWorkflowBoardColumn,
  DashboardWorkflowInterventionRecord,
  DashboardWorkflowSteeringMessageRecord,
  DashboardWorkflowWorkItemRecord,
} from '../../../lib/api.js';
import { dashboardApi } from '../../../lib/api.js';
import { buildFileUploadPayloads } from '../../../lib/file-upload.js';
import { toast } from '../../../lib/toast.js';
import { formatRelativeTimestamp } from '../../workflow-detail/workflow-detail-presentation.js';
import {
  buildSteeringAttachmentSummary,
  buildWorkflowSteeringRequestInput,
  buildWorkflowSteeringTargets,
  getWorkflowSteeringDisabledReason,
} from './workflow-steering.support.js';
import { WorkflowFileInput } from '../workflow-file-input.js';
import { invalidateWorkflowsQueries } from '../workflows-query.js';
import type { WorkflowWorkbenchScopeDescriptor } from '../workflows-page.support.js';
export {
  buildWorkflowSteeringRequestInput,
  buildWorkflowSteeringTargets,
  describeSteeringTargetDisabledReason,
} from './workflow-steering.support.js';

export function WorkflowSteering(props: {
  workflowId: string;
  workflowName: string;
  workflowState: string;
  boardColumns: DashboardWorkflowBoardColumn[];
  selectedWorkItemId: string | null;
  selectedWorkItemTitle: string | null;
  selectedWorkItem: DashboardWorkflowWorkItemRecord | null;
  selectedTaskId: string | null;
  selectedTaskTitle: string | null;
  selectedTask: DashboardTaskRecord | null;
  selectedWorkItemTasks: DashboardTaskRecord[];
  scope: WorkflowWorkbenchScopeDescriptor;
  interventions: DashboardWorkflowInterventionRecord[];
  messages: DashboardWorkflowSteeringMessageRecord[];
  sessionId: string | null;
  canAcceptRequest: boolean;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [request, setRequest] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const targetOptions = useMemo(
    () => buildWorkflowSteeringTargets(props),
    [
      props.boardColumns,
      props.scope,
      props.selectedTask,
      props.selectedTaskId,
      props.selectedTaskTitle,
      props.selectedWorkItem,
      props.selectedWorkItemId,
      props.selectedWorkItemTasks,
      props.selectedWorkItemTitle,
      props.workflowName,
      props.workflowState,
    ],
  );
  const isScopeLocked = props.scope.scopeKind !== 'workflow';
  const workflowTarget = targetOptions.find((option) => option.scopeKind === 'workflow') ?? null;
  const workflowScopeWorkItemTargets = targetOptions.filter(
    (option) => option.scopeKind === 'selected_work_item',
  );
  const workflowScopeTaskTargets = targetOptions.filter(
    (option) => option.scopeKind === 'selected_task',
  );
  const lockedTargetValue = isScopeLocked ? (targetOptions[0]?.value ?? '') : '';
  const initialTargetKind = isScopeLocked ? (targetOptions[0]?.scopeKind ?? 'workflow') : 'workflow';
  const initialTargetValue = isScopeLocked ? lockedTargetValue : (workflowTarget?.value ?? '');
  const [selectedTargetKind, setSelectedTargetKind] = useState<
    'workflow' | 'selected_work_item' | 'selected_task'
  >(initialTargetKind);
  const [selectedTargetValue, setSelectedTargetValue] = useState(initialTargetValue);

  useEffect(() => {
    if (isScopeLocked) {
      setSelectedTargetKind(targetOptions[0]?.scopeKind ?? 'workflow');
      setSelectedTargetValue(lockedTargetValue);
      return;
    }
    setSelectedTargetKind((currentKind) =>
      getAvailableTargetKinds({
        workflowTarget,
        workflowScopeWorkItemTargets,
        workflowScopeTaskTargets,
      }).includes(currentKind)
        ? currentKind
        : 'workflow',
    );
  }, [
    isScopeLocked,
    lockedTargetValue,
    targetOptions,
    workflowScopeTaskTargets,
    workflowScopeWorkItemTargets,
    workflowTarget,
  ]);

  useEffect(() => {
    if (isScopeLocked) {
      return;
    }
    if (selectedTargetKind === 'workflow') {
      setSelectedTargetValue(workflowTarget?.value ?? '');
      return;
    }

    const filteredTargets =
      selectedTargetKind === 'selected_work_item'
        ? workflowScopeWorkItemTargets
        : workflowScopeTaskTargets;
    setSelectedTargetValue((currentValue) =>
      filteredTargets.some((option) => option.value === currentValue) ? currentValue : '',
    );
  }, [
    isScopeLocked,
    selectedTargetKind,
    workflowScopeTaskTargets,
    workflowScopeWorkItemTargets,
    workflowTarget,
  ]);

  const selectedTarget =
    targetOptions.find((option) => option.value === selectedTargetValue) ?? null;
  const disabledReason = getWorkflowSteeringDisabledReason({
    canAcceptRequest: props.canAcceptRequest,
    workflowState: props.workflowState,
    boardColumns: props.boardColumns,
    target: selectedTarget,
    selectedWorkItem: props.selectedWorkItem,
    selectedTask: props.selectedTask,
    selectedWorkItemTasks: props.selectedWorkItemTasks,
  });
  const requestPlaceholder = selectedTarget
    ? `Guide ${selectedTarget.name} toward the next legal action.`
    : selectedTargetKind === 'selected_work_item'
      ? 'Choose a work item target above before writing a request.'
      : selectedTargetKind === 'selected_task'
        ? 'Choose a task target above before writing a request.'
        : 'Choose a steering target above before writing a request.';
  const attachmentSubject = selectedTarget?.subject ?? props.scope.subject;

  const requestMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTarget) {
        throw new Error('Choose a steering target before recording a request.');
      }
      const linkedInputPacketIds: string[] = [];
      if (files.length > 0) {
        const packet = await dashboardApi.createWorkflowInputPacket(props.workflowId, {
          packet_kind: 'supplemental',
          work_item_id: selectedTarget.workItemId ?? undefined,
          summary: buildSteeringAttachmentSummary(selectedTarget),
          files: await buildFileUploadPayloads(files),
        });
        linkedInputPacketIds.push(packet.id);
      }

      return dashboardApi.createWorkflowSteeringRequest(
        props.workflowId,
        buildWorkflowSteeringRequestInput({
          requestId: crypto.randomUUID(),
          request: request.trim(),
          sessionId: props.sessionId,
          target: selectedTarget,
          linkedInputPacketIds,
        }),
      );
    },
    onSuccess: async () => {
      await invalidateWorkflowsQueries(queryClient, props.workflowId);
      toast.success('Steering request recorded');
      setRequest('');
      setFiles([]);
      setErrorMessage(null);
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to record steering request.');
    },
  });

  const historyEntries = useMemo(
    () => buildSteeringHistory(props.messages, props.interventions),
    [props.interventions, props.messages],
  );

  return (
    <div className="grid gap-4">
      <section className="grid gap-4 rounded-2xl border border-border/70 bg-background/80 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{props.scope.banner}</Badge>
          {props.sessionId ? <Badge variant="secondary">Open session</Badge> : null}
        </div>
        <div className="grid gap-1">
          <p className="text-sm font-semibold text-foreground">Steering request</p>
          <p className="text-sm text-muted-foreground">
            Record durable requests, responses, and attachments for this {props.scope.subject}.
          </p>
        </div>
        <div className="grid gap-2">
          <div className="grid gap-1">
            <label className="text-sm font-medium text-foreground" htmlFor="workflow-steering-target">
              Steering target
            </label>
            <p className="text-sm text-muted-foreground">
              {isScopeLocked
                ? 'This steering request is locked to the current workbench scope.'
                : 'Choose where this workflow-level steering request should land.'}
            </p>
          </div>
          {isScopeLocked ? (
            <div className="rounded-md border border-border/70 bg-muted/10 px-3 py-2 text-sm text-foreground">
              {selectedTarget ? `Targeting ${selectedTarget.subject}: ${selectedTarget.name}` : 'No steering target selected.'}
            </div>
          ) : (
            <div className="grid gap-2">
              <div className="grid gap-1">
                <label className="text-sm font-medium text-foreground" htmlFor="workflow-steering-target-kind">
                  Target kind
                </label>
                <select
                  id="workflow-steering-target-kind"
                  value={selectedTargetKind}
                  className="flex h-9 w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                  onChange={(event) =>
                    setSelectedTargetKind(
                      event.target.value as 'workflow' | 'selected_work_item' | 'selected_task',
                    )
                  }
                >
                  {workflowTarget ? <option value="workflow">Workflow</option> : null}
                  {workflowScopeWorkItemTargets.length > 0 ? (
                    <option value="selected_work_item">Work item</option>
                  ) : null}
                  {workflowScopeTaskTargets.length > 0 ? <option value="selected_task">Task</option> : null}
                </select>
              </div>
              {selectedTargetKind === 'selected_work_item' ? (
                <TargetSelect
                  id="workflow-steering-target"
                  label="Specific work item"
                  placeholder="Select a work item"
                  value={selectedTargetValue}
                  options={workflowScopeWorkItemTargets}
                  onChange={setSelectedTargetValue}
                />
              ) : null}
              {selectedTargetKind === 'selected_task' ? (
                <TargetSelect
                  id="workflow-steering-target"
                  label="Specific task"
                  placeholder="Select a task"
                  value={selectedTargetValue}
                  options={workflowScopeTaskTargets}
                  onChange={setSelectedTargetValue}
                />
              ) : null}
            </div>
          )}
        </div>
        <Textarea
          value={request}
          onChange={(event) => setRequest(event.target.value)}
          className="min-h-[144px]"
          placeholder={requestPlaceholder}
        />
        <WorkflowFileInput
          files={files}
          onChange={setFiles}
          label="Steering attachments"
          description={`Attach files for this ${attachmentSubject} that should be referenced by the steering request.`}
        />
        {disabledReason ? <p className="text-sm text-destructive">{disabledReason}</p> : null}
        {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}
        <div className="flex justify-end">
          <Button
            type="button"
            disabled={
              requestMutation.isPending ||
              disabledReason !== null ||
              request.trim().length === 0
            }
            onClick={() => requestMutation.mutate()}
          >
            {requestMutation.isPending ? 'Recording…' : 'Record steering request'}
          </Button>
        </div>
      </section>

      <section className="grid gap-4 rounded-2xl border border-border/70 bg-background/80 p-4">
        <div className="grid gap-1">
          <p className="text-sm font-semibold text-foreground">Steering history</p>
          <p className="text-sm text-muted-foreground">
            Review prior steering requests, responses, and interventions for this {props.scope.subject}.
          </p>
        </div>
        {historyEntries.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/70 bg-background/60 p-4 text-sm text-muted-foreground">
            No steering history exists for this {props.scope.subject} yet.
          </div>
        ) : (
          <div className="grid gap-3">
            {historyEntries.map((entry) => (
              <article
                key={entry.id}
                className="grid gap-2 rounded-2xl border border-border/70 bg-muted/10 p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-foreground">{entry.title}</strong>
                  <Badge variant={entry.variant}>{entry.badge}</Badge>
                </div>
                {entry.body ? <p className="text-sm text-muted-foreground">{entry.body}</p> : null}
                <p className="text-xs text-muted-foreground">
                  {formatRelativeTimestamp(entry.createdAt)}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

interface SteeringHistoryEntry {
  id: string;
  title: string;
  body: string | null;
  badge: string;
  variant: 'secondary' | 'warning' | 'outline';
  createdAt: string;
}

export function buildSteeringHistory(
  messages: DashboardWorkflowSteeringMessageRecord[],
  interventions: DashboardWorkflowInterventionRecord[],
): SteeringHistoryEntry[] {
  const messageEntries = messages
    .filter((message) => !isSteeringHistoryAcknowledgement(message))
    .map<SteeringHistoryEntry>((message) => {
      const title =
        message.headline ??
        humanizeToken(message.message_kind ?? message.source_kind ?? 'steering_message');
      return {
        id: `message:${message.id}`,
        title,
        body: readSteeringHistoryBody(message, title),
        badge: humanizeToken(message.source_kind ?? 'operator'),
        variant: message.source_kind === 'platform' ? 'secondary' : 'outline',
        createdAt: message.created_at,
      };
    });
  const interventionEntries = interventions.map<SteeringHistoryEntry>((intervention) => ({
    id: `intervention:${intervention.id}`,
    title: intervention.summary,
    body: intervention.note,
    badge: humanizeToken(intervention.kind),
    variant: 'warning',
    createdAt: intervention.created_at,
  }));
  return [...messageEntries, ...interventionEntries].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
}

function isSteeringHistoryAcknowledgement(message: DashboardWorkflowSteeringMessageRecord): boolean {
  if (message.source_kind !== 'platform' || message.message_kind !== 'steering_response') {
    return false;
  }
  return [message.headline, message.body, message.content]
    .map(normalizeSteeringHistoryText)
    .includes('steering request recorded');
}

function humanizeToken(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function readSteeringHistoryBody(
  message: DashboardWorkflowSteeringMessageRecord,
  title: string,
): string | null {
  const body = readSteeringHistoryDisplayText(message.body ?? message.content ?? null);
  if (!body) {
    return null;
  }
  return normalizeSteeringHistoryText(body) === normalizeSteeringHistoryText(title) ? null : body;
}

function normalizeSteeringHistoryText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.toLowerCase() : null;
}

function readSteeringHistoryDisplayText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getAvailableTargetKinds(input: {
  workflowTarget: ReturnType<typeof buildWorkflowSteeringTargets>[number] | null;
  workflowScopeWorkItemTargets: ReturnType<typeof buildWorkflowSteeringTargets>;
  workflowScopeTaskTargets: ReturnType<typeof buildWorkflowSteeringTargets>;
}): Array<'workflow' | 'selected_work_item' | 'selected_task'> {
  const kinds: Array<'workflow' | 'selected_work_item' | 'selected_task'> = [];
  if (input.workflowTarget) {
    kinds.push('workflow');
  }
  if (input.workflowScopeWorkItemTargets.length > 0) {
    kinds.push('selected_work_item');
  }
  if (input.workflowScopeTaskTargets.length > 0) {
    kinds.push('selected_task');
  }
  return kinds;
}

function TargetSelect(props: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  options: Array<{
    value: string;
    label: string;
  }>;
  onChange(value: string): void;
}): JSX.Element {
  return (
    <div className="grid gap-1">
      <label className="text-sm font-medium text-foreground" htmlFor={props.id}>
        {props.label}
      </label>
      <select
        id={props.id}
        value={props.value}
        className="flex h-9 w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        onChange={(event) => props.onChange(event.target.value)}
      >
        <option value="">{props.placeholder}</option>
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
