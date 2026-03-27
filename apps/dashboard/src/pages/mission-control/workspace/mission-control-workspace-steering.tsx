import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { ChainWorkflowDialog } from '../../../components/chain-workflow/chain-workflow-dialog.js';
import { Badge } from '../../../components/ui/badge.js';
import { Button } from '../../../components/ui/button.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card.js';
import { Textarea } from '../../../components/ui/textarea.js';
import type {
  DashboardMissionControlActionAvailability,
  DashboardMissionControlPacket,
  DashboardWorkflowBoardResponse,
  DashboardWorkflowInputPacketRecord,
  DashboardWorkflowInterventionRecord,
  DashboardWorkflowSteeringMessageRecord,
} from '../../../lib/api.js';
import { dashboardApi } from '../../../lib/api.js';
import { buildFileUploadPayloads } from '../../../lib/file-upload.js';
import { toast } from '../../../lib/toast.js';
import { formatRelativeTimestamp } from '../../workflow-detail/workflow-detail-presentation.js';
import { WorkflowControlActions } from '../../workflow-detail/workflow-control-actions.js';
import { MissionControlFileInput } from '../mission-control-file-input.js';
import { invalidateMissionControlQueries } from '../mission-control-query.js';
import { MissionControlWorkspaceAddWorkDialog } from './mission-control-workspace-add-work-dialog.js';
import { MissionControlWorkspaceRedriveDialog } from './mission-control-workspace-redrive-dialog.js';

