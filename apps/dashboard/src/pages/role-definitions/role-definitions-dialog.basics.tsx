import type { Dispatch, SetStateAction } from 'react';

import { ImageReferenceField } from '../../components/forms/image-reference-field.js';
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
import type {
  RoleDialogValidation,
} from './role-definitions-dialog.support.js';
import type {
  LlmModelRecord,
  LlmProviderRecord,
  RoleDefinition,
  RoleFormState,
} from './role-definitions-page.support.js';
import { ReasoningControl } from './role-definitions-orchestrator.dialog-shared.js';

const PULL_POLICY_OPTIONS = ['always', 'if-not-present', 'never'] as const;

export function RoleBasicsSection(props: {
  form: RoleFormState;
  setForm: Dispatch<SetStateAction<RoleFormState>>;
  role?: RoleDefinition | null;
  validation: RoleDialogValidation;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Role basics</CardTitle>
          <CardDescription>
            Set the role identity, prompt, and lifecycle state.
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
              aria-label="Active role"
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
            aria-invalid={Boolean(props.validation.fieldErrors.name)}
          />
          {props.validation.fieldErrors.name ? (
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
            placeholder="What this role is responsible for."
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
          Assign a model to this role. This is the same assignment shown on the Models page.
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

export function RoleExecutionContainerSection(props: {
  form: RoleFormState;
  setForm: Dispatch<SetStateAction<RoleFormState>>;
  validation: RoleDialogValidation;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Specialist Execution container override</CardTitle>
        <CardDescription>
          Override the default Specialist Execution environment for this role. Leave fields blank to inherit the system defaults from Runtimes.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-2 text-sm md:col-span-2">
          <span className="font-medium">Image</span>
          <ImageReferenceField
            value={props.form.executionContainer.image}
            onChange={(value) =>
              props.setForm((current) => ({
                ...current,
                executionContainer: {
                  ...current.executionContainer,
                  image: value,
                },
              }))
            }
            placeholder="agirunner-runtime-execution:local"
            helperText="Blank means this role uses the default Specialist Execution image."
            error={props.validation.fieldErrors.executionContainerImage}
            listId="role-execution-image-suggestions"
          />
        </label>
        <label className="grid gap-2 text-sm">
          <span className="font-medium">CPU</span>
          <Input
            value={props.form.executionContainer.cpu}
            aria-invalid={Boolean(props.validation.fieldErrors.executionContainerCpu)}
            onChange={(event) =>
              props.setForm((current) => ({
                ...current,
                executionContainer: {
                  ...current.executionContainer,
                  cpu: event.target.value,
                },
              }))
            }
            placeholder="2"
          />
          {props.validation.fieldErrors.executionContainerCpu ? (
            <span className="text-xs text-red-600 dark:text-red-400">
              {props.validation.fieldErrors.executionContainerCpu}
            </span>
          ) : null}
        </label>
        <label className="grid gap-2 text-sm">
          <span className="font-medium">Memory</span>
          <Input
            value={props.form.executionContainer.memory}
            aria-invalid={Boolean(props.validation.fieldErrors.executionContainerMemory)}
            onChange={(event) =>
              props.setForm((current) => ({
                ...current,
                executionContainer: {
                  ...current.executionContainer,
                  memory: event.target.value,
                },
              }))
            }
            placeholder="512m"
          />
          {props.validation.fieldErrors.executionContainerMemory ? (
            <span className="text-xs text-red-600 dark:text-red-400">
              {props.validation.fieldErrors.executionContainerMemory}
            </span>
          ) : null}
        </label>
        <label className="grid gap-2 text-sm md:col-span-2">
          <span className="font-medium">Pull policy</span>
          <Select
            value={props.form.executionContainer.pullPolicy || '__inherit__'}
            onValueChange={(value) =>
              props.setForm((current) => ({
                ...current,
                executionContainer: {
                  ...current.executionContainer,
                  pullPolicy: value === '__inherit__' ? '' : value,
                },
              }))
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Inherit system default" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__inherit__">Inherit system default</SelectItem>
              {PULL_POLICY_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </CardContent>
    </Card>
  );
}
