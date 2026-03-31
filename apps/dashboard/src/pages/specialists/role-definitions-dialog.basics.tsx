import type { Dispatch, SetStateAction } from 'react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { Switch } from '../../components/ui/switch.js';
import { Textarea } from '../../components/ui/textarea.js';
import type { RoleDialogValidation } from './role-definitions-dialog.support.js';
import type {
  LlmModelRecord,
  LlmProviderRecord,
  RoleDefinition,
  RoleExecutionEnvironmentSummary,
  RoleFormState,
} from './role-definitions-page.support.js';
import { isSelectableExecutionEnvironment } from './role-definitions-page.support.js';
import { ReasoningControl } from './role-definitions-orchestrator.dialog-shared.js';

const DEFAULT_ENVIRONMENT_VALUE = '__default__';

export function RoleBasicsSection(props: {
  form: RoleFormState;
  setForm: Dispatch<SetStateAction<RoleFormState>>;
  role?: RoleDefinition | null;
  validation: RoleDialogValidation;
  showValidationErrors: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Specialist basics</CardTitle>
          <CardDescription>
            Set the specialist identity, prompt, and lifecycle state.
          </CardDescription>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted">Active</span>
            <Switch
              checked={props.form.isActive}
              onCheckedChange={(checked) =>
                props.setForm((current) => ({ ...current, isActive: checked }))
              }
              aria-label="Active specialist"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <label className="grid gap-2 text-sm">
          <span className="font-medium">Name</span>
          <Input
            value={props.form.name}
            onChange={(event) =>
              props.setForm((current) => ({ ...current, name: event.target.value }))
            }
            aria-invalid={Boolean(props.showValidationErrors && props.validation.fieldErrors.name)}
          />
          {props.showValidationErrors && props.validation.fieldErrors.name ? (
            <span className="text-xs text-red-600 dark:text-red-400">{props.validation.fieldErrors.name}</span>
          ) : null}
        </label>
        <label className="grid gap-2 text-sm">
          <span className="font-medium">Description</span>
          <Input
            value={props.form.description}
            onChange={(event) =>
              props.setForm((current) => ({ ...current, description: event.target.value }))
            }
            placeholder="What this specialist is responsible for."
          />
        </label>
        <label className="grid gap-2 text-sm">
          <span className="font-medium">System prompt</span>
          <Textarea
            value={props.form.systemPrompt}
            onChange={(event) =>
              props.setForm((current) => ({ ...current, systemPrompt: event.target.value }))
            }
            rows={8}
          />
          <span className="text-xs text-muted">
            Explain how the specialist should reason, verify, and communicate.
          </span>
        </label>
      </CardContent>
    </Card>
  );
}

export function RoleModelAssignmentSection(props: {
  models: LlmModelRecord[];
  providers: LlmProviderRecord[];
  selectedModelId: string;
  reasoningConfig: Record<string, unknown> | null;
  selectedModel?: LlmModelRecord | null;
  isLoading: boolean;
  error?: string | null;
  onModelChange: (modelId: string) => void;
  onReasoningChange: (config: Record<string, unknown> | null) => void;
}) {
  const providerNames = new Map(props.providers.map((p) => [p.id, p.name] as const));

  const reasoningValue = props.selectedModel?.reasoning_config
    ? (props.reasoningConfig?.[props.selectedModel.reasoning_config.type] as string | number | null) ?? null
    : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Model assignment</CardTitle>
        <CardDescription>
          Assign a model to this specialist. This is the same assignment shown on the Models page.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className={props.selectedModel?.reasoning_config ? 'grid gap-4 md:grid-cols-2' : ''}>
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Model</span>
            <Select
              value={props.selectedModelId || '__system__'}
              onValueChange={(value) =>
                props.onModelChange(value === '__system__' ? '' : value)
              }
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={props.isLoading ? 'Loading models...' : 'Use system default'}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__system__">Use system default</SelectItem>
                {props.models
                  .filter((m) => m.is_enabled !== false)
                  .map((model) => {
                    const provider = model.provider_name ?? (model.provider_id ? providerNames.get(model.provider_id) : null) ?? 'Unknown';
                    return (
                      <SelectItem key={model.id} value={model.id}>
                        {provider} / {model.model_id}
                      </SelectItem>
                    );
                  })}
              </SelectContent>
            </Select>
          </label>
          {props.selectedModel?.reasoning_config ? (
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Thinking</span>
              <ReasoningControl
                schema={props.selectedModel.reasoning_config}
                value={reasoningValue}
                onChange={props.onReasoningChange}
              />
            </label>
          ) : null}
        </div>
        <p className="text-xs text-muted">
          {props.error
            ? `Model catalog unavailable: ${props.error}.`
            : 'Syncs with Models. Workflow and workspace overrides can supersede.'}
        </p>
      </CardContent>
    </Card>
  );
}

export function RoleExecutionEnvironmentSection(props: {
  form: RoleFormState;
  setForm: Dispatch<SetStateAction<RoleFormState>>;
  environments: RoleExecutionEnvironmentSummary[];
}) {
  const selectedEnvironment = props.environments.find(
    (environment) => environment.id === props.form.executionEnvironmentId,
  ) ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Execution environment</CardTitle>
        <CardDescription>
          Select the specialist execution environment for this specialist. Default inherits the environment marked default on Platform &gt; Environments.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <label className="grid gap-2 text-sm">
          <span className="font-medium">Environment</span>
          <Select
            value={props.form.executionEnvironmentId || DEFAULT_ENVIRONMENT_VALUE}
            onValueChange={(value) =>
              props.setForm((current) => ({
                ...current,
                executionEnvironmentId: value === DEFAULT_ENVIRONMENT_VALUE ? '' : value,
              }))
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Use default environment" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT_ENVIRONMENT_VALUE}>Default environment</SelectItem>
              {props.environments.map((environment) => (
                <SelectItem
                  key={environment.id}
                  value={environment.id}
                  disabled={!isSelectableExecutionEnvironment(environment)}
                >
                  {environment.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <ExecutionEnvironmentDetails environment={selectedEnvironment} />
      </CardContent>
    </Card>
  );
}

function ExecutionEnvironmentDetails(props: {
  environment: RoleExecutionEnvironmentSummary | null;
}) {
  if (!props.environment) {
    return (
      <div className="rounded-lg border border-border/70 bg-muted/10 px-4 py-3 text-sm text-muted">
        Specialists without an override inherit the default environment, including its image, CPU, memory, and pull policy.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/70 bg-muted/10 px-4 py-3">
      <p className="font-medium text-foreground">{props.environment.name}</p>
      <dl className="mt-3 grid gap-3 text-sm md:grid-cols-2">
        <EnvironmentDetail label="Image" value={props.environment.image} mono />
        <EnvironmentDetail label="Resources" value={`CPU ${props.environment.cpu} | Memory ${props.environment.memory}`} />
        <EnvironmentDetail label="Pull policy" value={props.environment.pull_policy} />
        <EnvironmentDetail label="Source" value={buildSourceLabel(props.environment)} />
      </dl>
    </div>
  );
}

function EnvironmentDetail(props: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-[0.16em] text-muted">{props.label}</dt>
      <dd className={props.mono ? 'mt-1 font-mono text-foreground' : 'mt-1 text-foreground'}>
        {props.value}
      </dd>
    </div>
  );
}

function buildSourceLabel(environment: RoleExecutionEnvironmentSummary): string {
  if (environment.source_kind === 'custom') {
    return 'Custom';
  }
  if (environment.catalog_key && environment.catalog_version) {
    return `${environment.catalog_key} v${environment.catalog_version}`;
  }
  return 'Catalog';
}
