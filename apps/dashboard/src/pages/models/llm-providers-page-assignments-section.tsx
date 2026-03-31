import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';

import {
  DEFAULT_FORM_VALIDATION_MESSAGE,
  FieldErrorText,
  FormFeedbackMessage,
  resolveFormFeedbackMessage,
} from '../../components/forms/form-feedback.js';
import { DEFAULT_LIST_PAGE_SIZE, paginateListItems } from '../../lib/pagination/list-pagination.js';
import { DashboardSectionCard } from '../../components/layout/dashboard-section-card.js';
import { Button } from '../../components/ui/button.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { dashboardApi } from '../../lib/api.js';
import { toast } from '../../lib/toast.js';
import { buildAssignmentRoleRows } from './llm-providers-page.defaults.js';
import {
  DIALOG_ALERT_CLASS_NAME,
  panelToneStyle,
  SubsectionPanel,
} from './llm-providers-page.chrome.js';
import { ReasoningControl, type RoleState } from './llm-providers-page-assignment-controls.js';
import {
  buildRoleStateMap,
  readHasUnsavedChanges,
  RoleAssignmentsOverridesPanel,
} from './llm-providers-page-assignments-overrides.js';
import type { AssignmentSurfaceSummaryCard } from './llm-providers-page.support.js';
import {
  summarizeAssignmentSurface,
  validateAssignmentSetup,
} from './llm-providers-page.support.js';
import type {
  LlmModel,
  RoleAssignment,
  RoleDefinitionSummary,
  SystemDefault,
} from './llm-providers-page.types.js';

