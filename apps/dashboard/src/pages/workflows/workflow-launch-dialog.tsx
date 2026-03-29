import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Rocket } from 'lucide-react';

import { Button } from '../../components/ui/button.js';
import {
  DEFAULT_FORM_VALIDATION_MESSAGE,
  FormFeedbackMessage,
  resolveFormFeedbackMessage,
} from '../../components/forms/form-feedback.js';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select.js';
import { Textarea } from '../../components/ui/textarea.js';
import { dashboardApi } from '../../lib/api.js';
import { buildFileUploadPayloads } from '../../lib/file-upload.js';
import { toast } from '../../lib/toast.js';
import {
  buildParametersFromDrafts,
  readLaunchDefinition,
} from '../playbook-launch/playbook-launch-support.js';
import { invalidateWorkflowsQueries } from './workflows-query.js';
import { WorkflowFileInput } from './workflow-file-input.js';
import {
  resolveDefaultWorkflowLaunchWorkspaceId,
  validateWorkflowLaunchDialogDraft,
} from './workflow-launch-dialog.support.js';

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
  const workspaces = workspacesQuery.data?.data?.filter((workspace) => workspace.is_active !== false) ?? [];
  const selectedPlaybook = useMemo(
    () => playbooks.find((playbook) => playbook.id === selectedPlaybookId) ?? null,
    [playbooks, selectedPlaybookId],
  );
  const launchDefinition = useMemo(() => readLaunchDefinition(selectedPlaybook), [selectedPlaybook]);
  const validation = useMemo(
    () =>
      validateWorkflowLaunchDialogDraft({
        selectedPlaybook,
        workspaceId,
        workflowName,
        parameterSpecs: launchDefinition.parameterSpecs,
        parameterDrafts,
      }),
    [launchDefinition.parameterSpecs, parameterDrafts, selectedPlaybook, workflowName, workspaceId],
  );

  useEffect(() => {
    if (!props.isOpen) {
      return;
    }
    setWorkspaceId((current) => resolveDefaultWorkflowLaunchWorkspaceId(workspaces, current));
  }, [props.isOpen, workspaces]);

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
    setErrorMessage(null);
    setHasAttemptedSubmit(false);
  }, [launchDefinition.parameterSpecs, props.isOpen]);

  const launchMutation = useMutation({
    mutationFn: async () => {
      return dashboardApi.createWorkflow({
        playbook_id: selectedPlaybookId,
        workspace_id: workspaceId,
        name: workflowName.trim(),
        parameters: buildParametersFromDrafts(launchDefinition.parameterSpecs, parameterDrafts),
        initial_input_packet:
          files.length > 0
            ? {
                summary: 'Workflow launch files',
                files: await buildFileUploadPayloads(files),
              }
            : undefined,
      });
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

  const isSubmitDisabled =
    launchMutation.isPending || playbooksQuery.isLoading || workspacesQuery.isLoading;
  const playbookError = hasAttemptedSubmit ? validation.fieldErrors.playbook : undefined;
  const workspaceError = hasAttemptedSubmit ? validation.fieldErrors.workspace : undefined;
  const workflowNameError = hasAttemptedSubmit ? validation.fieldErrors.workflowName : undefined;
  const formFeedbackMessage = resolveFormFeedbackMessage({
    serverError: errorMessage,
    showValidation: hasAttemptedSubmit,
    isValid: validation.isValid,
    validationMessage: DEFAULT_FORM_VALIDATION_MESSAGE,
  });

  function clearLaunchFeedback(): void {
    setErrorMessage(null);
  }

  return (
    <Dialog open={props.isOpen} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="h-5 w-5" />
            New workflow
          </DialogTitle>
          <DialogDescription>
            Choose the playbook, workspace, launch inputs, and optional files for the new workflow.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Playbook</span>
              <Select
                value={selectedPlaybookId}
                onValueChange={(value) => {
                  clearLaunchFeedback();
                  setSelectedPlaybookId(value);
                }}
              >
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
              <Select
                value={workspaceId}
                onValueChange={(value) => {
                  clearLaunchFeedback();
                  setWorkspaceId(value);
                }}
              >
                <SelectTrigger
                  className={
                    workspaceError ? 'border-red-300 focus-visible:ring-red-500' : undefined
                  }
                  aria-invalid={Boolean(workspaceError)}
                >
                  <SelectValue placeholder="Select workspace" />
                </SelectTrigger>
                <SelectContent>
                  {workspaces.map((workspace) => (
                    <SelectItem key={workspace.id} value={workspace.id}>
                      {workspace.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {workspaceError ? (
                <p className="text-xs text-red-600 dark:text-red-400">{workspaceError}</p>
              ) : null}
            </label>
          </div>

          <label className="grid gap-2 text-sm">
            <span className="font-medium">Workflow name</span>
            <Textarea
              value={workflowName}
              onChange={(event) => {
                clearLaunchFeedback();
                setWorkflowName(event.target.value);
              }}
              rows={2}
              className="min-h-[64px]"
              placeholder="Release readiness"
              aria-invalid={Boolean(workflowNameError)}
            />
            {workflowNameError ? (
              <p className="text-xs text-red-600 dark:text-red-400">{workflowNameError}</p>
            ) : null}
          </label>

          {launchDefinition.parameterSpecs.length > 0 ? (
            <div className="grid gap-3">
              {launchDefinition.parameterSpecs.map((spec) => (
                <label key={spec.slug} className="grid gap-2 text-sm">
                  <span className="font-medium">{spec.title}</span>
                  <Textarea
                    value={parameterDrafts[spec.slug] ?? ''}
                    onChange={(event) => {
                      clearLaunchFeedback();
                      setParameterDrafts((current) => ({ ...current, [spec.slug]: event.target.value }));
                    }}
                    rows={2}
                    className="min-h-[64px]"
                    placeholder={spec.required ? 'Required launch input' : 'Optional launch input'}
                    aria-invalid={Boolean(
                      hasAttemptedSubmit && spec.required && !(parameterDrafts[spec.slug]?.trim()),
                    )}
                  />
                  {hasAttemptedSubmit && spec.required && !(parameterDrafts[spec.slug]?.trim()) ? (
                    <p className="text-xs text-red-600 dark:text-red-400">
                      {`Enter a value for ${spec.title}.`}
                    </p>
                  ) : null}
                </label>
              ))}
            </div>
          ) : null}

          <WorkflowFileInput
            files={files}
            onChange={(nextFiles) => {
              clearLaunchFeedback();
              setFiles(nextFiles);
            }}
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
