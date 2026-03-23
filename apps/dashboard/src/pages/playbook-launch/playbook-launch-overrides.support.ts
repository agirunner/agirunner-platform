import type {
  DashboardLlmModelRecord,
  DashboardLlmProviderRecord,
  DashboardRoleModelOverride,
} from '../../lib/api.js';
import {
  buildModelOverrides,
  type RoleOverrideDraft,
} from './playbook-launch-support.js';
import type { StructuredChoiceOption } from '../playbook-authoring/playbook-authoring-structured-controls.js';

export function countConfiguredWorkflowOverrides(drafts: RoleOverrideDraft[]): number {
  return drafts.filter(
    (draft) =>
      draft.provider.trim().length > 0 ||
      draft.model.trim().length > 0 ||
      draft.reasoningEntries.some(
        (entry) => entry.key.trim().length > 0 || entry.value.trim().length > 0,
      ),
  ).length;
}

export function readWorkflowOverrides(
  drafts: RoleOverrideDraft[],
): { value?: Record<string, DashboardRoleModelOverride>; error?: string } {
  try {
    return { value: buildModelOverrides(drafts) ?? {} };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Workflow model overrides are invalid.',
    };
  }
}

export function findProviderByDraft(
  providers: DashboardLlmProviderRecord[],
  providerName: string,
): DashboardLlmProviderRecord | null {
  const normalized = providerName.trim();
  if (!normalized) return null;
  return providers.find((provider) => provider.name === normalized) ?? null;
}

export function listModelsForProvider(
  models: DashboardLlmModelRecord[],
  provider: DashboardLlmProviderRecord | null,
): DashboardLlmModelRecord[] {
  if (!provider) return [];
  return models.filter(
    (model) => model.provider_id === provider.id || model.provider_name === provider.name,
  );
}

export function updateProviderForRoleDraft(
  drafts: RoleOverrideDraft[],
  draftId: string,
  providerId: string,
  providers: DashboardLlmProviderRecord[],
  models: DashboardLlmModelRecord[],
): RoleOverrideDraft[] {
  if (providerId === '__unset__') {
    return updateRoleDraft(drafts, draftId, { provider: '', model: '' });
  }
  const provider = providers.find((entry) => entry.id === providerId);
  if (!provider) return drafts;
  const allowedModels = listModelsForProvider(models, provider).map((model) => model.model_id);
  const currentDraft = drafts.find((entry) => entry.id === draftId);
  const nextModel =
    currentDraft && allowedModels.includes(currentDraft.model) ? currentDraft.model : '';
  return updateRoleDraft(drafts, draftId, { provider: provider.name, model: nextModel });
}

export function availableRoleOverrideOptions(
  options: StructuredChoiceOption[],
  drafts: RoleOverrideDraft[],
  currentDraft: RoleOverrideDraft,
): StructuredChoiceOption[] {
  const claimedRoles = new Set(
    drafts
      .filter((draft) => draft.id !== currentDraft.id)
      .map((draft) => draft.role.trim())
      .filter(Boolean),
  );
  return options.filter(
    (option) => option.value === currentDraft.role.trim() || !claimedRoles.has(option.value),
  );
}

export function updateRoleDraft(
  drafts: RoleOverrideDraft[],
  draftId: string,
  patch: Partial<RoleOverrideDraft>,
): RoleOverrideDraft[] {
  return drafts.map((draft) => (draft.id === draftId ? { ...draft, ...patch } : draft));
}
