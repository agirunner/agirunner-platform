import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';

import {
  defaultParameterDraftValue,
  readMappedProjectParameterDraft,
  syncRoleOverrideDrafts,
  type RoleOverrideDraft,
  type StructuredEntryDraft,
  type WorkflowBudgetDraft,
  type readLaunchDefinition,
} from './playbook-launch-support.js';
import type { DashboardPlaybookRecord, DashboardProjectRecord } from '../../lib/api.js';

interface UsePlaybookLaunchPageEffectsInput {
  paramsId?: string;
  selectedPlaybookId: string;
  selectedPlaybook: DashboardPlaybookRecord | null;
  selectedProject: DashboardProjectRecord | null;
  launchDefinition: ReturnType<typeof readLaunchDefinition>;
  workflowName: string;
  projectId: string;
  extraParameterDrafts: StructuredEntryDraft[];
  metadataDrafts: StructuredEntryDraft[];
  modelOverrideDrafts: RoleOverrideDraft[];
  workflowBudgetDraft: WorkflowBudgetDraft;
  autoFilledParameterDraftsRef: MutableRefObject<Record<string, string>>;
  setSelectedPlaybookId: Dispatch<SetStateAction<string>>;
  setWorkflowName: Dispatch<SetStateAction<string>>;
  setParameterDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  setModelOverrideDrafts: Dispatch<SetStateAction<RoleOverrideDraft[]>>;
  setError: Dispatch<SetStateAction<string | null>>;
}

export function usePlaybookLaunchPageEffects(
  input: UsePlaybookLaunchPageEffectsInput,
): void {
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
      const next = { ...current };
      const nextAutoFilled: Record<string, string> = {};
      for (const spec of input.launchDefinition.parameterSpecs) {
        const defaultValue = defaultParameterDraftValue(spec.defaultValue, spec.inputType);
        const mappedValue = readMappedProjectParameterDraft(spec, input.selectedProject);
        const currentValue = current[spec.key];
        const priorAutoFilled = input.autoFilledParameterDraftsRef.current[spec.key];
        if (mappedValue !== undefined) {
          nextAutoFilled[spec.key] = mappedValue;
        }
        const shouldAutofill =
          mappedValue !== undefined &&
          (currentValue === undefined ||
            currentValue === '' ||
            currentValue === defaultValue ||
            currentValue === priorAutoFilled);
        if (shouldAutofill) {
          next[spec.key] = mappedValue;
          continue;
        }
        if (currentValue === undefined || currentValue === priorAutoFilled) {
          next[spec.key] = defaultValue;
        }
      }
      input.autoFilledParameterDraftsRef.current = nextAutoFilled;
      return next;
    });
  }, [
    input.autoFilledParameterDraftsRef,
    input.launchDefinition.parameterSpecs,
    input.selectedProject,
    input.setParameterDrafts,
  ]);

  useEffect(() => {
    input.setModelOverrideDrafts((current) =>
      syncRoleOverrideDrafts(input.launchDefinition.roles, current),
    );
  }, [input.launchDefinition.roles, input.setModelOverrideDrafts]);

  useEffect(() => {
    input.setError(null);
  }, [
    input.extraParameterDrafts,
    input.metadataDrafts,
    input.modelOverrideDrafts,
    input.projectId,
    input.selectedPlaybookId,
    input.setError,
    input.workflowBudgetDraft,
    input.workflowName,
  ]);
}
