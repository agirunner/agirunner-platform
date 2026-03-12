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
  listModelsForProvider,
  listSuggestedWorkerRoles,
  NETWORK_POLICY_OPTIONS,
  POOL_KIND_OPTIONS,
  type WorkerDesiredStateFormValues,
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

export function WorkerDesiredStateDialog(
  props: WorkerDesiredStateDialogProps,
): JSX.Element {
  const queryClient = useQueryClient();
  const [formValues, setFormValues] = useState<WorkerDesiredStateFormValues>(
    buildWorkerFormValues(),
  );

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

  const mutation = useMutation({
    mutationFn: async () => {
      if (props.mode === 'create') {
        return dashboardApi.createFleetWorker(buildCreateWorkerPayload(formValues));
      }
      if (!props.worker) {
        throw new Error('Worker is required to update desired state.');
      }
      return dashboardApi.updateFleetWorker(
        props.worker.id,
        buildUpdateWorkerPayload(formValues),
      );
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
      role:
        nextPoolKind === 'orchestrator' && !current.role.trim()
          ? 'orchestrator'
          : current.role,
    }));
  }

  function handleProviderChange(nextValue: string): void {
    if (nextValue === DEFAULT_PROVIDER_VALUE) {
      setFormValues((current) => ({ ...current, llmProvider: '', llmModel: '' }));
      return;
    }
    const provider =
      props.providers.find((candidate) => candidate.name === nextValue) ?? null;
    const allowedModels = listModelsForProvider(props.models, provider);
    const nextModel = allowedModels.some(
      (model) => model.model_id === formValues.llmModel,
    )
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

  const title =
    props.mode === 'create' ? 'Register Fleet Worker' : 'Edit Worker Desired State';

  return (
    <Dialog open={props.isOpen} onOpenChange={(open) => (!open ? props.onClose() : undefined)}>
      <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Configure the desired runtime posture, pool assignment, model pinning, and environment
            for this worker entry.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
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
                />
                {props.mode === 'edit' ? (
                  <p className="text-xs text-muted">
                    Worker names are immutable. Create a new worker entry to rename it.
                  </p>
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
                />
                <datalist id="worker-role-suggestions">
                  {suggestedRoles.map((role) => (
                    <option key={role} value={role} />
                  ))}
                </datalist>
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
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <div className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div className="space-y-1">
                    <p className="text-sm font-medium">Enabled</p>
                    <p className="text-xs text-muted">
                      Disable a worker entry without removing its desired-state record.
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
                <Input
                  id="worker-runtime-image"
                  value={formValues.runtimeImage}
                  onChange={(event) => setField('runtimeImage', event.target.value)}
                  placeholder="ghcr.io/agirunner/runtime:latest"
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
                />
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
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium">Network policy</label>
                <Select
                  value={formValues.networkPolicy}
                  onValueChange={(value) => setField('networkPolicy', value as 'restricted' | 'open')}
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
                <p className="text-xs text-muted">
                  {
                    NETWORK_POLICY_OPTIONS.find(
                      (option) => option.value === formValues.networkPolicy,
                    )?.description
                  }
                </p>
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
                    <SelectItem value={DEFAULT_PROVIDER_VALUE}>
                      Use runtime default
                    </SelectItem>
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
                    <SelectItem value={DEFAULT_PROVIDER_VALUE}>
                      Use provider default
                    </SelectItem>
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
                    size="icon"
                    onClick={() =>
                      setField(
                        'environmentEntries',
                        removeEnvironmentEntry(formValues.environmentEntries, entry.id),
                      )
                    }
                    aria-label="Remove environment variable"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setField(
                    'environmentEntries',
                    addEnvironmentEntry(formValues.environmentEntries),
                  )
                }
              >
                <Plus className="h-4 w-4" />
                Add environment variable
              </Button>
            </CardContent>
          </Card>

          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={props.onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                mutation.isPending ||
                !formValues.workerName.trim() ||
                !formValues.role.trim() ||
                !formValues.runtimeImage.trim()
              }
            >
              {mutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              {props.mode === 'create' ? 'Create worker' : 'Save changes'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
