import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Rocket } from 'lucide-react';

import { Button } from '../../components/ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { dashboardApi } from '../../lib/api.js';
import { buildFileUploadPayloads } from '../../lib/file-upload.js';
import { toast } from '../../lib/toast.js';
import { ChainParameterField } from '../../components/chain-workflow/chain-workflow-parameters.js';
import {
  buildParametersFromDrafts,
  buildWorkflowBudgetInput,
  createWorkflowBudgetDraft,
  readLaunchDefinition,
  validateLaunchDraft,
} from '../playbook-launch/playbook-launch-support.js';
import { MissionControlFileInput } from './mission-control-file-input.js';
import { invalidateMissionControlQueries } from './mission-control-query.js';

export function MissionControlLaunchDialog(props: {
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
  const launchDefinition = useMemo(
    () => readLaunchDefinition(selectedPlaybook),
    [selectedPlaybook],
  );
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
    if (!props.isOpen) {
      return;
    }
    if (!selectedPlaybookId && playbooks.length > 0) {
      setSelectedPlaybookId(playbooks[0].id);
    }
  }, [playbooks, props.isOpen, selectedPlaybookId]);

  useEffect(() => {
    if (!props.isOpen) {
      return;
    }
    setParameterDrafts((current) => {
      const next: Record<string, string> = {};
      for (const spec of launchDefinition.parameterSpecs) {
        next[spec.slug] = current[spec.slug] ?? '';
      }
      return next;
    });
  }, [launchDefinition.parameterSpecs, props.isOpen]);

  useEffect(() => {
    if (props.isOpen) {
      return;
    }
    setSelectedPlaybookId('');
    setWorkflowName('');
    setWorkspaceId('');
    setParameterDrafts({});
    setFiles([]);
    setBudgetDraft(createWorkflowBudgetDraft());
    setErrorMessage(null);
  }, [props.isOpen]);

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
          summary: 'Mission Control launch files',
          files: await buildFileUploadPayloads(files),
        });
      }
      return workflow;
    },
    onSuccess: async (workflow) => {
      setErrorMessage(null);
      await invalidateMissionControlQueries(queryClient, workflow.id, workflow.workspace_id ?? undefined);
      toast.success('Workflow launched');
      props.onOpenChange(false);
      props.onLaunched?.(workflow.id);
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to launch workflow.');
    },
  });

  const isSubmitDisabled =
    launchMutation.isPending
    || !validation.isValid
    || !selectedPlaybookId
    || playbooksQuery.isLoading;

  return (
    <Dialog open={props.isOpen} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="h-5 w-5" />
            Launch workflow
          </DialogTitle>
          <DialogDescription>
            Start a workflow from Mission Control with declared playbook inputs, optional launch files, and run-scoped guardrails.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Playbook</span>
              <Select value={selectedPlaybookId} onValueChange={setSelectedPlaybookId}>
                <SelectTrigger>
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
            />
          </label>

          {launchDefinition.parameterSpecs.length > 0 ? (
            <div className="grid gap-3 rounded-md border border-border p-4">
              <div className="grid gap-1">
                <strong className="text-sm">Declared launch inputs</strong>
                <p className="text-sm text-muted-foreground">
                  These values map directly to the selected playbook launch inputs.
                </p>
              </div>
              {launchDefinition.parameterSpecs.map((spec) => (
                <ChainParameterField
                  key={spec.slug}
                  spec={spec}
                  value={parameterDrafts[spec.slug] ?? ''}
                  onChange={(value) => {
                    setErrorMessage(null);
                    setParameterDrafts((current) => ({ ...current, [spec.slug]: value }));
                  }}
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
              />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Cost cap (USD)</span>
              <Input
                value={budgetDraft.costCapUsd}
                onChange={(event) =>
                  setBudgetDraft((current) => ({ ...current, costCapUsd: event.target.value }))
                }
                placeholder="Optional"
              />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Max duration (minutes)</span>
              <Input
                value={budgetDraft.maxDurationMinutes}
                onChange={(event) =>
                  setBudgetDraft((current) => ({ ...current, maxDurationMinutes: event.target.value }))
                }
                placeholder="Optional"
              />
            </label>
          </div>

          <MissionControlFileInput
            files={files}
            onChange={setFiles}
            label="Launch files"
            description="Upload immutable workflow-scoped input files for this run."
          />

          {validation.blockingIssues.length > 0 ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
              {validation.blockingIssues[0]}
            </div>
          ) : null}
          {errorMessage ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {errorMessage}
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={isSubmitDisabled} onClick={() => launchMutation.mutate()}>
              {launchMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Launch workflow
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
