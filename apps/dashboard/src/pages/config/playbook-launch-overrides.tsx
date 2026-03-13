import { useMemo } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import type {
  DashboardLlmModelRecord,
  DashboardLlmProviderRecord,
} from '../../lib/api.js';
import type { RoleOverrideValidationResult } from './playbook-launch-entry-validation.js';
import {
  createRoleOverrideDraft,
  type RoleOverrideDraft,
} from './playbook-launch-support.js';
import {
  SelectWithCustomControl,
  type StructuredChoiceOption,
} from './playbook-authoring-structured-controls.js';
import { StructuredEntryEditor } from './playbook-launch-entries.js';
import {
  availableRoleOverrideOptions,
  countConfiguredWorkflowOverrides,
  findProviderByDraft,
  listModelsForProvider,
  readWorkflowOverrides,
  updateProviderForRoleDraft,
  updateRoleDraft,
} from './playbook-launch-overrides.support.js';

export { countConfiguredWorkflowOverrides, readWorkflowOverrides } from './playbook-launch-overrides.support.js';

export function RoleOverrideEditor(props: {
  drafts: RoleOverrideDraft[];
  playbookRoles: string[];
  providers: DashboardLlmProviderRecord[];
  models: DashboardLlmModelRecord[];
  validation: RoleOverrideValidationResult;
  onChange(drafts: RoleOverrideDraft[]): void;
}): JSX.Element {
  const enabledModels = useMemo(
    () => props.models.filter((model) => model.is_enabled !== false),
    [props.models],
  );
  const roleOptions = useMemo<StructuredChoiceOption[]>(
    () =>
      props.playbookRoles.map((role) => ({
        value: role,
        label: role,
        description: 'Declared in the selected playbook.',
      })),
    [props.playbookRoles],
  );

  return (
    <div className="space-y-3">
      {props.drafts.length === 0 ? (
        <p className="text-sm text-muted">No workflow-specific model overrides configured.</p>
      ) : (
        props.drafts.map((draft, index) => (
          <RoleOverrideCard
            key={draft.id}
            draft={draft}
            index={index}
            playbookRoles={props.playbookRoles}
            providers={props.providers}
            enabledModels={enabledModels}
            roleOptions={roleOptions}
            allDrafts={props.drafts}
            validation={props.validation}
            onChange={props.onChange}
          />
        ))
      )}
      <Button
        type="button"
        variant="outline"
        onClick={() => props.onChange([...props.drafts, createRoleOverrideDraft()])}
      >
        <Plus className="h-4 w-4" />
        Add custom role override
      </Button>
    </div>
  );
}

