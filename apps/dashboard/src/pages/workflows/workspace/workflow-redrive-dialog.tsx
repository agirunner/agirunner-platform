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
  const [brief, setBrief] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  useEffect(() => {
    if (props.isOpen) {
      return;
    }
    setBrief('');
    setFiles([]);
    setErrorMessage(null);
    setHasAttemptedSubmit(false);
  }, [props.isOpen]);

  const briefError =
    hasAttemptedSubmit && !brief.trim() ? 'Enter a redrive brief.' : undefined;
  const formFeedbackMessage = resolveFormFeedbackMessage({
    serverError: errorMessage,
    showValidation: hasAttemptedSubmit,
    isValid: Boolean(brief.trim()),
    validationMessage: DEFAULT_FORM_VALIDATION_MESSAGE,
  });

  function clearFormFeedback(): void {
    setErrorMessage(null);
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const trimmedBrief = brief.trim();
      return dashboardApi.redriveWorkflow(props.workflowId, {
        request_id: crypto.randomUUID(),
        summary: trimmedBrief || undefined,
        steering_instruction: trimmedBrief || undefined,
        files: await buildFileUploadPayloads(files),
      });
    },
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
            Start a fresh attempt for {props.workflowName} with one concise operator brief and any corrected files.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Redrive brief</span>
            <Textarea
              value={brief}
              onChange={(event) => {
                clearFormFeedback();
                setBrief(event.target.value);
              }}
              rows={4}
              className="min-h-[96px]"
              placeholder="Explain what should change in the next attempt."
              aria-invalid={Boolean(briefError)}
            />
            <FieldErrorText message={briefError} />
          </label>

          <WorkflowFileInput
            files={files}
            onChange={(nextFiles) => {
              clearFormFeedback();
              setFiles(nextFiles);
            }}
            label="Redrive files"
            description="Attach corrected files for the next attempt."
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
                if (!brief.trim()) {
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
