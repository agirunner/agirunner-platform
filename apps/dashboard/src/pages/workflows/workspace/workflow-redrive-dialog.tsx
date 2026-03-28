import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, RotateCcw } from 'lucide-react';

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
import { dashboardApi } from '../../../lib/api.js';
import { buildFileUploadPayloads } from '../../../lib/file-upload.js';
import { toast } from '../../../lib/toast.js';
import { buildStructuredObject, type StructuredEntryDraft } from '../../playbook-launch/playbook-launch-support.js';
import { WorkflowFileInput } from '../workflow-file-input.js';
import { invalidateWorkflowsQueries } from '../workflows-query.js';

interface ParameterDraft {
  id: string;
  key: string;
  value: string;
}

export function WorkflowRedriveDialog(props: {
  isOpen: boolean;
  onOpenChange(open: boolean): void;
  workflowId: string;
  workflowName: string;
  workspaceId?: string | null;
  onRedriven?(workflowId: string): void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [name, setName] = useState(`${props.workflowName} redrive`);
  const [summary, setSummary] = useState('');
  const [steeringInstruction, setSteeringInstruction] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [parameterDrafts, setParameterDrafts] = useState<ParameterDraft[]>([]);
  const [structuredDrafts, setStructuredDrafts] = useState<StructuredEntryDraft[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  useEffect(() => {
    if (props.isOpen) {
      return;
    }
    setName(`${props.workflowName} redrive`);
    setSummary('');
    setSteeringInstruction('');
    setFiles([]);
    setParameterDrafts([]);
    setStructuredDrafts([]);
    setErrorMessage(null);
    setHasAttemptedSubmit(false);
  }, [props.isOpen, props.workflowName]);

  const nameError = hasAttemptedSubmit && !name.trim() ? 'Enter a new attempt name.' : undefined;
  const summaryError =
    hasAttemptedSubmit && !summary.trim() ? 'Enter a redrive summary.' : undefined;
  const formFeedbackMessage = resolveFormFeedbackMessage({
    serverError: errorMessage,
    showValidation: hasAttemptedSubmit,
    isValid: Boolean(name.trim() && summary.trim()),
    validationMessage: DEFAULT_FORM_VALIDATION_MESSAGE,
  });

  const mutation = useMutation({
    mutationFn: async () =>
      dashboardApi.redriveWorkflow(props.workflowId, {
        request_id: crypto.randomUUID(),
        name: name.trim() || undefined,
        summary: summary.trim() || undefined,
        steering_instruction: steeringInstruction.trim() || undefined,
        parameters: buildParameterRecord(parameterDrafts),
        structured_inputs: buildStructuredObject(structuredDrafts, 'Redrive input'),
        files: await buildFileUploadPayloads(files),
      }),
    onSuccess: async (result) => {
      await invalidateWorkflowsQueries(
        queryClient,
        result.workflow.id,
        result.workflow.workspace_id ?? props.workspaceId ?? undefined,
      );
      toast.success('Workflow redrive launched');
      props.onOpenChange(false);
      props.onRedriven?.(result.workflow.id);
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to redrive workflow.');
    },
  });

  return (
    <Dialog open={props.isOpen} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="h-5 w-5" />
            Redrive workflow
          </DialogTitle>
          <DialogDescription>
            Create a linked new attempt with corrected inputs, steering guidance, and inherited context.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <label className="grid gap-2 text-sm">
            <span className="font-medium">New attempt name</span>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-invalid={Boolean(nameError)}
            />
            <FieldErrorText message={nameError} />
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Redrive summary</span>
            <Textarea
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              className="min-h-[96px]"
              aria-invalid={Boolean(summaryError)}
            />
            <FieldErrorText message={summaryError} />
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Steering instruction</span>
            <Textarea value={steeringInstruction} onChange={(event) => setSteeringInstruction(event.target.value)} className="min-h-[96px]" />
          </label>

          <ParameterEditor drafts={parameterDrafts} onChange={setParameterDrafts} />

          <div className="grid gap-3 rounded-md border border-border p-4">
            <div className="grid gap-1">
              <strong className="text-sm">Structured redrive inputs</strong>
              <p className="text-sm text-muted-foreground">
                These inputs become part of the new attempt input packet and execution context.
              </p>
            </div>
            <ChainStructuredEntryEditor drafts={structuredDrafts} onChange={setStructuredDrafts} addLabel="Add structured input" />
          </div>

          <WorkflowFileInput
            files={files}
            onChange={setFiles}
            label="Redrive files"
            description="Attach corrected workflow-scoped files for the new attempt."
          />

          <FormFeedbackMessage message={formFeedbackMessage} />

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={mutation.isPending}
              onClick={() => {
                if (!name.trim() || !summary.trim()) {
                  setHasAttemptedSubmit(true);
                  return;
                }
                mutation.mutate();
              }}
            >
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Redrive
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ParameterEditor(props: {
  drafts: ParameterDraft[];
  onChange(drafts: ParameterDraft[]): void;
}): JSX.Element {
  return (
    <div className="grid gap-3 rounded-md border border-border p-4">
      <div className="grid gap-1">
        <strong className="text-sm">Parameter overrides</strong>
        <p className="text-sm text-muted-foreground">Override launch parameters on the new attempt.</p>
      </div>
      {props.drafts.map((draft) => (
        <div key={draft.id} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <Input value={draft.key} onChange={(event) => props.onChange(updateDraft(props.drafts, draft.id, 'key', event.target.value))} placeholder="Parameter key" />
          <Input value={draft.value} onChange={(event) => props.onChange(updateDraft(props.drafts, draft.id, 'value', event.target.value))} placeholder="Override value" />
          <Button type="button" variant="outline" onClick={() => props.onChange(props.drafts.filter((entry) => entry.id !== draft.id))}>
            Remove
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" onClick={() => props.onChange([...props.drafts, { id: crypto.randomUUID(), key: '', value: '' }])}>
        Add parameter override
      </Button>
    </div>
  );
}

function updateDraft(
  drafts: ParameterDraft[],
  id: string,
  field: 'key' | 'value',
  value: string,
): ParameterDraft[] {
  return drafts.map((draft) => (draft.id === id ? { ...draft, [field]: value } : draft));
}

function buildParameterRecord(drafts: ParameterDraft[]): Record<string, string> | undefined {
  const parameters: Record<string, string> = {};
  for (const draft of drafts) {
    const key = draft.key.trim();
    const value = draft.value.trim();
    if (!key && !value) {
      continue;
    }
    if (!key) {
      throw new Error('Parameter override keys are required.');
    }
    if (Object.prototype.hasOwnProperty.call(parameters, key)) {
      throw new Error(`Duplicate parameter override '${key}'.`);
    }
    parameters[key] = value;
  }
  return Object.keys(parameters).length > 0 ? parameters : undefined;
}
