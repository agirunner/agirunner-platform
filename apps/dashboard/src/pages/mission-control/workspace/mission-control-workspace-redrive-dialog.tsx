import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, RotateCcw } from 'lucide-react';

import { ChainStructuredEntryEditor } from '../../../components/chain-workflow/chain-workflow-parameters.js';
import { Button } from '../../../components/ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog.js';
import { Input } from '../../../components/ui/input.js';
import { Textarea } from '../../../components/ui/textarea.js';
import { dashboardApi } from '../../../lib/api.js';
import { buildFileUploadPayloads } from '../../../lib/file-upload.js';
import { toast } from '../../../lib/toast.js';
import {
  buildStructuredObject,
  type StructuredEntryDraft,
} from '../../playbook-launch/playbook-launch-support.js';
import { MissionControlFileInput } from '../mission-control-file-input.js';
import { invalidateMissionControlQueries } from '../mission-control-query.js';

interface ParameterDraft {
  id: string;
  key: string;
  value: string;
}

export function MissionControlWorkspaceRedriveDialog(props: {
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
  }, [props.isOpen, props.workflowName]);

  const mutation = useMutation({
    mutationFn: async () => {
      const parameters = buildParameterRecord(parameterDrafts);
      const structuredInputs = buildStructuredObject(structuredDrafts, 'Redrive input');
      return dashboardApi.redriveWorkflow(props.workflowId, {
        request_id: crypto.randomUUID(),
        name: name.trim() || undefined,
        summary: summary.trim() || undefined,
        steering_instruction: steeringInstruction.trim() || undefined,
        parameters,
        structured_inputs: structuredInputs,
        files: await buildFileUploadPayloads(files),
      });
    },
    onSuccess: async (result) => {
      await invalidateMissionControlQueries(
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

  const isSubmitDisabled =
    mutation.isPending
    || name.trim().length === 0
    || summary.trim().length === 0;

  return (
    <Dialog open={props.isOpen} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="h-5 w-5" />
            Redrive workflow
          </DialogTitle>
          <DialogDescription>
            Create a new linked workflow attempt with corrected inputs, files, and steering guidance while preserving the failed attempt as immutable history.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <label className="grid gap-2 text-sm">
            <span className="font-medium">New attempt name</span>
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Redrive summary</span>
            <Textarea value={summary} onChange={(event) => setSummary(event.target.value)} className="min-h-[96px]" />
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Steering instruction</span>
            <Textarea
              value={steeringInstruction}
              onChange={(event) => setSteeringInstruction(event.target.value)}
              className="min-h-[96px]"
            />
          </label>

          <ParameterEditor drafts={parameterDrafts} onChange={setParameterDrafts} />

          <div className="grid gap-3 rounded-md border border-border p-4">
            <div className="grid gap-1">
              <strong className="text-sm">Structured redrive inputs</strong>
              <p className="text-sm text-muted-foreground">
                These become part of the new attempt input packet and hidden execution context.
              </p>
            </div>
            <ChainStructuredEntryEditor
              drafts={structuredDrafts}
              onChange={setStructuredDrafts}
              addLabel="Add structured input"
            />
          </div>

          <MissionControlFileInput
            files={files}
            onChange={setFiles}
            label="Redrive files"
            description="Attach corrected workflow-scoped files for the new attempt."
          />

          {errorMessage ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {errorMessage}
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={isSubmitDisabled} onClick={() => mutation.mutate()}>
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Redrive workflow
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
        <strong className="text-sm">Declared parameter overrides</strong>
        <p className="text-sm text-muted-foreground">These string values override launch parameters on the new attempt.</p>
      </div>
      {props.drafts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No parameter overrides yet.</p>
      ) : (
        props.drafts.map((draft) => (
          <div key={draft.id} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <Input value={draft.key} onChange={(event) => props.onChange(updateDraft(props.drafts, draft.id, 'key', event.target.value))} placeholder="Parameter key" />
            <Input value={draft.value} onChange={(event) => props.onChange(updateDraft(props.drafts, draft.id, 'value', event.target.value))} placeholder="Override value" />
            <Button type="button" variant="outline" onClick={() => props.onChange(props.drafts.filter((entry) => entry.id !== draft.id))}>
              Remove
            </Button>
          </div>
        ))
      )}
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
