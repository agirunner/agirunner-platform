import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Trash2 } from 'lucide-react';

import { Button } from '../../../components/ui/button.js';
import { DEFAULT_FORM_VALIDATION_MESSAGE, FieldErrorText, FormFeedbackMessage, resolveFormFeedbackMessage } from '../../../components/forms/form-feedback.js';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../../components/ui/dialog.js';
import { Input } from '../../../components/ui/input.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select.js';
import { Textarea } from '../../../components/ui/textarea.js';
import { dashboardApi, type DashboardWorkflowBoardResponse } from '../../../lib/api.js';
import { buildFileUploadPayloads } from '../../../lib/file-upload.js';
import { toast } from '../../../lib/toast.js';
import { buildStructuredObject, createStructuredEntryDraft, type StructuredEntryDraft, type StructuredValueType } from '../../playbook-launch/playbook-launch-support.js';
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
  const selectedWorkItem =
    props.workItemId ? props.board?.work_items.find((entry) => entry.id === props.workItemId) ?? null : null;
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

  const hasSupplementalInput = structuredDrafts.some((entry) => entry.key.trim() || entry.value.trim()) || files.length > 0;
  const titleError = hasAttemptedSubmit && !isModifyMode && !title.trim() ? 'Enter a work item title.' : undefined;
  const modifyWorkError =
    hasAttemptedSubmit && isModifyMode && !hasSupplementalInput && steeringInstruction.trim().length === 0
      ? 'Add inputs, files, or a steering instruction before saving changes.'
      : undefined;
  const formFeedbackMessage = resolveFormFeedbackMessage({
    serverError: errorMessage,
    showValidation: hasAttemptedSubmit,
    isValid: isModifyMode ? !modifyWorkError : Boolean(title.trim()),
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
        if (steeringInstruction.trim()) {
          await dashboardApi.createWorkflowSteeringRequest(props.workflowId, {
            request_id: crypto.randomUUID(),
            request: steeringInstruction.trim(),
            work_item_id: selectedWorkItem.id,
            linked_input_packet_ids: linkedInputPacketIds,
          });
        }
        return selectedWorkItem;
      }

      const trimmedTitle = title.trim();
      const payload = {
        title: trimmedTitle,
        ...(structuredInputs || files.length > 0
          ? {
              initial_input_packet: {
                summary: props.lifecycle === 'ongoing' ? `Workflow intake for ${trimmedTitle}` : `Planned work for ${trimmedTitle}`,
                structured_inputs: structuredInputs ?? undefined,
                files: await buildFileUploadPayloads(files),
              },
            }
          : {}),
      };
      const workItem = await dashboardApi.createWorkflowWorkItem(props.workflowId, payload);
      if (steeringInstruction.trim()) {
        await dashboardApi.createWorkflowSteeringRequest(props.workflowId, {
          request_id: crypto.randomUUID(),
          request: steeringInstruction.trim(),
          work_item_id: workItem.id,
        });
      }
      return workItem;
    },
    onSuccess: async () => {
      await invalidateWorkflowsQueries(queryClient, props.workflowId);
      toast.success(isModifyMode ? 'Workflow work updated' : props.lifecycle === 'ongoing' ? 'Workflow intake added' : 'Workflow work added');
      props.onOpenChange(false);
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to add workflow work.');
    },
  });

  const titleLabel = selectedWorkItem ? 'Modify Work' : props.lifecycle === 'ongoing' ? 'Add Intake' : 'Add Work';
  const description = selectedWorkItem
    ? 'Add inputs, files, or an optional steering instruction for the selected work item.'
    : props.lifecycle === 'ongoing'
      ? 'Add a new intake item with optional inputs, files, and steering.'
      : 'Add a new work item with optional inputs, files, and steering.';

  return (
    <Dialog open={props.isOpen} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Plus className="h-5 w-5" />{titleLabel}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {isModifyMode ? (
            <p className="text-sm text-muted-foreground">Updating {selectedWorkItem.title}</p>
          ) : (
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Work item title</span>
              <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Validation rerun" aria-invalid={Boolean(titleError)} />
              <FieldErrorText message={titleError} />
            </label>
          )}

          <div className="grid gap-3">
            <div className="grid gap-1">
              <strong className="text-sm">Additional inputs</strong>
              <p className="text-sm text-muted-foreground">Add named values the workflow should use for this work item.</p>
            </div>
            <WorkflowAdditionalInputsEditor drafts={structuredDrafts} onChange={setStructuredDrafts} />
          </div>

          <label className="grid gap-2 text-sm">
            <span className="font-medium">Steering instruction</span>
            <Textarea
              value={steeringInstruction}
              onChange={(event) => setSteeringInstruction(event.target.value)}
              rows={3}
              className="min-h-[96px]"
              placeholder="Optional guidance for how this work should proceed next."
            />
          </label>

          <WorkflowFileInput files={files} onChange={setFiles} label="Additional input files" description="Attach immutable files that belong with this work item." />
          <FieldErrorText message={modifyWorkError} />
          <FormFeedbackMessage message={formFeedbackMessage} />

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>Cancel</Button>
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

function WorkflowAdditionalInputsEditor(props: {
  drafts: StructuredEntryDraft[];
  onChange(drafts: StructuredEntryDraft[]): void;
}): JSX.Element {
  return (
    <div className="space-y-3 rounded-md border border-dashed border-border p-3">
      {props.drafts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No additional inputs yet.</p>
      ) : (
        props.drafts.map((draft) => (
          <div key={draft.id} className="grid gap-3 rounded-md border border-border p-3 md:grid-cols-[1.1fr,0.7fr,1.2fr,auto]">
            <label className="grid gap-1 text-xs">
              <span className="font-medium">Input name</span>
              <Input value={draft.key} onChange={(event) => props.onChange(updateStructuredDraft(props.drafts, draft.id, { key: event.target.value }))} />
            </label>
            <label className="grid gap-1 text-xs">
              <span className="font-medium">Input type</span>
              <Select
                value={draft.valueType}
                onValueChange={(value) => props.onChange(updateStructuredDraft(props.drafts, draft.id, { valueType: value as StructuredValueType }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="string">String</SelectItem>
                  <SelectItem value="number">Number</SelectItem>
                  <SelectItem value="boolean">Boolean</SelectItem>
                  <SelectItem value="json">JSON</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="grid gap-1 text-xs">
              <span className="font-medium">Input value</span>
              <AdditionalInputValueField
                valueType={draft.valueType}
                value={draft.value}
                onChange={(value) => props.onChange(updateStructuredDraft(props.drafts, draft.id, { value }))}
              />
            </label>
            <div className="flex items-end">
              <Button type="button" variant="outline" size="icon" onClick={() => props.onChange(props.drafts.filter((entry) => entry.id !== draft.id))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))
      )}
      <Button type="button" variant="outline" onClick={() => props.onChange([...props.drafts, createStructuredEntryDraft()])}>
        <Plus className="h-4 w-4" />
        Add input
      </Button>
    </div>
  );
}

function AdditionalInputValueField(props: { valueType: StructuredValueType; value: string; onChange(value: string): void }): JSX.Element {
  if (props.valueType === 'boolean') {
    return (
      <Select value={props.value || '__empty__'} onValueChange={(value) => props.onChange(value === '__empty__' ? '' : value)}>
        <SelectTrigger><SelectValue placeholder="Unset" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__empty__">Unset</SelectItem>
          <SelectItem value="true">True</SelectItem>
          <SelectItem value="false">False</SelectItem>
        </SelectContent>
      </Select>
    );
  }
  if (props.valueType === 'json') {
    return <Textarea value={props.value} rows={4} className="min-h-[96px] font-mono text-xs" onChange={(event) => props.onChange(event.target.value)} />;
  }
  if (props.valueType === 'string') {
    return <Textarea value={props.value} rows={2} className="min-h-[64px]" onChange={(event) => props.onChange(event.target.value)} />;
  }
  return <Input type="number" value={props.value} onChange={(event) => props.onChange(event.target.value)} />;
}

function updateStructuredDraft(
  drafts: StructuredEntryDraft[],
  id: string,
  patch: Partial<StructuredEntryDraft>,
): StructuredEntryDraft[] {
  return drafts.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft));
}