export function RoleAssignmentsSection(props: {
  enabledModels: LlmModel[];
  assignments: RoleAssignment[];
  roleDefinitions: RoleDefinitionSummary[];
  systemDefault: SystemDefault;
  onSummaryCardsChange(cards: AssignmentSurfaceSummaryCard[]): void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const roleRows = buildAssignmentRoleRows(props.roleDefinitions, props.assignments);
  const activeRoleCount = roleRows.filter((role) => role.isActive).length;
  const inactiveRoleCount = roleRows.filter(
    (role) => role.source === 'catalog' && role.isActive === false,
  ).length;
  const missingAssignmentCount = roleRows.filter((role) => role.source === 'assignment').length;
  const staleRoleCount = missingAssignmentCount;

  const [defaultModelId, setDefaultModelId] = useState(props.systemDefault.modelId ?? '__none__');
  const [defaultReasoning, setDefaultReasoning] = useState<Record<string, unknown> | null>(
    props.systemDefault.reasoningConfig,
  );
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_LIST_PAGE_SIZE);
  const [hasAttemptedSave, setHasAttemptedSave] = useState(false);
  const [isOverridesExpanded, setIsOverridesExpanded] = useState(false);
  const [roleStates, setRoleStates] = useState<Record<string, RoleState>>(() =>
    buildRoleStateMap(roleRows, props.assignments),
  );

  useEffect(() => {
    setDefaultModelId(props.systemDefault.modelId ?? '__none__');
    setDefaultReasoning(props.systemDefault.reasoningConfig);
  }, [props.systemDefault.modelId, props.systemDefault.reasoningConfig]);

  useEffect(() => {
    setRoleStates(buildRoleStateMap(roleRows, props.assignments));
  }, [props.assignments, roleRows]);

  const pagination = paginateListItems(roleRows, page, pageSize);
  const defaultModel = props.enabledModels.find((model) => model.id === defaultModelId);
  const defaultReasoningSchema = defaultModel?.reasoning_config ?? null;
  const assignmentValidation = validateAssignmentSetup({
    defaultModelId,
    roleAssignments: roleRows.map((role) => ({
      roleName: role.name,
      modelId: roleStates[role.name]?.modelId ?? '__none__',
    })),
  });
  const explicitOverrideCount = roleRows.filter((role) => {
    const state = roleStates[role.name];
    return (state?.modelId ?? '__none__') !== '__none__' || state?.reasoningConfig != null;
  }).length;
  const showAssignmentValidation = hasAttemptedSave && !assignmentValidation.isValid;
  const assignmentDefaultError = showAssignmentValidation
    ? 'Select a default model or choose explicit models for every affected role.'
    : undefined;
  const assignmentSurface = summarizeAssignmentSurface({
    enabledModelCount: props.enabledModels.length,
    defaultModelConfigured: defaultModelId !== '__none__',
    roleCount: roleRows.length,
    explicitOverrideCount,
    staleRoleCount,
    inactiveRoleCount,
    missingAssignmentCount,
    blockingIssues: assignmentValidation.blockingIssues,
  });
  const hasUnsavedChanges = readHasUnsavedChanges({
    defaultModelId,
    defaultReasoning,
    roleRows,
    roleStates,
    assignments: props.assignments,
    systemDefault: props.systemDefault,
  });
  const shouldShowAssignmentGuidance = assignmentValidation.isValid && hasUnsavedChanges;
  const assignmentGuidance = hasUnsavedChanges
    ? {
        tone: 'success' as const,
        headline: 'Unsaved assignment changes',
        detail: 'Review the updated default and role overrides, then save when ready.',
      }
    : null;
  const assignmentFormFeedbackMessage = resolveFormFeedbackMessage({
    showValidation: hasAttemptedSave,
    isValid: assignmentValidation.isValid,
    validationMessage: DEFAULT_FORM_VALIDATION_MESSAGE,
  });
  const assignmentSummarySnapshot = JSON.stringify(assignmentSurface.cards);

  useEffect(() => {
    props.onSummaryCardsChange(assignmentSurface.cards);
  }, [assignmentSummarySnapshot, assignmentSurface.cards, props]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      await dashboardApi.updateLlmSystemDefault({
        modelId: defaultModelId === '__none__' ? null : defaultModelId,
        reasoningConfig: defaultReasoning,
      });

      for (const role of roleRows) {
        const state = roleStates[role.name] ?? { modelId: '__none__', reasoningConfig: null };
        await dashboardApi.updateLlmAssignment(role.name, {
          primaryModelId: state.modelId === '__none__' ? undefined : state.modelId,
          reasoningConfig: state.reasoningConfig,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['llm-system-default'] });
      queryClient.invalidateQueries({ queryKey: ['llm-assignments'] });
      toast.success('Model assignments saved.');
    },
    onError: (error) => {
      toast.error(`Failed to save assignments: ${String(error)}`);
    },
  });

  return (
    <DashboardSectionCard
      id="llm-model-assignments"
      title="Model Assignments"
      description="Set the shared system default, review assignment coverage, and override the orchestrator or specialist roles only where needed."
      bodyClassName="space-y-6"
    >
      {shouldShowAssignmentGuidance && assignmentGuidance ? (
        <div className={DIALOG_ALERT_CLASS_NAME} style={panelToneStyle(assignmentGuidance.tone)}>
          <div className="font-medium">{assignmentGuidance.headline}</div>
          <p className="mt-1">{assignmentGuidance.detail}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <a href="#llm-providers-library">Review providers</a>
            </Button>
            <Button asChild size="sm" variant="outline">
              <a href="#llm-model-catalog">Review model catalog</a>
            </Button>
          </div>
        </div>
      ) : null}
      <SubsectionPanel
        title="System Default"
        description="The default model and reasoning level used for all roles unless overridden below."
        contentClassName="space-y-3"
      >
        <div className="flex items-center gap-4">
          <Select
            value={defaultModelId}
            onValueChange={(value) => {
              setDefaultModelId(value);
              setDefaultReasoning(null);
            }}
          >
            <SelectTrigger
              className={
                assignmentDefaultError
                  ? 'w-[380px] border-red-300 focus-visible:ring-red-500'
                  : 'w-[380px]'
              }
            >
              <SelectValue placeholder="Select default model" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">None</SelectItem>
              {props.enabledModels.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.model_id}
                  {model.provider_name ? ` (${model.provider_name})` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ReasoningControl
            schema={defaultReasoningSchema}
            value={
              defaultReasoningSchema
                ? (defaultReasoning?.[defaultReasoningSchema.type] as string | number | null)
                : null
            }
            onChange={setDefaultReasoning}
          />
        </div>
        <FieldErrorText message={assignmentDefaultError} />
        {!assignmentDefaultError ? (
          <p className="text-xs text-muted">
            Specialists may inherit this model when they do not need an explicit override.
          </p>
        ) : null}
      </SubsectionPanel>
      <RoleAssignmentsOverridesPanel
        activeRoleCount={activeRoleCount}
        enabledModels={props.enabledModels}
        explicitOverrideCount={explicitOverrideCount}
        isOverridesExpanded={isOverridesExpanded}
        missingAssignmentCount={missingAssignmentCount}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        onToggleExpanded={() => setIsOverridesExpanded((open) => !open)}
        pageSize={pageSize}
        pagination={pagination}
        roleStates={roleStates}
        setRoleStates={setRoleStates}
        staleRoleCount={staleRoleCount}
      />
      <div className="space-y-3">
        <FormFeedbackMessage message={assignmentFormFeedbackMessage} />
        <div className="flex justify-end">
          <Button
            onClick={() => {
              if (!assignmentValidation.isValid) {
                setHasAttemptedSave(true);
                return;
              }
              saveMutation.mutate();
            }}
            disabled={saveMutation.isPending || !hasUnsavedChanges}
          >
            {saveMutation.isPending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
            Save All
          </Button>
        </div>
      </div>
    </DashboardSectionCard>
  );
}
