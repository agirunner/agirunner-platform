import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Trash2 } from 'lucide-react';

import {
  dashboardApi,
  type DashboardLlmModelRecord,
  type DashboardLlmProviderRecord,
  type FleetWorkerRecord,
} from '../../lib/api.js';
import { toast } from '../../lib/toast.js';
import { Button } from '../../components/ui/button.js';
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
import { Switch } from '../../components/ui/switch.js';
import {
  addEnvironmentEntry,
  buildCreateWorkerPayload,
  buildUpdateWorkerPayload,
  buildWorkerFormValues,
  formatCapacityDelta,
  listModelsForProvider,
  listSuggestedWorkerRoles,
  NETWORK_POLICY_OPTIONS,
  POOL_KIND_OPTIONS,
  type WorkerDesiredStateFormValues,
  validateWorkerDesiredState,
  updateEnvironmentEntry,
  removeEnvironmentEntry,
} from './worker-list-page.support.js';

type WorkerDialogMode = 'create' | 'edit';

interface WorkerDesiredStateDialogProps {
  isOpen: boolean;
  mode: WorkerDialogMode;
  worker: FleetWorkerRecord | null;
  existingWorkers: FleetWorkerRecord[];
  providers: DashboardLlmProviderRecord[];
  models: DashboardLlmModelRecord[];
  isModelCatalogLoading: boolean;
  modelCatalogError: string | null;
  onClose: () => void;
}

const DEFAULT_PROVIDER_VALUE = '__runtime-default__';

function SummaryField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): JSX.Element {
  return (
    <div className="rounded-lg bg-border/30 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">{label}</p>
      <p
        className={
          mono
            ? 'mt-1 font-mono text-xs text-foreground'
            : 'mt-1 text-sm font-medium text-foreground'
        }
      >
        {value}
      </p>
    </div>
  );
}

