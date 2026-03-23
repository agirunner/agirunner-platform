import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Link2, Loader2 } from 'lucide-react';

import { dashboardApi } from '../lib/api.js';
import type { DashboardPlaybookRecord } from '../lib/api.js';
import {
  buildParametersFromDrafts,
  buildStructuredObject,
  defaultParameterDraftValue,
  mergeStructuredObjects,
  readLaunchDefinition,
  type StructuredEntryDraft,
} from '../pages/playbook-launch/playbook-launch-support.js';
import { Button } from './ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog.js';
import { Input } from './ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select.js';
import {
  ChainParameterField,
  ChainStructuredEntryEditor,
} from './chain-workflow-parameters.js';

interface ChainWorkflowDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  sourceWorkflowId: string;
  defaultPlaybookId?: string;
  defaultWorkflowName: string;
}

export function ChainWorkflowDialog(props: ChainWorkflowDialogProps): JSX.Element {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [targetId, setTargetId] = useState(props.defaultPlaybookId ?? '');
  const [name, setName] = useState(`${props.defaultWorkflowName} follow-up`);
  const [parameterDrafts, setParameterDrafts] = useState<Record<string, string>>({});
  const [extraParameterDrafts, setExtraParameterDrafts] = useState<StructuredEntryDraft[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const playbooksQuery = useQuery({
    queryKey: ['playbooks'],
    queryFn: () => dashboardApi.listPlaybooks(),
    enabled: props.isOpen,
  });

  const playbooks: DashboardPlaybookRecord[] = playbooksQuery.data?.data ?? [];
  const selectedPlaybook = useMemo(
    () => playbooks.find((playbook) => playbook.id === targetId) ?? null,
    [playbooks, targetId],
  );
  const launchDefinition = useMemo(
    () => readLaunchDefinition(selectedPlaybook),
    [selectedPlaybook],
  );

  useEffect(() => {
    if (!props.isOpen) {
      return;
    }
    setTargetId(props.defaultPlaybookId ?? '');
    setName(`${props.defaultWorkflowName} follow-up`);
    setParameterDrafts({});
    setExtraParameterDrafts([]);
    setErrorMessage(null);
  }, [props.defaultPlaybookId, props.defaultWorkflowName, props.isOpen]);

  useEffect(() => {
    if (targetId || playbooks.length === 0) {
      return;
    }
    setTargetId(playbooks[0].id);
  }, [playbooks, targetId]);

  useEffect(() => {
    setParameterDrafts((current) => {
      const next: Record<string, string> = {};
      for (const spec of launchDefinition.parameterSpecs) {
        next[spec.key] =
          current[spec.key] ??
          defaultParameterDraftValue(spec.defaultValue, spec.inputType);
      }
      return next;
    });
  }, [launchDefinition.parameterSpecs]);

  const chainMutation = useMutation({
    mutationFn: () => {
      const parameters = mergeStructuredObjects(
        buildParametersFromDrafts(launchDefinition.parameterSpecs, parameterDrafts),
        buildStructuredObject(extraParameterDrafts, 'Parameter overrides'),
        'Parameter overrides',
      );
      return dashboardApi.chainWorkflow(props.sourceWorkflowId, {
        playbook_id: targetId,
        name: name || undefined,
        parameters,
      });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['workflow', props.sourceWorkflowId] });
      props.onOpenChange(false);
      setErrorMessage(null);
      const created = extractId(data);
      if (created) {
        navigate(`/work/boards/${created}`);
      }
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to chain workflow.');
    }
  });

  const isSubmitDisabled = chainMutation.isPending || !name.trim() || !targetId;

  return (
    <Dialog
      open={props.isOpen}
      onOpenChange={(open) => {
        if (!open) {
          props.onOpenChange(false);
        }
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5" />
            Chain Workflow
          </DialogTitle>
          <DialogDescription>
            Create a linked follow-up workflow from this run using a playbook.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Playbook</label>
            <Select value={targetId} onValueChange={setTargetId}>
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
            {playbooks.length === 0 ? (
              <p className="text-sm text-muted">No playbooks are available yet.</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Workflow Name</label>
            <Input
              placeholder="Enter workflow name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">Parameter Overrides</label>
              <p className="text-xs text-muted">
                Configure playbook-defined follow-up inputs without hand-editing raw JSON.
              </p>
            </div>
            {launchDefinition.parameterSpecs.length > 0 ? (
              <div className="grid gap-4 rounded-md border border-border p-3">
                {launchDefinition.parameterSpecs.map((spec) => (
                  <ChainParameterField
                    key={spec.key}
                    spec={spec}
                    value={parameterDrafts[spec.key] ?? ''}
                    onChange={(value) => {
                      setErrorMessage(null);
                      setParameterDrafts((current) => ({ ...current, [spec.key]: value }));
                    }}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">
                This playbook does not define parameter specs yet. Add structured overrides below
                if the follow-up workflow needs extra inputs.
              </p>
            )}
            <ChainStructuredEntryEditor
              drafts={extraParameterDrafts}
              onChange={(drafts) => {
                setErrorMessage(null);
                setExtraParameterDrafts(drafts);
              }}
              addLabel="Add parameter"
            />
          </div>

          {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => props.onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={isSubmitDisabled} onClick={() => chainMutation.mutate()}>
              {chainMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Chain
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function extractId(data: unknown): string | undefined {
  const wrapped = data as { data?: { id?: string } } | undefined;
  return wrapped?.data?.id;
}
