import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Link2, Loader2 } from 'lucide-react';

import { dashboardApi } from '../lib/api.js';
import type { DashboardPlaybookRecord } from '../lib/api.js';
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
import { Textarea } from './ui/textarea.js';

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
  const [parametersJson, setParametersJson] = useState('');

  const playbooksQuery = useQuery({
    queryKey: ['playbooks'],
    queryFn: () => dashboardApi.listPlaybooks(),
    enabled: props.isOpen,
  });

  const playbooks: DashboardPlaybookRecord[] = playbooksQuery.data?.data ?? [];

  useEffect(() => {
    if (!props.isOpen) {
      return;
    }
    setTargetId(props.defaultPlaybookId ?? '');
    setName(`${props.defaultWorkflowName} follow-up`);
    setParametersJson('');
  }, [
    props.defaultPlaybookId,
    props.defaultWorkflowName,
    props.isOpen,
  ]);

  useEffect(() => {
    if (targetId || playbooks.length === 0) {
      return;
    }
    setTargetId(playbooks[0].id);
  }, [playbooks, targetId]);

  const chainMutation = useMutation({
    mutationFn: () => {
      const parameters = parseParameters(parametersJson);
      return dashboardApi.chainWorkflow(props.sourceWorkflowId, {
        playbook_id: targetId || undefined,
        name: name || undefined,
        parameters,
      });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['workflow', props.sourceWorkflowId] });
      props.onOpenChange(false);
      const created = extractId(data);
      if (created) {
        navigate(`/work/workflows/${created}`);
      }
    },
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

          <div className="space-y-2">
            <label className="text-sm font-medium">Parameter Overrides (JSON)</label>
            <Textarea
              placeholder='{"key": "value"}'
              value={parametersJson}
              onChange={(event) => setParametersJson(event.target.value)}
              className="min-h-[80px] font-mono text-xs"
            />
          </div>

          {chainMutation.isError ? (
            <p className="text-sm text-red-600">Failed to chain workflow. Please try again.</p>
          ) : null}

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

function parseParameters(json: string): Record<string, unknown> | undefined {
  const trimmed = json.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function extractId(data: unknown): string | undefined {
  const wrapped = data as { data?: { id?: string } } | undefined;
  return wrapped?.data?.id;
}
