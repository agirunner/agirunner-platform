import type { Dispatch, SetStateAction } from 'react';

import { Badge } from '../../components/ui/badge.js';
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

export function RoleBasicsSection(props: {
  form: RoleFormState;
  setForm: Dispatch<SetStateAction<RoleFormState>>;
  role?: RoleDefinition | null;
  validation: RoleDialogValidation;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Role basics</CardTitle>
        <CardDescription>
          Set the role identity, prompt, and lifecycle state.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
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
        <div className="flex items-center justify-between rounded-lg border border-border/70 bg-muted/10 px-4 py-3">
          <div>
            <div className="font-medium">Active role</div>
            <p className="text-sm text-muted">
              Inactive roles stay visible but are excluded from active use.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {props.role ? (
              <Badge variant={props.role.is_built_in ? 'secondary' : 'outline'}>
                {props.role.is_built_in ? 'Built-in' : 'Custom'}
              </Badge>
            ) : null}
            <Switch
              checked={props.form.isActive}
              onCheckedChange={(checked) =>
                props.setForm((current) => ({ ...current, isActive: checked }))
              }
              aria-label="Active role"
            />
          </div>
        </div>
        <label className="grid gap-2 text-sm md:col-span-2">
          <span className="font-medium">Description</span>
          <Input
            value={props.form.description}
            onChange={(event) =>
              props.setForm((current) => ({ ...current, description: event.target.value }))
            }
            placeholder="What this role is responsible for."
          />
        </label>
        <label className="grid gap-2 text-sm md:col-span-2">
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
    ? (props.reasoningConfig?.[props.selectedModel.reasoning_config.key] as string | number | null) ?? null
    : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Model assignment</CardTitle>
        <CardDescription>
          Assign a model to this role. This is the same assignment shown on the LLM Providers page.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
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
                    <SelectItem key={model.model_id} value={model.model_id}>
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
        <div className="rounded-lg border border-border/70 bg-muted/10 px-4 py-3 text-sm text-muted">
          {props.error
            ? `Model catalog unavailable: ${props.error}. Existing selections remain editable.`
            : 'This assignment syncs with the LLM Providers page. Workflow and project overrides can still supersede it.'}
        </div>
      </CardContent>
    </Card>
  );
}
