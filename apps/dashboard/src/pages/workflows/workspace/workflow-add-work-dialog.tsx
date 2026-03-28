import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus } from 'lucide-react';

import { ChainStructuredEntryEditor } from '../../../components/chain-workflow/chain-workflow-parameters.js';
import { Button } from '../../../components/ui/button.js';
import {
  DEFAULT_FORM_VALIDATION_MESSAGE,
  FieldErrorText,
  FormFeedbackMessage,
  resolveFormFeedbackMessage,
} from '../../../components/forms/form-feedback.js';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../../components/ui/dialog.js';
import { Input } from '../../../components/ui/input.js';
import { Textarea } from '../../../components/ui/textarea.js';
import { dashboardApi, type DashboardWorkflowBoardResponse } from '../../../lib/api.js';
import { buildFileUploadPayloads } from '../../../lib/file-upload.js';
import { toast } from '../../../lib/toast.js';
import { buildStructuredObject, type StructuredEntryDraft } from '../../playbook-launch/playbook-launch-support.js';
import { WorkflowFileInput } from '../workflow-file-input.js';
import { invalidateWorkflowsQueries } from '../workflows-query.js';

export function WorkflowAddWorkDialog(props: {
  isOpen: boolean;
  onOpenChange(open: boolean): void;
  workflowId: string;
  lifecycle: string | null | undefined;
  board: DashboardWorkflowBoardResponse | null;
  workItemId: string | null;
}): JSX.Element {
  const queryClient = useQueryClient();
  const selectedWorkItem = useMemo(
    () =>
      props.workItemId
        ? props.board?.work_items.find((entry) => entry.id === props.workItemId) ?? null
        : null,
    [props.board, props.workItemId],
  );
  const isModifyMode = selectedWorkItem !== null;
  const [title, setTitle] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [structuredDrafts, setStructuredDrafts] = useState<StructuredEntryDraft[]>([]);
  const [steeringInstruction, setSteeringInstruction] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  useEffect(() => {
    if (!props.isOpen) {
      setTitle('');
      setFiles([]);
      setStructuredDrafts([]);
      setSteeringInstruction('');
      setErrorMessage(null);
      setHasAttemptedSubmit(false);
      return;
    }

    setTitle(selectedWorkItem?.title ?? '');
    setFiles([]);
    setStructuredDrafts([]);
    setSteeringInstruction('');
    setErrorMessage(null);
    setHasAttemptedSubmit(false);
  }, [props.isOpen, selectedWorkItem]);

  const hasSupplementalInput = structuredDrafts.some(
    (entry) => entry.key.trim().length > 0 || entry.value.trim().length > 0,
  ) || files.length > 0;
  const titleError = hasAttemptedSubmit && !isModifyMode && !title.trim() ? 'Enter a work item title.' : undefined;
  const modifyWorkError =
    hasAttemptedSubmit && isModifyMode && !hasSupplementalInput && steeringInstruction.trim().length === 0
      ? 'Add inputs, files, or a steering instruction before saving changes.'
      : undefined;
  const formFeedbackMessage = resolveFormFeedbackMessage({
    serverError: errorMessage,
    showValidation: hasAttemptedSubmit,
    isValid: isModifyMode
      ? !modifyWorkError
      : Boolean(title.trim()),
    validationMessage: DEFAULT_FORM_VALIDATION_MESSAGE,
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const structuredInputs = buildStructuredObject(structuredDrafts, 'Workflow work input');
      if (isModifyMode && selectedWorkItem) {
        const linkedInputPacketIds: string[] = [];
        if (structuredInputs || files.length > 0) {
          const packet = await dashboardApi.createWorkflowInputPacket(props.workflowId, {
            packet_kind: 'plan_update',
            work_item_id: selectedWorkItem.id,
            summary: `Inputs updated for ${selectedWorkItem.title}`,
            structured_inputs: structuredInputs,
            files: await buildFileUploadPayloads(files),
          });
          linkedInputPacketIds.push(packet.id);
        }
        if (steeringInstruction.trim().length > 0) {
          await dashboardApi.createWorkflowSteeringRequest(props.workflowId, {
            request_id: crypto.randomUUID(),
            request: steeringInstruction.trim(),
            work_item_id: selectedWorkItem.id,
            linked_input_packet_ids: linkedInputPacketIds,
          });
        }
        return selectedWorkItem;
      }

      const workItem = await dashboardApi.createWorkflowWorkItem(props.workflowId, {
        title: title.trim(),
      });
      await dashboardApi.createWorkflowInputPacket(props.workflowId, {
        packet_kind: resolvePacketKind(props.lifecycle, null),
        work_item_id: workItem.id,
        summary: buildPacketSummary(props.lifecycle, null, workItem.title),
        structured_inputs: structuredInputs,
        files: await buildFileUploadPayloads(files),
      });
      return workItem;
    },
    onSuccess: async () => {
      await invalidateWorkflowsQueries(queryClient, props.workflowId);
      toast.success(buildSuccessMessage(props.lifecycle, selectedWorkItem?.id ?? null));
      props.onOpenChange(false);
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to add workflow work.');
    },
  });

  const titleLabel = selectedWorkItem
    ? 'Modify Work'
    : props.lifecycle === 'ongoing'
      ? 'Add Intake'
      : 'Add Work';
  const description = selectedWorkItem
    ? 'Update the selected work item with new inputs, files, or a built-in steering request without leaving the workflow workspace.'
    : props.lifecycle === 'ongoing'
      ? 'Add new incoming work, files, and typed inputs into this ongoing workflow.'
      : 'Add another planned work item with the inputs and files the orchestrator should use next.';

  return (
    <Dialog open={props.isOpen} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            {titleLabel}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {isModifyMode ? (
            <section className="grid gap-2 rounded-2xl border border-border/70 bg-muted/10 p-4 text-sm">
              <strong className="text-foreground">{selectedWorkItem.title}</strong>
              <p className="text-muted-foreground">
                Add inputs, files, or steering for this work item without rewriting its core definition.
              </p>
            </section>
          ) : (
            <>
              <label className="grid gap-2 text-sm">
                <span className="font-medium">Work item title</span>
                <Input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Validation rerun"
                  aria-invalid={Boolean(titleError)}
                />
                <FieldErrorText message={titleError} />
              </label>
            </>
          )}

          <div className="grid gap-3">
            <div className="grid gap-1">
              <strong className="text-sm">{isModifyMode ? 'Editable inputs' : 'Typed inputs'}</strong>
              <p className="text-sm text-muted-foreground">
                {isModifyMode
                  ? 'These values become a durable input packet linked to the selected work item.'
                  : 'These values become a durable workflow input packet linked to the new work item.'}
              </p>
            </div>
            <ChainStructuredEntryEditor drafts={structuredDrafts} onChange={setStructuredDrafts} addLabel="Add structured input" />
          </div>

          {isModifyMode ? (
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Steering instruction</span>
              <Textarea
                value={steeringInstruction}
                onChange={(event) => setSteeringInstruction(event.target.value)}
                className="min-h-[96px]"
                placeholder="Guide the orchestrator on how this work item should proceed next."
              />
            </label>
          ) : null}

          <WorkflowFileInput
            files={files}
            onChange={setFiles}
            label="Input files"
            description="Attach immutable workflow-scoped files for this work item."
          />

          <FieldErrorText message={modifyWorkError} />
          <FormFeedbackMessage message={formFeedbackMessage} />

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={mutation.isPending}
              onClick={() => {
                if ((!isModifyMode && !title.trim()) || (isModifyMode && !hasSupplementalInput && steeringInstruction.trim().length === 0)) {
                  setHasAttemptedSubmit(true);
                  return;
                }
                mutation.mutate();
              }}
            >
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {titleLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function resolvePacketKind(lifecycle: string | null | undefined, workItemId: string | null): string {
  if (workItemId) {
    return 'plan_update';
  }
  return lifecycle === 'ongoing' ? 'intake' : 'plan_update';
}

function buildPacketSummary(
  lifecycle: string | null | undefined,
  workItemId: string | null,
  title: string,
): string {
  if (workItemId) {
    return `Plan update for ${title}`;
  }
  return lifecycle === 'ongoing' ? `Workflow intake for ${title}` : `Planned work for ${title}`;
}

function buildSuccessMessage(
  lifecycle: string | null | undefined,
  workItemId: string | null,
): string {
  if (workItemId) {
    return 'Workflow work updated';
  }
  return lifecycle === 'ongoing' ? 'Workflow intake added' : 'Workflow work added';
}
