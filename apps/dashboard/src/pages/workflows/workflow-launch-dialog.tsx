import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';

import { SearchableCombobox } from '../../components/log-viewer/ui/searchable-combobox.js';
import { Button } from '../../components/ui/button.js';
import {
  DEFAULT_FORM_VALIDATION_MESSAGE,
  FieldErrorText,
  FormFeedbackMessage,
  resolveFormFeedbackMessage,
} from '../../components/forms/form-feedback.js';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog.js';
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
  buildWorkflowLaunchComboboxItems,
  resolveDefaultWorkflowLaunchWorkspaceId,
  validateWorkflowLaunchDialogDraft,
} from './workflow-launch-dialog.support.js';

export function WorkflowLaunchDialog(props: {
  isOpen: boolean;
  onOpenChange(open: boolean): void;
  initialPlaybookId?: string | null;
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
    staleTime: 60_000,
  });
  const workspacesQuery = useQuery({
    queryKey: ['workspaces'],
    queryFn: () => dashboardApi.listWorkspaces(),
    staleTime: 60_000,
  });

  const playbooks = playbooksQuery.data?.data?.filter((playbook) => playbook.is_active !== false) ?? [];
  const workspaces = workspacesQuery.data?.data?.filter((workspace) => workspace.is_active !== false) ?? [];
  const playbookItems = useMemo(() => buildWorkflowLaunchComboboxItems(playbooks), [playbooks]);
  const workspaceItems = useMemo(() => buildWorkflowLaunchComboboxItems(workspaces), [workspaces]);
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
    if (!props.isOpen) {
      return;
    }
    setSelectedPlaybookId(props.initialPlaybookId?.trim() ?? '');
  }, [props.initialPlaybookId, props.isOpen]);

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
    validationMessage: validation.blockingIssues[0] ?? DEFAULT_FORM_VALIDATION_MESSAGE,
  });

  function clearLaunchFeedback(): void {
    setErrorMessage(null);
  }

  return (
    <Dialog open={props.isOpen} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New workflow</DialogTitle>
          <DialogDescription>
            Choose the playbook and workspace, then add the required inputs and any supporting files.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Playbook</span>
              <SearchableCombobox
                items={playbookItems}
                value={selectedPlaybookId || null}
                onChange={(value) => {
                  clearLaunchFeedback();
                  setSelectedPlaybookId(value ?? '');
                }}
                placeholder="Select playbook"
                searchPlaceholder="Search playbooks..."
                allGroupLabel="Playbooks"
                isLoading={playbooksQuery.isLoading}
                className={playbookError ? 'border-red-300 focus:ring-red-500' : undefined}
              />
              <FieldErrorText message={playbookError} />
            </label>

            <label className="grid gap-2 text-sm">
              <span className="font-medium">Workspace</span>
              <SearchableCombobox
                items={workspaceItems}
                value={workspaceId || null}
                onChange={(value) => {
                  clearLaunchFeedback();
                  setWorkspaceId(value ?? '');
                }}
                placeholder="Select workspace"
                searchPlaceholder="Search workspaces..."
                allGroupLabel="Workspaces"
                isLoading={workspacesQuery.isLoading}
                className={workspaceError ? 'border-red-300 focus:ring-red-500' : undefined}
              />
              <FieldErrorText message={workspaceError} />
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
            <FieldErrorText message={workflowNameError} />
          </label>

          {launchDefinition.parameterSpecs.length > 0 ? (
            <div className="grid gap-3">
              {launchDefinition.parameterSpecs.map((spec) => {
                const parameterError = hasAttemptedSubmit
                  ? validation.parameterErrors[spec.slug]
                  : undefined;
                return (
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
                      aria-invalid={Boolean(parameterError)}
                    />
                    <FieldErrorText message={parameterError} />
                  </label>
                );
              })}
            </div>
          ) : null}

          <WorkflowFileInput
            files={files}
            onChange={(nextFiles) => {
              clearLaunchFeedback();
              setFiles(nextFiles);
            }}
            label="Files"
            description="Attach supporting files that should launch with this workflow."
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
