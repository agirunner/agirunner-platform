import { useEffect, useMemo, useState } from 'react';

import type { DashboardPlatformInstructionRecord } from '../../lib/api.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { Textarea } from '../../components/ui/textarea.js';
import type { RoleAssignmentRecord, SystemDefaultRecord } from './role-definitions-orchestrator.support.js';
import {
  buildOrchestratorModelDraft,
  buildOrchestratorPromptDraft,
  extractReasoningValue,
  ORCHESTRATOR_INHERIT_MODEL,
} from './role-definitions-orchestrator.form.js';
import { DialogActions, ReasoningControl } from './role-definitions-orchestrator.dialog-shared.js';
import type { LlmModelRecord } from './role-definitions-page.support.js';

export function OrchestratorPromptDialog(props: {
  instructions: DashboardPlatformInstructionRecord | undefined;
  isOpen: boolean;
  isSaving: boolean;
  onOpenChange: (nextOpen: boolean) => void;
  onSave: (content: string) => Promise<unknown>;
}): JSX.Element {
  const [content, setContent] = useState('');

  useEffect(() => {
    if (props.isOpen) {
      setContent(buildOrchestratorPromptDraft(props.instructions).content);
    }
  }, [props.instructions, props.isOpen]);

  return (
    <Dialog open={props.isOpen} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit orchestrator prompt baseline</DialogTitle>
          <DialogDescription>
            Keep the baseline prompt directly editable here. Use the full instructions page only
            when you need version history and deep diff review.
          </DialogDescription>
        </DialogHeader>
        <Card className="border-border/70 shadow-none">
          <CardHeader>
            <CardTitle className="text-base">Prompt baseline</CardTitle>
            <CardDescription>
              This prompt shapes delegation tone, verification posture, recovery behavior, and how
              stage-gate outcomes are communicated.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              className="min-h-[320px]"
              placeholder="Write the workflow orchestrator baseline instructions."
            />
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
              <p>
                Current version: {props.instructions ? `v${props.instructions.version}` : 'Draft'}
              </p>
              <p>{content.trim().length} characters</p>
            </div>
          </CardContent>
        </Card>
        <DialogActions
          isSaving={props.isSaving}
          saveLabel="Save prompt baseline"
          onCancel={() => props.onOpenChange(false)}
          onSave={async () => {
            await props.onSave(content);
            props.onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

export function OrchestratorModelDialog(props: {
  assignments: RoleAssignmentRecord[] | undefined;
  systemDefault: SystemDefaultRecord | undefined;
  models: LlmModelRecord[];
  isOpen: boolean;
  isSaving: boolean;
  onOpenChange: (nextOpen: boolean) => void;
  onSave: (input: {
    modelId: string;
    reasoningConfig: Record<string, unknown> | null;
  }) => Promise<unknown>;
}): JSX.Element {
  const enabledModels = useMemo(
    () => props.models.filter((model) => model.is_enabled !== false),
    [props.models],
  );
  const [modelId, setModelId] = useState(ORCHESTRATOR_INHERIT_MODEL);
  const [reasoningConfig, setReasoningConfig] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (props.isOpen) {
      const draft = buildOrchestratorModelDraft(props.assignments);
      setModelId(draft.modelId);
      setReasoningConfig(draft.reasoningConfig);
    }
  }, [props.assignments, props.isOpen]);

  const selectedModel = enabledModels.find((model) => model.id === modelId) ?? null;
  const reasoningSchema = selectedModel?.reasoning_config ?? null;
  const inheritedModel = enabledModels.find((model) => model.id === props.systemDefault?.modelId) ?? null;

  return (
    <Dialog open={props.isOpen} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit orchestrator model routing</DialogTitle>
          <DialogDescription>
            Choose whether the orchestrator inherits the shared system default or uses its own
            explicit model override.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Card className="border-border/70 shadow-none">
            <CardHeader>
              <CardTitle className="text-base">Model selection</CardTitle>
              <CardDescription>
                Use inheritance when the orchestrator should follow the global default. Add an
                explicit override when orchestration needs a different model or reasoning posture.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Routing policy</label>
                <Select value={modelId} onValueChange={(nextValue) => {
                  setModelId(nextValue);
                  setReasoningConfig(null);
                }}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ORCHESTRATOR_INHERIT_MODEL}>
                      Inherit system default
                    </SelectItem>
                    {enabledModels.map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        {model.model_id}
                        {model.provider_name ? ` (${model.provider_name})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="rounded-lg border border-border/70 bg-muted/10 p-3 text-sm text-muted">
                {modelId === ORCHESTRATOR_INHERIT_MODEL ? (
                  <p>
                    System default currently resolves to{' '}
                    <span className="font-medium text-foreground">
                      {inheritedModel
                        ? `${inheritedModel.model_id}${inheritedModel.provider_name ? ` (${inheritedModel.provider_name})` : ''}`
                        : 'No configured default'}
                    </span>
                    .
                  </p>
                ) : (
                  <p>
                    The orchestrator will use an explicit override for activation planning,
                    delegation, review, and recovery.
                  </p>
                )}
              </div>
              {reasoningSchema ? (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Reasoning profile</label>
                  <ReasoningControl
                    schema={reasoningSchema}
                    value={extractReasoningValue(reasoningSchema, reasoningConfig)}
                    onChange={setReasoningConfig}
                  />
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
        <DialogActions
          isSaving={props.isSaving}
          saveLabel="Save model routing"
          onCancel={() => props.onOpenChange(false)}
          onSave={async () => {
            await props.onSave({ modelId, reasoningConfig });
            props.onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
