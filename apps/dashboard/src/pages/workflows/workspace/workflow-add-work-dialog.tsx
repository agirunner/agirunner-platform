import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Trash2 } from 'lucide-react';

import { Button } from '../../../components/ui/button.js';
import { DEFAULT_FORM_VALIDATION_MESSAGE, FieldErrorText, FormFeedbackMessage, resolveFormFeedbackMessage } from '../../../components/forms/form-feedback.js';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../../components/ui/dialog.js';
import { Input } from '../../../components/ui/input.js';
import { Textarea } from '../../../components/ui/textarea.js';
import { dashboardApi, type DashboardWorkflowBoardResponse } from '../../../lib/api.js';
import { buildFileUploadPayloads } from '../../../lib/file-upload.js';
import { toast } from '../../../lib/toast.js';
import { WorkflowFileInput } from '../workflow-file-input.js';
import { invalidateWorkflowsQueries } from '../workflows-query.js';

interface WorkItemInputDraft {
  id: string;
  key: string;
  value: string;
}

export function WorkflowAddWorkDialog(props: {
  isOpen: boolean;
  onOpenChange(open: boolean): void;
  workflowId: string;
  lifecycle: string | null | undefined;
  board: DashboardWorkflowBoardResponse | null;
  workItemId: string | null;
  prefillSourceWorkItemId?: string | null;
  workflowWorkspaceId?: string | null;
}): JSX.Element {
  const queryClient = useQueryClient();
  const selectedWorkItem =
    props.workItemId ? props.board?.work_items.find((entry) => entry.id === props.workItemId) ?? null : null;
  const prefillSourceWorkItem =
    !props.workItemId && props.prefillSourceWorkItemId
      ? props.board?.work_items.find((entry) => entry.id === props.prefillSourceWorkItemId) ?? null
      : null;
  const isModifyMode = selectedWorkItem !== null;
  const [title, setTitle] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [inputDrafts, setInputDrafts] = useState<WorkItemInputDraft[]>([]);
  const [steeringInstruction, setSteeringInstruction] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  useEffect(() => {
    if (!props.isOpen) {
      setTitle('');
      setFiles([]);
      setInputDrafts([]);
      setSteeringInstruction('');
      setErrorMessage(null);
      setHasAttemptedSubmit(false);
      return;
    }
    setTitle(selectedWorkItem?.title ?? prefillSourceWorkItem?.title ?? '');
    setFiles([]);
    setInputDrafts([]);
    setSteeringInstruction('');
    setErrorMessage(null);
    setHasAttemptedSubmit(false);
  }, [prefillSourceWorkItem, props.isOpen, selectedWorkItem]);

  const hasSupplementalInput = inputDrafts.some((entry) => entry.key.trim() || entry.value.trim()) || files.length > 0;
  const titleError = hasAttemptedSubmit && !isModifyMode && !title.trim() ? 'Enter a work item title.' : undefined;
  const modifyWorkError =
    hasAttemptedSubmit && isModifyMode && !hasSupplementalInput && steeringInstruction.trim().length === 0
      ? 'Add inputs, files, or an operator note before saving changes.'
      : undefined;
  const formFeedbackMessage = resolveFormFeedbackMessage({
    serverError: errorMessage,
    showValidation: hasAttemptedSubmit,
    isValid: isModifyMode ? !modifyWorkError : Boolean(title.trim()),
    validationMessage: DEFAULT_FORM_VALIDATION_MESSAGE,
  });

  function clearFormFeedback(): void {
    setErrorMessage(null);
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const structuredInputs = buildWorkItemInputObject(inputDrafts);
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

  const titleLabel = selectedWorkItem
    ? 'Update work'
    : prefillSourceWorkItem
      ? 'Repeat work'
      : props.lifecycle === 'ongoing'
        ? 'Add intake'
        : 'Add work';
  const description = selectedWorkItem
    ? 'Add more authored inputs, files, or a note to the current work item.'
    : prefillSourceWorkItem
      ? `Start a new work item using ${prefillSourceWorkItem.title} as the source draft.`
    : props.lifecycle === 'ongoing'
      ? 'Add a new intake item with authored inputs, optional files, and an operator note.'
      : 'Add a new work item with authored inputs, optional files, and an operator note.';

  return (
    <Dialog open={props.isOpen} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Plus className="h-5 w-5" />{titleLabel}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {isModifyMode ? (
            <div className="grid gap-3">
              <p className="text-sm text-muted-foreground">
                Updating <span className="font-medium text-foreground">{selectedWorkItem.title}</span> with authored inputs, files, or a note.
              </p>
            </div>
          ) : (
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Work item title</span>
              <Input
                value={title}
                onChange={(event) => {
                  clearFormFeedback();
                  setTitle(event.target.value);
                }}
                placeholder="Validation rerun"
                aria-invalid={Boolean(titleError)}
              />
              <FieldErrorText message={titleError} />
            </label>
          )}

          <section className="grid gap-3">
            <div className="grid gap-1">
              <strong className="text-sm">Authored inputs</strong>
              <p className="text-sm text-muted-foreground">
                Add named inputs that should travel with this work item.
              </p>
            </div>
            <WorkflowAdditionalInputsEditor
              drafts={inputDrafts}
              onChange={(nextDrafts) => {
                clearFormFeedback();
                setInputDrafts(nextDrafts);
              }}
            />
          </section>

          <WorkflowFileInput
            files={files}
            onChange={(nextFiles) => {
              clearFormFeedback();
              setFiles(nextFiles);
            }}
            label="Files"
            description="Attach files that belong with this work item."
          />

          <label className="grid gap-2 text-sm">
            <span className="font-medium">Operator note</span>
            <Textarea
              value={steeringInstruction}
              onChange={(event) => {
                clearFormFeedback();
                setSteeringInstruction(event.target.value);
              }}
              rows={3}
              className="min-h-[96px]"
              placeholder="Optional note about what should happen next."
            />
          </label>
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
  drafts: WorkItemInputDraft[];
  onChange(drafts: WorkItemInputDraft[]): void;
}): JSX.Element {
  return (
    <div className="grid gap-3">
      {props.drafts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No authored inputs yet.</p>
      ) : (
        props.drafts.map((draft) => (
          <div
            key={draft.id}
            className="grid gap-3 rounded-md border border-border/70 p-3 md:grid-cols-[0.9fr,1.4fr,auto]"
          >
            <label className="grid gap-1 text-xs">
              <span className="font-medium">Input name</span>
              <Input
                value={draft.key}
                onChange={(event) =>
                  props.onChange(
                    updateWorkItemInputDraft(props.drafts, draft.id, { key: event.target.value }),
                  )
                }
              />
            </label>
            <label className="grid gap-1 text-xs">
              <span className="font-medium">Input value</span>
              <Textarea
                value={draft.value}
                rows={3}
                className="min-h-[96px]"
                onChange={(event) =>
                  props.onChange(
                    updateWorkItemInputDraft(props.drafts, draft.id, { value: event.target.value }),
                  )
                }
              />
            </label>
            <div className="flex items-end">
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={`Remove input ${draft.key || draft.id}`}
                onClick={() => props.onChange(props.drafts.filter((entry) => entry.id !== draft.id))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))
      )}
      <Button type="button" variant="outline" onClick={() => props.onChange([...props.drafts, createWorkItemInputDraft()])}>
        <Plus className="h-4 w-4" />
        Add input
      </Button>
    </div>
  );
}

function buildWorkItemInputObject(drafts: WorkItemInputDraft[]): Record<string, string> | undefined {
  const value: Record<string, string> = {};

  for (const draft of drafts) {
    const key = draft.key.trim();
    const inputValue = draft.value.trim();
    if (!key) {
      if (!inputValue) {
        continue;
      }
      throw new Error('Work item input names are required.');
    }
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      throw new Error(`Work item inputs already include '${key}'.`);
    }
    if (!inputValue) {
      throw new Error(`Work item input '${key}' must include a value.`);
    }
    value[key] = inputValue;
  }

  return Object.keys(value).length > 0 ? value : undefined;
}

function createWorkItemInputDraft(): WorkItemInputDraft {
  return {
    id: crypto.randomUUID(),
    key: '',
    value: '',
  };
}

function updateWorkItemInputDraft(
  drafts: WorkItemInputDraft[],
  id: string,
  patch: Partial<WorkItemInputDraft>,
): WorkItemInputDraft[] {
  return drafts.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft));
}