export function WorkerDesiredStateDialog(props: WorkerDesiredStateDialogProps): JSX.Element {
  const queryClient = useQueryClient();
  const [formValues, setFormValues] =
    useState<WorkerDesiredStateFormValues>(buildWorkerFormValues());

  useEffect(() => {
    if (props.isOpen) {
      setFormValues(buildWorkerFormValues(props.worker));
    }
  }, [props.isOpen, props.worker]);

  const suggestedRoles = useMemo(
    () => listSuggestedWorkerRoles(props.existingWorkers),
    [props.existingWorkers],
  );
  const selectedProvider =
    props.providers.find((provider) => provider.name === formValues.llmProvider) ?? null;
  const availableModels = useMemo(
    () => listModelsForProvider(props.models, selectedProvider),
    [props.models, selectedProvider],
  );
  const validationErrors = useMemo(() => validateWorkerDesiredState(formValues), [formValues]);
  const hasValidationErrors = Object.keys(validationErrors).length > 0;
  const desiredReplicas = Math.max(1, Number.parseInt(formValues.replicas, 10) || 1);
  const actualReplicas = props.worker?.actual.length ?? 0;
  const networkDescription =
    NETWORK_POLICY_OPTIONS.find((option) => option.value === formValues.networkPolicy)
      ?.description ?? 'Network policy not selected.';

  const mutation = useMutation({
    mutationFn: async () => {
      if (props.mode === 'create') {
        return dashboardApi.createFleetWorker(buildCreateWorkerPayload(formValues));
      }
      if (!props.worker) {
        throw new Error('Worker is required to update desired state.');
      }
      return dashboardApi.updateFleetWorker(props.worker.id, buildUpdateWorkerPayload(formValues));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['fleet-workers'] });
      void queryClient.invalidateQueries({ queryKey: ['fleet-status'] });
      toast.success(
        props.mode === 'create' ? 'Worker desired state created' : 'Worker desired state updated',
      );
      props.onClose();
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message);
    },
  });

  function setField<K extends keyof WorkerDesiredStateFormValues>(
    field: K,
    value: WorkerDesiredStateFormValues[K],
  ): void {
    setFormValues((current) => ({ ...current, [field]: value }));
  }

  function handlePoolKindChange(nextPoolKind: 'orchestrator' | 'specialist'): void {
    setFormValues((current) => ({
      ...current,
      poolKind: nextPoolKind,
      role: nextPoolKind === 'orchestrator' && !current.role.trim() ? 'orchestrator' : current.role,
    }));
  }

  function handleProviderChange(nextValue: string): void {
    if (nextValue === DEFAULT_PROVIDER_VALUE) {
      setFormValues((current) => ({ ...current, llmProvider: '', llmModel: '' }));
      return;
    }
    const provider = props.providers.find((candidate) => candidate.name === nextValue) ?? null;
    const allowedModels = listModelsForProvider(props.models, provider);
    const nextModel = allowedModels.some((model) => model.model_id === formValues.llmModel)
      ? formValues.llmModel
      : '';
    setFormValues((current) => ({
      ...current,
      llmProvider: nextValue,
      llmModel: nextModel,
    }));
  }

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    mutation.mutate();
  }

  const title = props.mode === 'create' ? 'Register Fleet Worker' : 'Edit Worker Desired State';

  return (
    <Dialog open={props.isOpen} onOpenChange={(open) => (!open ? props.onClose() : undefined)}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto p-0">
        <DialogHeader>
          <div className="space-y-2 border-b border-border px-6 pt-6 pb-4">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              Configure the desired runtime posture, pool assignment, model pinning, and environment
              for this worker entry.
            </DialogDescription>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6 px-6 pb-6">
          <section className="grid gap-3 pt-2 md:grid-cols-2 xl:grid-cols-4">
            <SummaryField
              label="Pool assignment"
              value={
                formValues.poolKind === 'orchestrator' ? 'Orchestrator pool' : 'Specialist pool'
              }
            />
            <SummaryField
              label="Capacity"
              value={
                props.mode === 'create'
                  ? `${desiredReplicas} desired replica${desiredReplicas === 1 ? '' : 's'}`
                  : `${desiredReplicas} desired • ${formatCapacityDelta(
                      desiredReplicas,
                      actualReplicas,
                    )}`
              }
            />
            <SummaryField
              label="Model routing"
              value={
                formValues.llmProvider.trim()
                  ? `${formValues.llmProvider} / ${formValues.llmModel || 'Provider default'}`
                  : 'Runtime default'
              }
            />
            <SummaryField
              label="Runtime image"
              value={formValues.runtimeImage.trim() || 'Set the runtime image'}
              mono
            />
          </section>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Identity and pool</CardTitle>
              <CardDescription>
                Name the worker, assign it to the orchestrator or specialist pool, and define the
                desired replica count.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="worker-name" className="text-sm font-medium">
                  Worker name
                </label>
                <Input
                  id="worker-name"
                  value={formValues.workerName}
                  onChange={(event) => setField('workerName', event.target.value)}
                  placeholder="specialist-developer-01"
                  disabled={props.mode === 'edit'}
                  aria-invalid={validationErrors.workerName ? 'true' : 'false'}
                />
                {props.mode === 'edit' ? (
                  <p className="text-xs text-muted">
                    Worker names are immutable. Create a new worker entry to rename it.
                  </p>
                ) : null}
                {validationErrors.workerName ? (
                  <p className="text-xs text-red-600">{validationErrors.workerName}</p>
                ) : null}
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Pool kind</label>
                <Select value={formValues.poolKind} onValueChange={handlePoolKindChange}>
                  <SelectTrigger data-testid="worker-pool-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {POOL_KIND_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label htmlFor="worker-role" className="text-sm font-medium">
                  Role
                </label>
                <Input
                  id="worker-role"
                  list="worker-role-suggestions"
                  value={formValues.role}
                  onChange={(event) => setField('role', event.target.value)}
                  placeholder={
                    formValues.poolKind === 'orchestrator' ? 'orchestrator' : 'developer'
                  }
                  aria-invalid={validationErrors.role ? 'true' : 'false'}
                />
                <datalist id="worker-role-suggestions">
                  {suggestedRoles.map((role) => (
                    <option key={role} value={role} />
                  ))}
                </datalist>
                {validationErrors.role ? (
                  <p className="text-xs text-red-600">{validationErrors.role}</p>
                ) : (
                  <p className="text-xs text-muted">
                    Use the role label operators expect to route and inspect work against.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <label htmlFor="worker-replicas" className="text-sm font-medium">
                  Desired replicas
                </label>
                <Input
                  id="worker-replicas"
                  type="number"
                  min={1}
                  value={formValues.replicas}
                  onChange={(event) => setField('replicas', event.target.value)}
                  aria-invalid={validationErrors.replicas ? 'true' : 'false'}
                />
                {validationErrors.replicas ? (
                  <p className="text-xs text-red-600">{validationErrors.replicas}</p>
                ) : (
                  <p className="text-xs text-muted">
                    Set the steady-state capacity that the reconciler should maintain.
                  </p>
                )}
              </div>
              <div className="space-y-2 md:col-span-2">
                <div className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div className="space-y-1">
                    <p className="text-sm font-medium">Enabled</p>
                    <p className="text-xs text-muted">
                      Disable this worker to keep the definition without placing new work on it.
                    </p>
                  </div>
                  <Switch
                    checked={formValues.enabled}
                    onCheckedChange={(checked) => setField('enabled', checked)}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Runtime posture</CardTitle>
              <CardDescription>
                Define the runtime image, resource limits, and network policy for this worker.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <label htmlFor="worker-runtime-image" className="text-sm font-medium">
                  Runtime image
                </label>
                <ImageReferenceField
                  value={formValues.runtimeImage}
                  onChange={(value) => setField('runtimeImage', value)}
                  placeholder="ghcr.io/agirunner/runtime:latest"
                  error={validationErrors.runtimeImage}
                  helperText="Match the image that should be present on the worker after reconciliation."
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="worker-cpu-limit" className="text-sm font-medium">
                  CPU limit
                </label>
                <Input
                  id="worker-cpu-limit"
                  value={formValues.cpuLimit}
                  onChange={(event) => setField('cpuLimit', event.target.value)}
                  placeholder="2"
                  aria-invalid={validationErrors.cpuLimit ? 'true' : 'false'}
                />
                {validationErrors.cpuLimit ? (
                  <p className="text-xs text-red-600">{validationErrors.cpuLimit}</p>
                ) : null}
              </div>
              <div className="space-y-2">
                <label htmlFor="worker-memory-limit" className="text-sm font-medium">
                  Memory limit
                </label>
                <Input
                  id="worker-memory-limit"
                  value={formValues.memoryLimit}
                  onChange={(event) => setField('memoryLimit', event.target.value)}
                  placeholder="2g"
                  aria-invalid={validationErrors.memoryLimit ? 'true' : 'false'}
                />
                {validationErrors.memoryLimit ? (
                  <p className="text-xs text-red-600">{validationErrors.memoryLimit}</p>
                ) : null}
              </div>
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium">Network policy</label>
                <Select
                  value={formValues.networkPolicy}
                  onValueChange={(value) =>
                    setField('networkPolicy', value as 'restricted' | 'open')
                  }
                >
                  <SelectTrigger data-testid="worker-network-policy">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {NETWORK_POLICY_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted">{networkDescription}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Model pinning</CardTitle>
              <CardDescription>
                Optionally pin this worker to a provider and model. Leave provider unset to follow
                default runtime model selection.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">LLM provider</label>
                <Select
                  value={formValues.llmProvider || DEFAULT_PROVIDER_VALUE}
                  onValueChange={handleProviderChange}
                >
                  <SelectTrigger data-testid="worker-llm-provider">
                    <SelectValue placeholder="Use runtime default" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DEFAULT_PROVIDER_VALUE}>Use runtime default</SelectItem>
                    {props.providers.map((provider) => (
                      <SelectItem key={provider.id} value={provider.name}>
                        {provider.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">LLM model</label>
                <Select
                  value={formValues.llmModel || DEFAULT_PROVIDER_VALUE}
                  onValueChange={(value) =>
                    setField('llmModel', value === DEFAULT_PROVIDER_VALUE ? '' : value)
                  }
                  disabled={!selectedProvider || props.isModelCatalogLoading}
                >
                  <SelectTrigger data-testid="worker-llm-model">
                    <SelectValue
                      placeholder={
                        props.isModelCatalogLoading ? 'Loading models...' : 'Select a model'
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DEFAULT_PROVIDER_VALUE}>Use provider default</SelectItem>
                    {availableModels.map((model) => (
                      <SelectItem key={model.id} value={model.model_id}>
                        {model.model_id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 md:col-span-2">
                <label htmlFor="worker-secret-ref" className="text-sm font-medium">
                  LLM API key secret reference
                </label>
                <Input
                  id="worker-secret-ref"
                  value={formValues.llmApiKeySecretRef}
                  onChange={(event) => setField('llmApiKeySecretRef', event.target.value)}
                  placeholder="secret:tenants/default/openai"
                />
                <p className="text-xs text-muted">
                  Store a secret reference, not a plaintext key.
                  {props.worker?.llm_api_key_secret_ref_configured
                    ? ' A secret reference is already configured for this worker.'
                    : ''}
                </p>
              </div>
              {props.modelCatalogError ? (
                <p className="text-sm text-amber-700 md:col-span-2">
                  Provider or model options are unavailable right now: {props.modelCatalogError}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Environment</CardTitle>
              <CardDescription>
                Add worker-specific environment variables. Use secret references for sensitive
                values rather than raw tokens.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {formValues.environmentEntries.map((entry) => (
                <div
                  key={entry.id}
                  className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
                >
                  <Input
                    value={entry.key}
                    onChange={(event) =>
                      setField(
                        'environmentEntries',
                        updateEnvironmentEntry(formValues.environmentEntries, entry.id, {
                          key: event.target.value,
                        }),
                      )
                    }
                    placeholder="ENV_KEY"
                  />
                  <Input
                    value={entry.value}
                    onChange={(event) =>
                      setField(
                        'environmentEntries',
                        updateEnvironmentEntry(formValues.environmentEntries, entry.id, {
                          value: event.target.value,
                        }),
                      )
                    }
                    placeholder="value or secret:..."
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setField(
                        'environmentEntries',
                        removeEnvironmentEntry(formValues.environmentEntries, entry.id),
                      )
                    }
                    aria-label="Remove environment variable"
                  >
                    <Trash2 className="h-4 w-4" />
                    Remove
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setField('environmentEntries', addEnvironmentEntry(formValues.environmentEntries))
                }
              >
                <Plus className="h-4 w-4" />
                Add environment variable
              </Button>
            </CardContent>
          </Card>

          <div className="sticky bottom-0 -mx-6 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface px-6 py-4">
            <p className="text-sm text-muted">
              {hasValidationErrors
                ? 'Fix the highlighted fields before saving this desired state.'
                : 'Saving updates fleet worker desired state immediately.'}
            </p>
            <Button type="button" variant="outline" onClick={props.onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending || hasValidationErrors}>
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {props.mode === 'create' ? 'Create worker' : 'Save changes'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
