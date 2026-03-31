import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';

import {
  DEFAULT_FORM_VALIDATION_MESSAGE,
  FieldErrorText,
  FormFeedbackMessage,
  resolveFormFeedbackMessage,
} from '../../components/forms/form-feedback.js';
import {
  DEFAULT_LIST_PAGE_SIZE,
  ListPagination,
  paginateListItems,
} from '../../components/list-pagination/list-pagination.js';
import { DashboardSectionCard } from '../../components/layout/dashboard-section-card.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table.js';
import { dashboardApi } from '../../lib/api.js';
import { toast } from '../../lib/toast.js';
import { buildAssignmentRoleRows } from './llm-providers-page.defaults.js';
import {
  DIALOG_ALERT_CLASS_NAME,
  ELEVATED_SURFACE_CLASS_NAME,
  panelToneStyle,
  renderOverridesSummaryChip,
  renderRoleStatusBadge,
  SubsectionPanel,
} from './llm-providers-page.chrome.js';
import {
  ModelReasoningSelect,
  normalizeReasoningConfig,
  ReasoningControl,
  summarizeRoleDescription,
  summarizeStaleRoleBadgeLabel,
  truncateRoleDescription,
  type RoleState,
  type RoleStateSetter,
} from './llm-providers-page-assignment-controls.js';
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
      <SubsectionPanel
        title="Orchestrator and specialist agent model overrides"
        description="Use the shared system default unless the orchestrator or a specific role needs a different model or reasoning policy."
        headerAction={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setIsOverridesExpanded((open) => !open)}
            aria-expanded={isOverridesExpanded}
          >
            {isOverridesExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted" />
            )}
            {isOverridesExpanded ? 'Hide overrides' : 'Show overrides'}
          </Button>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          {renderOverridesSummaryChip(`${activeRoleCount} active roles`)}
          {renderOverridesSummaryChip(`${explicitOverrideCount} explicit overrides`)}
          {staleRoleCount > 0
            ? renderOverridesSummaryChip(
                summarizeStaleRoleBadgeLabel({
                  missingAssignmentCount,
                }),
                'warning',
              )
            : null}
        </div>
        {isOverridesExpanded ? (
          <div className="space-y-4 border-t border-border/70 pt-4">
            <p className="text-xs text-muted">
              Choose explicit models only where the default is not enough.
            </p>
            <div className="grid gap-3 md:hidden">
              {pagination.items.map((role) => {
                const state = roleStates[role.name] ?? {
                  modelId: '__none__',
                  reasoningConfig: null,
                };
                return (
                  <Card key={role.name} className={ELEVATED_SURFACE_CLASS_NAME}>
                    <CardHeader className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <CardTitle className="text-base">{role.name}</CardTitle>
                        {renderRoleStatusBadge(role)}
                      </div>
                      <p className="text-sm leading-6 text-muted">
                        {summarizeRoleDescription(role)}
                      </p>
                    </CardHeader>
                    <CardContent>
                      <ModelReasoningSelect
                        layout="stack"
                        modelId={state.modelId}
                        reasoningConfig={state.reasoningConfig}
                        enabledModels={props.enabledModels}
                        modelError={undefined}
                        onModelChange={(id) =>
                          updateRoleState(setRoleStates, role.name, {
                            modelId: id,
                            reasoningConfig: null,
                          })
                        }
                        onReasoningChange={(config) =>
                          updateRoleState(setRoleStates, role.name, { reasoningConfig: config })
                        }
                      />
                    </CardContent>
                  </Card>
                );
              })}
            </div>
            <div className="hidden md:block">
              <div className="overflow-x-auto border-y border-border/70">
                <Table className="table-fixed">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-1/5">Role</TableHead>
                      <TableHead className="w-1/5">Description</TableHead>
                      <TableHead className="w-1/5 text-center">Status</TableHead>
                      <TableHead className="w-1/5 text-center">Provider Selection</TableHead>
                      <TableHead className="w-1/5 text-center">Reasoning</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagination.items.map((role) => {
                      const state = roleStates[role.name] ?? {
                        modelId: '__none__',
                        reasoningConfig: null,
                      };
                      const description = truncateRoleDescription(summarizeRoleDescription(role));
                      return (
                        <TableRow key={role.name} className="align-middle [&>td]:py-4">
                          <TableCell className="align-middle text-sm font-medium whitespace-nowrap">
                            {role.name}
                          </TableCell>
                          <TableCell className="align-middle text-sm text-foreground">
                            <span className="block truncate" title={summarizeRoleDescription(role)}>
                              {description}
                            </span>
                          </TableCell>
                          <TableCell className="align-middle whitespace-nowrap">
                            <div className="flex justify-center">{renderRoleStatusBadge(role)}</div>
                          </TableCell>
                          <ModelReasoningSelect
                            modelId={state.modelId}
                            reasoningConfig={state.reasoningConfig}
                            enabledModels={props.enabledModels}
                            modelError={undefined}
                            onModelChange={(id) =>
                              updateRoleState(setRoleStates, role.name, {
                                modelId: id,
                                reasoningConfig: null,
                              })
                            }
                            onReasoningChange={(config) =>
                              updateRoleState(setRoleStates, role.name, { reasoningConfig: config })
                            }
                          />
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
            <ListPagination
              page={pagination.page}
              pageSize={pageSize}
              totalItems={pagination.totalItems}
              totalPages={pagination.totalPages}
              start={pagination.start}
              end={pagination.end}
              itemLabel="overrides"
              onPageChange={setPage}
              onPageSizeChange={(value) => {
                setPageSize(value);
                setPage(1);
              }}
            />
          </div>
        ) : null}
      </SubsectionPanel>
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

function buildRoleStateMap(
  roleRows: Array<{ name: string }>,
  assignments: RoleAssignment[],
): Record<string, RoleState> {
  const initial: Record<string, RoleState> = {};
  for (const role of roleRows) {
    const assignment = assignments.find((entry) => entry.role_name === role.name);
    initial[role.name] = {
      modelId: assignment?.primary_model_id ?? '__none__',
      reasoningConfig: assignment?.reasoning_config ?? null,
    };
  }
  return initial;
}

function updateRoleState(
  setRoleStates: RoleStateSetter,
  role: string,
  patch: Partial<RoleState>,
): void {
  setRoleStates((prev) => ({
    ...prev,
    [role]: { ...prev[role], ...patch },
  }));
}

function readHasUnsavedChanges(input: {
  defaultModelId: string;
  defaultReasoning: Record<string, unknown> | null;
  roleRows: Array<{ name: string }>;
  roleStates: Record<string, RoleState>;
  assignments: RoleAssignment[];
  systemDefault: SystemDefault;
}): boolean {
  if (input.defaultModelId !== (input.systemDefault.modelId ?? '__none__')) {
    return true;
  }
  if (
    normalizeReasoningConfig(input.defaultReasoning) !==
    normalizeReasoningConfig(input.systemDefault.reasoningConfig)
  ) {
    return true;
  }

  return input.roleRows.some((role) => {
    const assignment = input.assignments.find((entry) => entry.role_name === role.name);
    const currentState = input.roleStates[role.name] ?? {
      modelId: '__none__',
      reasoningConfig: null,
    };
    const persistedModelId = assignment?.primary_model_id ?? '__none__';
    const persistedReasoning = assignment?.reasoning_config ?? null;
    return (
      currentState.modelId !== persistedModelId ||
      normalizeReasoningConfig(currentState.reasoningConfig) !==
        normalizeReasoningConfig(persistedReasoning)
    );
  });
}
