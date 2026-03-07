import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Loader2, Link2 } from 'lucide-react';
import { dashboardApi } from '../lib/api.js';
import type { DashboardTemplate } from '../lib/api.js';
import { Button } from './ui/button.js';
import { Input } from './ui/input.js';
import { Textarea } from './ui/textarea.js';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/dialog.js';
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from './ui/select.js';

interface ChainWorkflowDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  sourceWorkflowId: string;
  defaultTemplateId?: string;
  defaultWorkflowName: string;
}

export function ChainWorkflowDialog({
  isOpen,
  onOpenChange,
  sourceWorkflowId,
  defaultTemplateId,
  defaultWorkflowName,
}: ChainWorkflowDialogProps): JSX.Element {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [templateId, setTemplateId] = useState(defaultTemplateId ?? '');
  const [name, setName] = useState(`${defaultWorkflowName} follow-up`);
  const [parametersJson, setParametersJson] = useState('');

  useEffect(() => {
    if (isOpen) {
      setTemplateId(defaultTemplateId ?? '');
      setName(`${defaultWorkflowName} follow-up`);
      setParametersJson('');
    }
  }, [isOpen, defaultTemplateId, defaultWorkflowName]);

  const { data: templatesResponse } = useQuery({
    queryKey: ['templates'],
    queryFn: () => dashboardApi.listTemplates(),
    enabled: isOpen,
  });
  const templates: DashboardTemplate[] = templatesResponse?.data ?? [];

  const chainMutation = useMutation({
    mutationFn: () => {
      const parameters = parseParameters(parametersJson);
      return dashboardApi.chainWorkflow(sourceWorkflowId, {
        template_id: templateId || undefined,
        name: name || undefined,
        parameters,
      });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['workflow', sourceWorkflowId] });
      onOpenChange(false);
      const created = extractId(data);
      if (created) {
        navigate(`/work/workflows/${created}`);
      }
    },
  });

  const isSubmitDisabled = chainMutation.isPending || !name.trim();

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onOpenChange(false); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5" />
            Chain Workflow
          </DialogTitle>
          <DialogDescription>
            Create a follow-up workflow linked to the completed one.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Template</label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger>
                <SelectValue placeholder="Select template" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Workflow Name</label>
            <Input
              placeholder="Enter workflow name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Parameter Overrides (JSON)</label>
            <Textarea
              placeholder='{"key": "value"}'
              value={parametersJson}
              onChange={(e) => setParametersJson(e.target.value)}
              className="min-h-[80px] font-mono text-xs"
            />
          </div>

          {chainMutation.isError && (
            <p className="text-sm text-red-600">Failed to chain workflow. Please try again.</p>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={isSubmitDisabled} onClick={() => chainMutation.mutate()}>
              {chainMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
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
