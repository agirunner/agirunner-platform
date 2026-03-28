import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { Badge } from '../../../components/ui/badge.js';
import { Button } from '../../../components/ui/button.js';
import { Textarea } from '../../../components/ui/textarea.js';
import type {
  DashboardWorkflowInterventionRecord,
  DashboardWorkflowSteeringMessageRecord,
} from '../../../lib/api.js';
import { dashboardApi } from '../../../lib/api.js';
import { buildFileUploadPayloads } from '../../../lib/file-upload.js';
import { toast } from '../../../lib/toast.js';
import { formatRelativeTimestamp } from '../../workflow-detail/workflow-detail-presentation.js';
import { WorkflowFileInput } from '../workflow-file-input.js';
import { invalidateWorkflowsQueries } from '../workflows-query.js';

export function WorkflowSteering(props: {
  workflowId: string;
  workflowName: string;
  selectedWorkItemId: string | null;
  interventions: DashboardWorkflowInterventionRecord[];
  messages: DashboardWorkflowSteeringMessageRecord[];
  sessionId: string | null;
  canAcceptRequest: boolean;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [request, setRequest] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const requestMutation = useMutation({
    mutationFn: async () => {
      const linkedInputPacketIds: string[] = [];
      if (files.length > 0) {
        const packet = await dashboardApi.createWorkflowInputPacket(props.workflowId, {
          packet_kind: 'supplemental',
          work_item_id: props.selectedWorkItemId ?? undefined,
          summary: props.selectedWorkItemId
            ? `Steering attachments for ${props.selectedWorkItemId}`
            : 'Workflow steering attachments',
          files: await buildFileUploadPayloads(files),
        });
        linkedInputPacketIds.push(packet.id);
      }

      return dashboardApi.createWorkflowSteeringRequest(props.workflowId, {
        request_id: crypto.randomUUID(),
        request: request.trim(),
        work_item_id: props.selectedWorkItemId ?? undefined,
        linked_input_packet_ids: linkedInputPacketIds,
        session_id: props.sessionId ?? undefined,
      });
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
          <Badge variant="outline">
            {props.selectedWorkItemId ? 'Work item scope' : 'Workflow scope'}
          </Badge>
          {props.sessionId ? <Badge variant="secondary">Open session</Badge> : null}
        </div>
        <div className="grid gap-1">
          <p className="text-sm font-semibold text-foreground">Steering request</p>
          <p className="text-sm text-muted-foreground">
            Record durable requests, responses, and attachments for the current steering scope.
          </p>
        </div>
        <Textarea
          value={request}
          onChange={(event) => setRequest(event.target.value)}
          className="min-h-[144px]"
          placeholder={`Guide ${props.workflowName} toward the next legal action.`}
        />
        <WorkflowFileInput
          files={files}
          onChange={setFiles}
          label="Steering attachments"
          description="Attach workflow-scoped files that should be referenced by the steering request."
        />
        {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}
        <div className="flex justify-end">
          <Button
            type="button"
            disabled={
              requestMutation.isPending ||
              !props.canAcceptRequest ||
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
            Review prior steering requests, responses, and interventions for this workflow scope.
          </p>
        </div>
        {historyEntries.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/70 bg-background/60 p-4 text-sm text-muted-foreground">
            No steering history exists for this workflow yet.
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

function buildSteeringHistory(
  messages: DashboardWorkflowSteeringMessageRecord[],
  interventions: DashboardWorkflowInterventionRecord[],
): SteeringHistoryEntry[] {
  const messageEntries = messages.map<SteeringHistoryEntry>((message) => ({
    id: `message:${message.id}`,
    title:
      message.headline ??
      humanizeToken(message.message_kind ?? message.source_kind ?? 'steering_message'),
    body: message.body ?? message.content ?? null,
    badge: humanizeToken(message.source_kind ?? 'operator'),
    variant: message.source_kind === 'platform' ? 'secondary' : 'outline',
    createdAt: message.created_at,
  }));
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

function humanizeToken(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}