function RoleOverrideCard(props: {
  draft: RoleOverrideDraft;
  index: number;
  playbookRoles: string[];
  providers: DashboardLlmProviderRecord[];
  enabledModels: DashboardLlmModelRecord[];
  roleOptions: StructuredChoiceOption[];
  allDrafts: RoleOverrideDraft[];
  validation: RoleOverrideValidationResult;
  onChange(drafts: RoleOverrideDraft[]): void;
}): JSX.Element {
  const isPlaybookRole = props.playbookRoles.includes(props.draft.role.trim());
  const selectedProvider = findProviderByDraft(props.providers, props.draft.provider);
  const availableModels = listModelsForProvider(props.enabledModels, selectedProvider);
  const fieldErrors = props.validation.draftErrors[props.index] ?? {
    reasoning: { entryErrors: [], blockingIssues: [], isValid: true },
  };

  return (
    <div className="grid gap-3 rounded-xl border border-border/70 bg-muted/10 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={isPlaybookRole ? 'secondary' : 'outline'}>
            {isPlaybookRole ? 'playbook role' : 'custom role'}
          </Badge>
          <span className="text-sm font-medium">
            {props.draft.role.trim() || 'New role override'}
          </span>
        </div>
        {!isPlaybookRole ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              props.onChange(
                props.allDrafts.filter((entry) => entry.id !== props.draft.id),
              )
            }
          >
            <Trash2 className="h-4 w-4" />
            Remove Override
          </Button>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="grid gap-1 text-xs">
          <span className="font-medium">Role</span>
          {isPlaybookRole ? (
            <div className="rounded-md border border-border/70 bg-background/80 px-3 py-2 text-sm text-foreground">
              {props.draft.role}
            </div>
          ) : (
            <SelectWithCustomControl
              value={props.draft.role}
              options={availableRoleOverrideOptions(
                props.roleOptions,
                props.allDrafts,
                props.draft,
              )}
              placeholder="Select a role"
              unsetLabel="Unset role"
              customPlaceholder="Custom role"
              onChange={(value) =>
                props.onChange(
                  updateRoleDraft(props.allDrafts, props.draft.id, { role: value }),
                )
              }
            />
          )}
          {fieldErrors?.role ? (
            <span className="text-xs text-red-600">{fieldErrors.role}</span>
          ) : (
            <span className="text-xs text-muted">
              Prefer declared playbook roles so overrides stay aligned with the selected run.
            </span>
          )}
        </label>
        <label className="grid gap-1 text-xs">
          <span className="font-medium">Provider</span>
          <Select
            value={selectedProvider?.id ?? '__unset__'}
            onValueChange={(value) =>
              props.onChange(
                updateProviderForRoleDraft(
                  props.allDrafts,
                  props.draft.id,
                  value,
                  props.providers,
                  props.enabledModels,
                ),
              )
            }
          >
            <SelectTrigger
              aria-invalid={fieldErrors?.provider ? true : undefined}
              className={
                fieldErrors?.provider
                  ? 'border-red-300 focus-visible:ring-red-500'
                  : undefined
              }
            >
              <SelectValue placeholder="Select provider" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__unset__">Unset</SelectItem>
              {props.providers.map((provider) => (
                <SelectItem key={provider.id} value={provider.id}>
                  {provider.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {fieldErrors?.provider ? (
            <span className="text-xs text-red-600">{fieldErrors.provider}</span>
          ) : (
            <span className="text-xs text-muted">
              Start with the provider so the model list stays bounded to valid choices.
            </span>
          )}
        </label>
        <label className="grid gap-1 text-xs sm:col-span-2 lg:col-span-1">
          <span className="font-medium">Model</span>
          <Select
            value={props.draft.model || '__unset__'}
            onValueChange={(value) =>
              props.onChange(
                updateRoleDraft(props.allDrafts, props.draft.id, {
                  model: value === '__unset__' ? '' : value,
                }),
              )
            }
            disabled={availableModels.length === 0}
          >
            <SelectTrigger
              aria-invalid={fieldErrors?.model ? true : undefined}
              className={
                fieldErrors?.model
                  ? 'border-red-300 focus-visible:ring-red-500'
                  : undefined
              }
            >
              <SelectValue
                placeholder={selectedProvider ? 'Select model' : 'Select a provider first'}
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__unset__">Unset</SelectItem>
              {availableModels.map((model) => (
                <SelectItem key={model.id} value={model.model_id}>
                  {model.model_id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {fieldErrors?.model ? (
            <span className="text-xs text-red-600">{fieldErrors.model}</span>
          ) : (
            <span className="text-xs text-muted">
              Choose a discovered model instead of typing an unverified override target.
            </span>
          )}
        </label>
      </div>
      <p className="text-xs text-muted">
        Choose from discovered models for the selected provider. Manage providers and model
        discovery on the LLM Providers page.
      </p>
      <StructuredEntryEditor
        title="Reasoning Config Entries"
        description="Add only the reasoning settings this role needs as structured key/value entries."
        drafts={props.draft.reasoningEntries}
        validation={fieldErrors.reasoning}
        addLabel="Add reasoning setting"
        onChange={(reasoningEntries) =>
          props.onChange(
            updateRoleDraft(props.allDrafts, props.draft.id, { reasoningEntries }),
          )
        }
      />
    </div>
  );
}
