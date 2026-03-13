import { useMutation } from '@tanstack/react-query';
import type { NavigateFunction } from 'react-router-dom';

import {
  dashboardApi,
  type DashboardWorkflowBudgetInput,
} from '../../lib/api.js';
import {
  buildModelOverrides,
  buildParametersFromDrafts,
  buildStructuredObject,
  mergeStructuredObjects,
  type RoleOverrideDraft,
  type StructuredEntryDraft,
  type readLaunchDefinition,
} from './playbook-launch-support.js';

interface UsePlaybookLaunchMutationInput {
  navigate: NavigateFunction;
  selectedPlaybookId: string;
  workflowName: string;
  projectId: string;
  launchDefinition: ReturnType<typeof readLaunchDefinition>;
  parameterDrafts: Record<string, string>;
  extraParameterDrafts: StructuredEntryDraft[];
  metadataDrafts: StructuredEntryDraft[];
  modelOverrideDrafts: RoleOverrideDraft[];
  workflowBudget?: DashboardWorkflowBudgetInput;
  setError(message: string | null): void;
}

export function usePlaybookLaunchMutation(input: UsePlaybookLaunchMutationInput) {
  return useMutation({
    mutationFn: async () => {
      const parameters = mergeStructuredObjects(
        buildParametersFromDrafts(input.launchDefinition.parameterSpecs, input.parameterDrafts),
        buildStructuredObject(input.extraParameterDrafts, 'Additional parameters'),
        'Parameters',
      );
      const metadata = buildStructuredObject(input.metadataDrafts, 'Metadata');
      return dashboardApi.createWorkflow({
        playbook_id: input.selectedPlaybookId,
        name: input.workflowName.trim(),
        project_id: input.projectId || undefined,
        parameters,
        metadata,
        model_overrides: buildModelOverrides(input.modelOverrideDrafts),
        budget: input.workflowBudget,
      });
    },
    onSuccess: (workflow) => {
      input.navigate(`/work/workflows/${workflow.id}`);
    },
    onError: (mutationError) => {
      input.setError(
        mutationError instanceof Error ? mutationError.message : 'Failed to launch playbook',
      );
    },
  });
}
