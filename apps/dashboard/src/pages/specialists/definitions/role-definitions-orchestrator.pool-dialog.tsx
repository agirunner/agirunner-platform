import { useEffect, useMemo, useState } from 'react';

import type { FleetWorkerRecord } from '../../../lib/api.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog.js';
import { Input } from '../../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select.js';
import {
  DEFAULT_FORM_VALIDATION_MESSAGE,
  FormFeedbackMessage,
  resolveFormFeedbackMessage,
} from '../../../components/forms/form-feedback.js';
import {
  DEFAULT_RUNTIME_IMAGE_EXAMPLE,
  ORCHESTRATOR_RUNTIME_IMAGE_BOOTSTRAP_COPY,
} from '../../../lib/runtime-image-defaults.js';
import {
  buildOrchestratorPoolDraft,
  listOrchestratorWorkerOptions,
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
  const [draft, setDraft] = useState(() =>
    buildOrchestratorPoolDraft(props.workers),
  );
  const [hasAttemptedSave, setHasAttemptedSave] = useState(false);

  useEffect(() => {
    if (props.isOpen) {
      setDraft(buildOrchestratorPoolDraft(props.workers));
      setHasAttemptedSave(false);
    }
  }, [props.isOpen, props.workers]);
  const validationErrors = validateOrchestratorPoolDraft(draft);
  const hasValidationErrors = Object.keys(validationErrors).length > 0;
  const formFeedbackMessage = resolveFormFeedbackMessage({
    showValidation: hasAttemptedSave,
    isValid: !hasValidationErrors,
    validationMessage: DEFAULT_FORM_VALIDATION_MESSAGE,
  });

  return (
    <Dialog open={props.isOpen} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit orchestrator pool posture</DialogTitle>
          <DialogDescription>
            Configure the runtime environment for the orchestrator, and how many replicas should
            be available.
          </DialogDescription>
        </DialogHeader>
        <Card className="border-border/70 shadow-none">
          <CardHeader>
            <CardTitle className="text-base">Agent configuration</CardTitle>
            <CardDescription>
              Configure the runtime environment for the orchestrator and how many replicas should
              be available.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            {workerOptions.length > 1 ? (
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium">Agent entry</label>
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
              <label className="text-sm font-medium">Agent name</label>
              <Input
                value={draft.workerName}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, workerName: event.target.value }))
                }
                placeholder="orchestrator-primary"
                disabled={Boolean(draft.workerId)}
              />
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
            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium">Agent image</label>
              <Input
                value={draft.runtimeImage}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, runtimeImage: event.target.value }))
                }
                placeholder={DEFAULT_RUNTIME_IMAGE_EXAMPLE}
                aria-invalid={hasAttemptedSave && validationErrors.runtimeImage ? true : undefined}
              />
              {hasAttemptedSave && validationErrors.runtimeImage ? (
                <p className="text-xs text-red-600">{validationErrors.runtimeImage}</p>
              ) : null}
              <p className="text-xs leading-5 text-muted">
                This image is different from the environment where your specialists execute their
                tasks. This small alpine-based image is optimized for running the orchestrator
                loop, not for executing complex tasks. {ORCHESTRATOR_RUNTIME_IMAGE_BOOTSTRAP_COPY}
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">CPU</label>
              <Input
                value={draft.cpuLimit}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, cpuLimit: event.target.value }))
                }
                placeholder="2"
                aria-invalid={hasAttemptedSave && validationErrors.cpuLimit ? true : undefined}
              />
              {hasAttemptedSave && validationErrors.cpuLimit ? (
                <p className="text-xs text-red-600">{validationErrors.cpuLimit}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Memory</label>
              <Input
                value={draft.memoryLimit}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, memoryLimit: event.target.value }))
                }
                placeholder="256m"
                aria-invalid={hasAttemptedSave && validationErrors.memoryLimit ? true : undefined}
              />
              {hasAttemptedSave && validationErrors.memoryLimit ? (
                <p className="text-xs text-red-600">{validationErrors.memoryLimit}</p>
              ) : null}
            </div>
          </CardContent>
        </Card>
        <FormFeedbackMessage message={formFeedbackMessage} />
        <DialogActions
          isSaving={props.isSaving}
          saveLabel={draft.workerId ? 'Save pool posture' : 'Create pool posture'}
          onCancel={() => props.onOpenChange(false)}
          onSave={async () => {
            if (hasValidationErrors) {
              setHasAttemptedSave(true);
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
