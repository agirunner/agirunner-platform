import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { Button } from '../../../components/ui/button.js';
import { Textarea } from '../../../components/ui/textarea.js';
import type {
  DashboardWorkflowBoardColumn,
  DashboardWorkflowInterventionRecord,
  DashboardWorkflowSteeringMessageRecord,
  DashboardWorkflowWorkItemRecord,
} from '../../../lib/api.js';
import { dashboardApi } from '../../../lib/api.js';
import { buildFileUploadPayloads } from '../../../lib/file-upload.js';
import { toast } from '../../../lib/toast.js';
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
  const normalizedScope = normalizeSteeringScope(props);
  const targetOptions = useMemo(
    () => buildWorkflowSteeringTargets({ ...props, scope: normalizedScope }),
    [
      props.boardColumns,
      normalizedScope,
      props.selectedWorkItem,
      props.selectedWorkItemId,
      props.selectedWorkItemTitle,
      props.workflowName,
      props.workflowState,
    ],
  );
  const selectedTarget = targetOptions[0] ?? null;
  const disabledReason =
    getWorkflowSteeringDisabledReason({
      canAcceptRequest: props.canAcceptRequest,
      workflowState: props.workflowState,
      boardColumns: props.boardColumns,
      target: selectedTarget,
      selectedWorkItem: props.selectedWorkItem,
    });
  const requestPlaceholder = selectedTarget
    ? `Guide ${selectedTarget.name} toward the next legal action.`
      : 'Select a work item before steering.';
  const attachmentSubject = selectedTarget?.subject ?? normalizedScope.subject;
  const shouldHideSteeringControls = disabledReason !== null;
  const unavailableSubject = selectedTarget?.subject ?? normalizedScope.subject;

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

  return (
    <div className="grid gap-3">
      {selectedTarget ? (
        <p className="text-sm text-muted-foreground">
          {selectedTarget.subject === 'work item'
            ? `Work item · ${selectedTarget.name}`
            : selectedTarget.name}
        </p>
      ) : null}
      {shouldHideSteeringControls ? (
        <div className="grid gap-1 border-l-2 border-destructive/40 pl-3">
          <p className="text-sm font-medium text-foreground">
            Steering is unavailable for this {unavailableSubject}.
          </p>
          <p className="text-sm text-destructive">{disabledReason}</p>
        </div>
      ) : (
        <>
          <label className="grid gap-2 text-sm">
            <span className="font-medium text-foreground">Operator guidance</span>
            <Textarea
              value={request}
              onChange={(event) => setRequest(event.target.value)}
              className="min-h-[144px]"
              placeholder={requestPlaceholder}
            />
          </label>
          <WorkflowFileInput
            files={files}
            onChange={setFiles}
            label="Steering attachments"
            description={`Attach files for this ${attachmentSubject} that should be referenced by the steering request.`}
          />
        </>
      )}
      {!shouldHideSteeringControls && disabledReason ? (
        <p className="text-sm text-destructive">{disabledReason}</p>
      ) : null}
      {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}
      {shouldHideSteeringControls ? null : (
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
      )}
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
  const messageEchoKeys = new Set(
    messageEntries.map((entry) => buildSteeringHistoryEchoKey(entry.title, entry.body)),
  );
  const interventionEntries = interventions
    .filter((intervention) =>
      intervention.kind !== 'steering_request'
      || !messageEchoKeys.has(buildSteeringHistoryEchoKey(intervention.summary, intervention.note)),
    )
    .map<SteeringHistoryEntry>((intervention) => ({
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

function normalizeSteeringScope(
  props: Parameters<typeof WorkflowSteering>[0],
): WorkflowWorkbenchScopeDescriptor {
  if (props.scope.scopeKind === 'workflow') {
    return props.scope;
  }
  const name =
    props.selectedWorkItemTitle
    ?? props.selectedWorkItem?.title
    ?? props.scope.name
    ?? 'Selected work item';
  return {
    scopeKind: 'selected_work_item',
    title: 'Work item',
    subject: 'work item',
    name,
    banner: `Work item: ${name}`,
  };
}

function buildSteeringHistoryEchoKey(title: string, body: string | null): string {
  return `${normalizeSteeringHistoryText(title) ?? ''}::${normalizeSteeringHistoryText(body) ?? ''}`;
}
