import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, RotateCcw } from 'lucide-react';

import { Button } from '../../../components/ui/button.js';
import {
  DEFAULT_FORM_VALIDATION_MESSAGE,
  FieldErrorText,
  FormFeedbackMessage,
  resolveFormFeedbackMessage,
} from '../../../components/forms/form-feedback.js';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../../components/ui/dialog.js';
import { Textarea } from '../../../components/ui/textarea.js';
import { dashboardApi } from '../../../lib/api.js';
import { buildFileUploadPayloads } from '../../../lib/file-upload.js';
import { toast } from '../../../lib/toast.js';
import { WorkflowFileInput } from '../workflow-file-input.js';
import { invalidateWorkflowsQueries } from '../workflows-query.js';

export function WorkflowRedriveDialog(props: {
  isOpen: boolean;
  onOpenChange(open: boolean): void;
  workflowId: string;
  workflowName: string;
  workspaceId?: string | null;
  onRedriven?(workflowId: string): void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [summary, setSummary] = useState('');
  const [steeringInstruction, setSteeringInstruction] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  useEffect(() => {
    if (props.isOpen) {
      return;
    }
    setSummary('');
    setSteeringInstruction('');
    setFiles([]);
    setErrorMessage(null);
    setHasAttemptedSubmit(false);
  }, [props.isOpen]);

  const summaryError =
    hasAttemptedSubmit && !summary.trim() ? 'Enter a redrive summary.' : undefined;
  const formFeedbackMessage = resolveFormFeedbackMessage({
    serverError: errorMessage,
    showValidation: hasAttemptedSubmit,
    isValid: Boolean(summary.trim()),
    validationMessage: DEFAULT_FORM_VALIDATION_MESSAGE,
  });

  const mutation = useMutation({
    mutationFn: async () =>
      dashboardApi.redriveWorkflow(props.workflowId, {
        request_id: crypto.randomUUID(),
        name: `${props.workflowName} redrive`,
        summary: summary.trim() || undefined,
        steering_instruction: steeringInstruction.trim() || undefined,
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
                if (!summary.trim()) {
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
