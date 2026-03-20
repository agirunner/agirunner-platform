import { useEffect, useMemo, useState } from 'react';

import type { FleetWorkerRecord } from '../../lib/api.js';
import { ImageReferenceField } from '../../components/forms/image-reference-field.js';
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
import {
  buildOrchestratorPoolDraft,
  listOrchestratorWorkerOptions,
  listSuggestedRuntimeImages,
  validateOrchestratorPoolDraft,
} from './role-definitions-orchestrator.form.js';
import { DialogActions } from './role-definitions-orchestrator.dialog-shared.js';

export function OrchestratorPoolDialog(props: {
  workers: FleetWorkerRecord[];
  isOpen: boolean;
  isSaving: boolean;
  onOpenChange: (nextOpen: boolean) => void;
  onSave: (input: {
    workerId: string | null;
    workerName: string;
    runtimeImage: string;
    cpuLimit: string;
    memoryLimit: string;
    replicas: number;
    enabled: boolean;
  }) => Promise<unknown>;
}): JSX.Element {
  const workerOptions = useMemo(
    () => listOrchestratorWorkerOptions(props.workers),
    [props.workers],
  );
  const runtimeImages = useMemo(
    () => listSuggestedRuntimeImages(props.workers),
    [props.workers],
  );
  const [draft, setDraft] = useState(() =>
    buildOrchestratorPoolDraft(props.workers),
  );

  useEffect(() => {
    if (props.isOpen) {
      setDraft(buildOrchestratorPoolDraft(props.workers));
    }
  }, [props.isOpen, props.workers]);
  const validationErrors = validateOrchestratorPoolDraft(draft);
  const hasValidationErrors = Object.keys(validationErrors).length > 0;

  return (
    <Dialog open={props.isOpen} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit orchestrator pool posture</DialogTitle>
          <DialogDescription>
            Keep the primary orchestrator worker entry editable here, including runtime image and
            resource limits.
          </DialogDescription>
        </DialogHeader>
        <Card className="border-border/70 shadow-none">
          <CardHeader>
            <CardTitle className="text-base">Worker desired state</CardTitle>
            <CardDescription>
              Configure the main orchestrator worker entry, desired replicas, runtime image, and
              CPU/memory limits without leaving the orchestrator page.
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
                        ? buildOrchestratorPoolDraft([])
                        : buildOrchestratorPoolDraft(
                            props.workers.filter((worker) => worker.id === nextValue),
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
                  Existing worker names stay fixed. Create a new orchestrator entry here if you
                  need a different name.
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
              <ImageReferenceField
                value={draft.runtimeImage}
                onChange={(value) => setDraft((current) => ({ ...current, runtimeImage: value }))}
                placeholder="agirunner-runtime:local"
                suggestions={runtimeImages}
                listId="orchestrator-runtime-image-suggestions"
                error={validationErrors.runtimeImage}
                helperText="Use the same standard image ref format as Roles and runtime defaults."
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">CPU limit</label>
              <Input
                value={draft.cpuLimit}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, cpuLimit: event.target.value }))
                }
                placeholder="1"
                aria-invalid={validationErrors.cpuLimit ? 'true' : 'false'}
              />
              {validationErrors.cpuLimit ? (
                <p className="text-xs text-red-600">{validationErrors.cpuLimit}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Memory limit</label>
              <Input
                value={draft.memoryLimit}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, memoryLimit: event.target.value }))
                }
                placeholder="512m"
                aria-invalid={validationErrors.memoryLimit ? 'true' : 'false'}
              />
              {validationErrors.memoryLimit ? (
                <p className="text-xs text-red-600">{validationErrors.memoryLimit}</p>
              ) : null}
            </div>
          </CardContent>
        </Card>
      <DialogActions
        isSaving={props.isSaving}
        saveLabel={draft.workerId ? 'Save pool posture' : 'Create worker posture'}
        onCancel={() => props.onOpenChange(false)}
        onSave={async () => {
          if (hasValidationErrors) {
            return;
          }
          await props.onSave({
            workerId: draft.workerId,
            workerName: draft.workerName,
            runtimeImage: draft.runtimeImage,
            cpuLimit: draft.cpuLimit,
            memoryLimit: draft.memoryLimit,
            replicas: Math.max(1, parseInt(draft.replicas || '1', 10) || 1),
            enabled: draft.enabled,
          });
          props.onOpenChange(false);
        }}
        />
      </DialogContent>
    </Dialog>
  );
}
