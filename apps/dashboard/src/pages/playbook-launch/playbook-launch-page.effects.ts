import { useEffect, type Dispatch, type SetStateAction } from 'react';

import {
  syncRoleOverrideDrafts,
  type RoleOverrideDraft,
  type StructuredEntryDraft,
  type WorkflowBudgetDraft,
  type readLaunchDefinition,
} from './playbook-launch-support.js';
import type { DashboardPlaybookRecord, DashboardWorkspaceRecord } from '../../lib/api.js';

interface UsePlaybookLaunchPageEffectsInput {
  paramsId?: string;
  selectedPlaybookId: string;
  selectedPlaybook: DashboardPlaybookRecord | null;
  selectedWorkspace: DashboardWorkspaceRecord | null;
  launchDefinition: ReturnType<typeof readLaunchDefinition>;
  workflowName: string;
  workspaceId: string;
  metadataDrafts: StructuredEntryDraft[];
  workflowConfigDrafts: Record<string, string>;
  extraWorkflowConfigDrafts: StructuredEntryDraft[];
  suppressedInstructionLayers: string[];
  modelOverrideDrafts: RoleOverrideDraft[];
  workflowBudgetDraft: WorkflowBudgetDraft;
  setSelectedPlaybookId: Dispatch<SetStateAction<string>>;
  setWorkflowName: Dispatch<SetStateAction<string>>;
  setParameterDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  setModelOverrideDrafts: Dispatch<SetStateAction<RoleOverrideDraft[]>>;
  setError: Dispatch<SetStateAction<string | null>>;
}

export function usePlaybookLaunchPageEffects(input: UsePlaybookLaunchPageEffectsInput): void {
  useEffect(() => {
    if (!input.workflowName.trim() && input.selectedPlaybook) {
      input.setWorkflowName(`${input.selectedPlaybook.name} Run`);
    }
  }, [input.selectedPlaybook, input.setWorkflowName, input.workflowName]);

  useEffect(() => {
    input.setSelectedPlaybookId(input.paramsId ?? '');
  }, [input.paramsId, input.setSelectedPlaybookId]);

  useEffect(() => {
    input.setParameterDrafts((current) => {
      return Object.fromEntries(
        input.launchDefinition.parameterSpecs.map((spec) => [spec.slug, current[spec.slug] ?? '']),
      );
    });
  }, [input.launchDefinition.parameterSpecs, input.setParameterDrafts]);

  useEffect(() => {
    input.setModelOverrideDrafts((current) =>
      syncRoleOverrideDrafts(input.launchDefinition.roles, current),
    );
  }, [input.launchDefinition.roles, input.setModelOverrideDrafts]);

  useEffect(() => {
    input.setError(null);
  }, [
    input.extraWorkflowConfigDrafts,
    input.suppressedInstructionLayers,
    input.metadataDrafts,
    input.workflowConfigDrafts,
    input.modelOverrideDrafts,
    input.workspaceId,
    input.selectedPlaybookId,
    input.setError,
    input.workflowBudgetDraft,
    input.workflowName,
  ]);
}