export function MissionControlWorkspaceSteering(props: {
  workflowId: string;
  workflowName: string;
  workflowState: string;
  workspaceId?: string | null;
  board?: DashboardWorkflowBoardResponse | null;
  activeSessionId?: string | null;
  availableActions: DashboardMissionControlActionAvailability[];
  interventionPackets: DashboardMissionControlPacket[];
  inputPackets: DashboardWorkflowInputPacketRecord[];
  interventions: DashboardWorkflowInterventionRecord[];
  steeringMessages: DashboardWorkflowSteeringMessageRecord[];
}): JSX.Element {
  const queryClient = useQueryClient();
  const [isAddWorkDialogOpen, setIsAddWorkDialogOpen] = useState(false);
  const [isRedriveDialogOpen, setIsRedriveDialogOpen] = useState(false);
  const [isChildWorkflowDialogOpen, setIsChildWorkflowDialogOpen] = useState(false);
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const actionByKind = useMemo(
    () => new Map(props.availableActions.map((entry) => [entry.kind, entry])),
    [props.availableActions],
  );
  const activeSessionId = props.activeSessionId ?? props.steeringMessages[0]?.steering_session_id ?? null;

  const submitMutation = useMutation({
    mutationFn: async () => {
      const trimmed = note.trim();
      const intervention = await dashboardApi.createWorkflowIntervention(props.workflowId, {
        kind: 'steering_instruction',
        origin: 'mission_control',
        status: 'recorded',
        summary: summarizeIntervention(trimmed),
        note: trimmed,
        files: await buildFileUploadPayloads(files),
      });
      const sessionId =
        activeSessionId
        ?? (await dashboardApi.createWorkflowSteeringSession(props.workflowId, {
          title: `${props.workflowName} steering`,
        })).id;
      await dashboardApi.appendWorkflowSteeringMessage(props.workflowId, sessionId, {
        content: trimmed,
        intervention_id: intervention.id,
      });
    },
    onSuccess: async () => {
      await invalidateMissionControlQueries(queryClient, props.workflowId, props.workspaceId ?? undefined);
      toast.success('Steering instruction recorded');
      setNote('');
      setFiles([]);
      setErrorMessage(null);
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to record steering instruction.');
    },
  });

  return (
    <>
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Quick actions</CardTitle>
            <CardDescription>Operator controls that can change workflow direction without leaving Mission Control.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <WorkflowControlActions
              workflowId={props.workflowId}
              workflowState={props.workflowState}
              workspaceId={props.workspaceId}
              additionalQueryKeys={[['mission-control']]}
            />
            <div className="flex flex-wrap gap-2">
              <ActionButton action={actionByKind.get('add_work_item')} label="Add work" onClick={() => setIsAddWorkDialogOpen(true)} />
              <ActionButton action={actionByKind.get('spawn_child_workflow')} label="Create child workflow" onClick={() => setIsChildWorkflowDialogOpen(true)} />
              <ActionButton action={actionByKind.get('redrive_workflow')} label="Redrive workflow" onClick={() => setIsRedriveDialogOpen(true)} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Workflow inputs</CardTitle>
            <CardDescription>Immutable launch and supplemental input packets currently attached to this workflow.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {props.inputPackets.length === 0 ? (
              <p className="text-sm text-muted-foreground">No workflow-scoped input packets recorded yet.</p>
            ) : (
              props.inputPackets.map((packet) => (
                <article key={packet.id} className="grid gap-2 rounded-xl border border-border/70 bg-border/10 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong>{packet.summary ?? humanizeToken(packet.packet_kind)}</strong>
                    <Badge variant="outline">{humanizeToken(packet.packet_kind)}</Badge>
                  </div>
                  {packet.files.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-2">
                      {packet.files.map((file) => (
                        <Badge key={file.id} variant="secondary">{file.file_name}</Badge>
                      ))}
                    </div>
                  ) : null}
                </article>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Steering console</CardTitle>
            <CardDescription>Record workflow-scoped guidance and attachments as durable interventions before the platform applies any explicit action.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Textarea value={note} onChange={(event) => setNote(event.target.value)} className="min-h-[128px]" placeholder="Focus on the validation path first, use the rollback guide, and hold deploy work until the release brief is approved." />
            <MissionControlFileInput
              files={files}
              onChange={setFiles}
              label="Steering attachments"
              description="Attach files to the steering instruction so they remain durable workflow intervention records."
            />
            {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}
            <div className="flex justify-end">
              <Button type="button" disabled={submitMutation.isPending || note.trim().length === 0} onClick={() => submitMutation.mutate()}>
                {submitMutation.isPending ? 'Recording...' : 'Record steering instruction'}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Intervention history</CardTitle>
            <CardDescription>Durable operator interventions, steering notes, and mission-control packets for this workflow.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {props.interventions.length === 0 && props.interventionPackets.length === 0 && props.steeringMessages.length === 0 ? (
              <p className="text-sm text-muted-foreground">No steering interventions have been recorded yet.</p>
            ) : (
              <>
                {props.interventions.map((entry) => (
                  <article key={entry.id} className="grid gap-2 rounded-xl border border-border/70 bg-border/10 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong>{entry.summary}</strong>
                      <Badge variant="warning">{humanizeToken(entry.kind)}</Badge>
                    </div>
                    {entry.note ? <p className="text-sm text-muted-foreground">{entry.note}</p> : null}
                    <span className="text-xs text-muted-foreground">{formatRelativeTimestamp(entry.created_at)}</span>
                  </article>
                ))}
                {props.steeringMessages.map((message) => (
                  <article key={message.id} className="grid gap-1 rounded-xl border border-border/70 bg-border/10 p-4">
                    <strong>{message.role === 'operator' ? 'Operator note' : humanizeToken(message.role)}</strong>
                    <p className="text-sm text-muted-foreground">{message.content}</p>
                  </article>
                ))}
                {props.interventionPackets.map((packet) => (
                  <article key={packet.id} className="grid gap-1 rounded-xl border border-border/70 bg-border/10 p-4">
                    <strong>{packet.title}</strong>
                    <p className="text-sm text-muted-foreground">{packet.summary}</p>
                  </article>
                ))}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <MissionControlWorkspaceAddWorkDialog
        isOpen={isAddWorkDialogOpen}
        onOpenChange={setIsAddWorkDialogOpen}
        workflowId={props.workflowId}
        board={props.board ?? null}
      />
      <MissionControlWorkspaceRedriveDialog
        isOpen={isRedriveDialogOpen}
        onOpenChange={setIsRedriveDialogOpen}
        workflowId={props.workflowId}
        workflowName={props.workflowName}
        workspaceId={props.workspaceId}
      />
      <ChainWorkflowDialog
        isOpen={isChildWorkflowDialogOpen}
        onOpenChange={setIsChildWorkflowDialogOpen}
        sourceWorkflowId={props.workflowId}
        defaultWorkflowName={props.workflowName}
      />
    </>
  );
}

function ActionButton(props: {
  action: DashboardMissionControlActionAvailability | undefined;
  label: string;
  onClick(): void;
}): JSX.Element {
  return (
    <Button
      type="button"
      variant="outline"
      disabled={!props.action?.enabled}
      onClick={props.onClick}
      title={props.action?.disabledReason ?? undefined}
    >
      {props.label}
    </Button>
  );
}

function summarizeIntervention(value: string): string {
  const firstSentence = value.split(/[.!?]/, 1)[0]?.trim() ?? value;
  return firstSentence.length > 0 ? firstSentence.slice(0, 160) : 'Mission Control steering instruction';
}

function humanizeToken(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}
