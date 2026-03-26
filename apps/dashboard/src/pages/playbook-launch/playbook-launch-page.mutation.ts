import { useMutation } from '@tanstack/react-query';
import type { NavigateFunction } from 'react-router-dom';

import { dashboardApi, type DashboardWorkflowBudgetInput } from '../../lib/api.js';
import {
  buildModelOverrides,
  buildParametersFromDrafts,
  buildStructuredObject,
  type RoleOverrideDraft,
  type StructuredEntryDraft,
  type readLaunchDefinition,
} from './playbook-launch-support.js';
import {
  buildInstructionConfig,
  buildWorkflowConfigOverrides,
  type InstructionLayerName,
  type WorkflowPolicyDefinition,
} from './playbook-launch-workflow-policy.support.js';

interface UsePlaybookLaunchMutationInput {
  navigate: NavigateFunction;
  selectedPlaybookId: string;
  workflowName: string;
  workspaceId: string;
  launchDefinition: ReturnType<typeof readLaunchDefinition>;
  parameterDrafts: Record<string, string>;
  metadataDrafts: StructuredEntryDraft[];
  workflowPolicyDefinition: WorkflowPolicyDefinition;
  workflowConfigDrafts: Record<string, string>;
  extraWorkflowConfigDrafts: StructuredEntryDraft[];
  suppressedInstructionLayers: InstructionLayerName[];
  modelOverrideDrafts: RoleOverrideDraft[];
  workflowBudget?: DashboardWorkflowBudgetInput;
  setError(message: string | null): void;
}

export function usePlaybookLaunchMutation(input: UsePlaybookLaunchMutationInput) {
  return useMutation({
    mutationFn: async () => {
      const parameters = buildParametersFromDrafts(
        input.launchDefinition.parameterSpecs,
        input.parameterDrafts,
      );
      const metadata = buildStructuredObject(input.metadataDrafts, 'Metadata');
      return dashboardApi.createWorkflow({
        playbook_id: input.selectedPlaybookId,
        name: input.workflowName.trim(),
        workspace_id: input.workspaceId || undefined,
        parameters,
        metadata,
        config_overrides: buildWorkflowConfigOverrides({
          specs: input.workflowPolicyDefinition.configOverrideSpecs,
          draftValues: input.workflowConfigDrafts,
          extraDrafts: input.extraWorkflowConfigDrafts,
        }),
        instruction_config: buildInstructionConfig({
          suppressedLayers: input.suppressedInstructionLayers,
          defaultSuppressedLayers: input.workflowPolicyDefinition.defaultSuppressedLayers,
        }),
        model_overrides: buildModelOverrides(input.modelOverrideDrafts),
        budget: input.workflowBudget,
      });
    },
    onSuccess: (workflow) => {
      input.navigate(`/mission-control/workflows/${workflow.id}`);
    },
    onError: (mutationError) => {
      input.setError(
        mutationError instanceof Error ? mutationError.message : 'Failed to launch playbook',
      );
    },
  });
}
