import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Rocket } from 'lucide-react';

import { ChainParameterField } from '../../components/chain-workflow/chain-workflow-parameters.js';
import { Button } from '../../components/ui/button.js';
import {
  DEFAULT_FORM_VALIDATION_MESSAGE,
  FormFeedbackMessage,
  resolveFormFeedbackMessage,
} from '../../components/forms/form-feedback.js';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog.js';
import { Input } from '../../components/ui/input.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select.js';
import { dashboardApi } from '../../lib/api.js';
import { buildFileUploadPayloads } from '../../lib/file-upload.js';
import { toast } from '../../lib/toast.js';
import {
  buildParametersFromDrafts,
  buildWorkflowBudgetInput,
  createWorkflowBudgetDraft,
  readLaunchDefinition,
  validateLaunchDraft,
} from '../playbook-launch/playbook-launch-support.js';
import { invalidateWorkflowsQueries } from './workflows-query.js';
import { WorkflowFileInput } from './workflow-file-input.js';

export function WorkflowLaunchDialog(props: {
  isOpen: boolean;
  onOpenChange(open: boolean): void;
  onLaunched?(workflowId: string): void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [selectedPlaybookId, setSelectedPlaybookId] = useState('');
  const [workflowName, setWorkflowName] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');
  const [parameterDrafts, setParameterDrafts] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<File[]>([]);
  const [budgetDraft, setBudgetDraft] = useState(createWorkflowBudgetDraft());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  const playbooksQuery = useQuery({
    queryKey: ['playbooks'],
    queryFn: () => dashboardApi.listPlaybooks(),
    enabled: props.isOpen,
  });
  const workspacesQuery = useQuery({
    queryKey: ['workspaces'],
    queryFn: () => dashboardApi.listWorkspaces(),
    enabled: props.isOpen,
  });

  const playbooks = playbooksQuery.data?.data?.filter((playbook) => playbook.is_active !== false) ?? [];
  const selectedPlaybook = useMemo(
    () => playbooks.find((playbook) => playbook.id === selectedPlaybookId) ?? null,
    [playbooks, selectedPlaybookId],
  );
  const launchDefinition = useMemo(() => readLaunchDefinition(selectedPlaybook), [selectedPlaybook]);
  const validation = useMemo(
    () =>
      validateLaunchDraft({
        selectedPlaybook,
        workflowName,
        workflowBudgetDraft: budgetDraft,
        parameterSpecs: launchDefinition.parameterSpecs,
        parameterDrafts,
      }),
    [budgetDraft, launchDefinition.parameterSpecs, parameterDrafts, selectedPlaybook, workflowName],
  );

  useEffect(() => {
    if (props.isOpen && !selectedPlaybookId && playbooks.length > 0) {
      setSelectedPlaybookId(playbooks[0].id);
    }
  }, [playbooks, props.isOpen, selectedPlaybookId]);

  useEffect(() => {
    if (props.isOpen) {
      setParameterDrafts((current) => {
        const next: Record<string, string> = {};
        for (const spec of launchDefinition.parameterSpecs) {
          next[spec.slug] = current[spec.slug] ?? '';
        }
        return next;
      });
      return;
    }
    setSelectedPlaybookId('');
    setWorkflowName('');
    setWorkspaceId('');
    setParameterDrafts({});
    setFiles([]);
    setBudgetDraft(createWorkflowBudgetDraft());
    setErrorMessage(null);
    setHasAttemptedSubmit(false);
  }, [launchDefinition.parameterSpecs, props.isOpen]);

  const launchMutation = useMutation({
    mutationFn: async () => {
      const workflow = await dashboardApi.createWorkflow({
        playbook_id: selectedPlaybookId,
        workspace_id: workspaceId || undefined,
        name: workflowName.trim(),
        parameters: buildParametersFromDrafts(launchDefinition.parameterSpecs, parameterDrafts),
        budget: buildWorkflowBudgetInput(budgetDraft),
      });
      if (files.length > 0) {
        await dashboardApi.createWorkflowInputPacket(workflow.id, {
          packet_kind: 'launch',
          summary: 'Workflow launch files',
          files: await buildFileUploadPayloads(files),
        });
      }
      return workflow;
    },
    onSuccess: async (workflow) => {
      await invalidateWorkflowsQueries(queryClient, workflow.id, workflow.workspace_id ?? undefined);
      toast.success('Workflow created');
      props.onOpenChange(false);
      props.onLaunched?.(workflow.id);
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to create workflow.');
    },
  });

  const isSubmitDisabled = launchMutation.isPending || playbooksQuery.isLoading;
  const playbookError = hasAttemptedSubmit ? validation.fieldErrors.playbook : undefined;
  const workflowNameError = hasAttemptedSubmit ? validation.fieldErrors.workflowName : undefined;
  const tokenBudgetError = hasAttemptedSubmit ? validation.fieldErrors.tokenBudget : undefined;
  const costCapError = hasAttemptedSubmit ? validation.fieldErrors.costCapUsd : undefined;
  const maxDurationError =
    hasAttemptedSubmit ? validation.fieldErrors.maxDurationMinutes : undefined;
  const formFeedbackMessage = resolveFormFeedbackMessage({
    serverError: errorMessage,
    showValidation: hasAttemptedSubmit,
    isValid: validation.isValid && Boolean(selectedPlaybookId),
    validationMessage: DEFAULT_FORM_VALIDATION_MESSAGE,
  });

  return (
    <Dialog open={props.isOpen} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="h-5 w-5" />
            New workflow
          </DialogTitle>
          <DialogDescription>
            Launch a workflow with typed playbook inputs, optional launch files, and run-scoped guardrails.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Playbook</span>
              <Select value={selectedPlaybookId} onValueChange={setSelectedPlaybookId}>
                <SelectTrigger
                  className={
                    playbookError ? 'border-red-300 focus-visible:ring-red-500' : undefined
                  }
                  aria-invalid={Boolean(playbookError)}
                >
                  <SelectValue placeholder="Select playbook" />
                </SelectTrigger>
                <SelectContent>
                  {playbooks.map((playbook) => (
                    <SelectItem key={playbook.id} value={playbook.id}>
                      {playbook.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {playbookError ? (
                <p className="text-xs text-red-600 dark:text-red-400">{playbookError}</p>
              ) : null}
            </label>

            <label className="grid gap-2 text-sm">
              <span className="font-medium">Workspace</span>
              <Select value={workspaceId || '__none__'} onValueChange={(value) => setWorkspaceId(value === '__none__' ? '' : value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Optional workspace" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No workspace</SelectItem>
                  {(workspacesQuery.data?.data ?? []).map((workspace) => (
                    <SelectItem key={workspace.id} value={workspace.id}>
                      {workspace.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </div>

          <label className="grid gap-2 text-sm">
            <span className="font-medium">Workflow name</span>
            <Input
              value={workflowName}
              onChange={(event) => setWorkflowName(event.target.value)}
              placeholder="Release readiness"
              aria-invalid={Boolean(workflowNameError)}
            />
            {workflowNameError ? (
              <p className="text-xs text-red-600 dark:text-red-400">{workflowNameError}</p>
            ) : null}
          </label>

          {launchDefinition.parameterSpecs.length > 0 ? (
            <div className="grid gap-3 rounded-md border border-border p-4">
              <div className="grid gap-1">
                <strong className="text-sm">Launch inputs</strong>
                <p className="text-sm text-muted-foreground">
                  These values map directly to the selected playbook launch contract.
                </p>
              </div>
              {launchDefinition.parameterSpecs.map((spec) => (
                <ChainParameterField
                  key={spec.slug}
                  spec={spec}
                  value={parameterDrafts[spec.slug] ?? ''}
                  error={
                    hasAttemptedSubmit && spec.required && !(parameterDrafts[spec.slug]?.trim())
                      ? `Enter a value for ${spec.title}.`
                      : undefined
                  }
                  onChange={(value) => setParameterDrafts((current) => ({ ...current, [spec.slug]: value }))}
                />
              ))}
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-3">
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Token budget</span>
              <Input
                value={budgetDraft.tokenBudget}
                onChange={(event) =>
                  setBudgetDraft((current) => ({ ...current, tokenBudget: event.target.value }))
                }
                placeholder="Optional"
                aria-invalid={Boolean(tokenBudgetError)}
              />
              {tokenBudgetError ? (
                <p className="text-xs text-red-600 dark:text-red-400">{tokenBudgetError}</p>
              ) : null}
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Cost cap (USD)</span>
              <Input
                value={budgetDraft.costCapUsd}
                onChange={(event) =>
                  setBudgetDraft((current) => ({ ...current, costCapUsd: event.target.value }))
                }
                placeholder="Optional"
                aria-invalid={Boolean(costCapError)}
              />
              {costCapError ? (
                <p className="text-xs text-red-600 dark:text-red-400">{costCapError}</p>
              ) : null}
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Max duration (minutes)</span>
              <Input
                value={budgetDraft.maxDurationMinutes}
                onChange={(event) =>
                  setBudgetDraft((current) => ({
                    ...current,
                    maxDurationMinutes: event.target.value,
                  }))
                }
                placeholder="Optional"
                aria-invalid={Boolean(maxDurationError)}
              />
              {maxDurationError ? (
                <p className="text-xs text-red-600 dark:text-red-400">{maxDurationError}</p>
              ) : null}
            </label>
          </div>

          <WorkflowFileInput
            files={files}
            onChange={setFiles}
            label="Launch files"
            description="Attach immutable input files to the new workflow."
          />

          <FormFeedbackMessage message={formFeedbackMessage} />

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={isSubmitDisabled}
              onClick={() => {
                if (!validation.isValid || !selectedPlaybookId) {
                  setHasAttemptedSubmit(true);
                  return;
                }
                launchMutation.mutate();
              }}
            >
              {launchMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Create workflow
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
