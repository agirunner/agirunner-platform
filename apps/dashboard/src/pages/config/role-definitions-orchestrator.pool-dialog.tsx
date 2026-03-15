import { useEffect, useMemo, useState } from 'react';

import type { FleetWorkerRecord } from '../../lib/api.js';
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
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { Switch } from '../../components/ui/switch.js';
import {
  buildOrchestratorPoolDraft,
  listOrchestratorWorkerOptions,
  listSuggestedRuntimeImages,
  ORCHESTRATOR_ASSIGNMENT_MODEL,
} from './role-definitions-orchestrator.form.js';
import { DialogActions } from './role-definitions-orchestrator.dialog-shared.js';
import type { LlmModelRecord } from './role-definitions-page.support.js';

export function OrchestratorPoolDialog(props: {
  workers: FleetWorkerRecord[];
  models: LlmModelRecord[];
  isOpen: boolean;
  isSaving: boolean;
  onOpenChange: (nextOpen: boolean) => void;
  onSave: (input: {
    workerId: string | null;
    workerName: string;
    runtimeImage: string;
    replicas: number;
    enabled: boolean;
    modelId: string;
  }) => Promise<unknown>;
}): JSX.Element {
  const enabledModels = useMemo(
    () => props.models.filter((model) => model.is_enabled !== false),
    [props.models],
  );
  const workerOptions = useMemo(
    () => listOrchestratorWorkerOptions(props.workers),
    [props.workers],
  );
  const runtimeImages = useMemo(
    () => listSuggestedRuntimeImages(props.workers),
    [props.workers],
  );
  const [draft, setDraft] = useState(() =>
    buildOrchestratorPoolDraft(props.workers, props.models),
  );

  useEffect(() => {
    if (props.isOpen) {
      setDraft(buildOrchestratorPoolDraft(props.workers, props.models));
    }
  }, [props.isOpen, props.models, props.workers]);

  return (
    <Dialog open={props.isOpen} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit orchestrator pool posture</DialogTitle>
          <DialogDescription>
            Keep the primary orchestrator worker entry editable here. Use the fleet page when you
            need advanced multi-worker topology changes.
          </DialogDescription>
        </DialogHeader>
        <Card className="border-border/70 shadow-none">
          <CardHeader>
            <CardTitle className="text-base">Worker desired state</CardTitle>
            <CardDescription>
              Configure the main orchestrator worker entry, desired replicas, runtime image, and
              optional model pinning without leaving the roles surface.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            {workerOptions.length > 1 ? (
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium">Worker entry</label>
                <Select
                  value={draft.workerId ?? '__new__'}
                  onValueChange={(nextValue) => {
                    const nextDraft =
                      nextValue === '__new__'
                        ? buildOrchestratorPoolDraft([], props.models)
                        : buildOrchestratorPoolDraft(
                            props.workers.filter((worker) => worker.id === nextValue),
                            props.models,
                          );
                    setDraft(nextDraft);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {workerOptions.map((worker) => (
                      <SelectItem key={worker.id} value={worker.id}>
                        {worker.name} · {worker.detail}
                      </SelectItem>
                    ))}
                    <SelectItem value="__new__">Create a new orchestrator entry</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div className="space-y-2">
              <label className="text-sm font-medium">Worker name</label>
              <Input
                value={draft.workerName}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, workerName: event.target.value }))
                }
                placeholder="orchestrator-primary"
                disabled={Boolean(draft.workerId)}
              />
              {draft.workerId ? (
                <p className="text-xs text-muted">
                  Existing worker names stay fixed. Create a new worker entry on the fleet page if
                  you need a different name.
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Desired replicas</label>
              <Input
                type="number"
                min={1}
                value={draft.replicas}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, replicas: event.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Runtime image</label>
              <Input
                list="orchestrator-runtime-image-suggestions"
                value={draft.runtimeImage}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, runtimeImage: event.target.value }))
                }
                placeholder="agirunner-runtime:local"
              />
              <datalist id="orchestrator-runtime-image-suggestions">
                {runtimeImages.map((image) => (
                  <option key={image} value={image} />
                ))}
              </datalist>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Worker model pin</label>
              <Select
                value={draft.modelId}
                onValueChange={(nextValue) =>
                  setDraft((current) => ({ ...current, modelId: nextValue }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ORCHESTRATOR_ASSIGNMENT_MODEL}>
                    Follow orchestrator assignment
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
            <div className="md:col-span-2">
              <div className="flex items-center justify-between rounded-lg border border-border/70 p-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Enabled</p>
                  <p className="text-xs text-muted">
                    Keep the orchestrator worker defined but temporarily inactive when needed.
                  </p>
                </div>
                <Switch
                  checked={draft.enabled}
                  onCheckedChange={(checked) =>
                    setDraft((current) => ({ ...current, enabled: checked }))
                  }
                />
              </div>
            </div>
          </CardContent>
        </Card>
        <DialogActions
          isSaving={props.isSaving}
          saveLabel={draft.workerId ? 'Save pool posture' : 'Create worker posture'}
          onCancel={() => props.onOpenChange(false)}
          onSave={async () => {
            await props.onSave({
              workerId: draft.workerId,
              workerName: draft.workerName,
              runtimeImage: draft.runtimeImage,
              replicas: Math.max(1, parseInt(draft.replicas || '1', 10) || 1),
              enabled: draft.enabled,
              modelId: draft.modelId,
            });
            props.onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
