import { ChevronDown, ChevronRight } from 'lucide-react';

import { ListPagination } from '../../../components/list-pagination/list-pagination.js';
import type { PaginatedListResult } from '../../../lib/pagination/list-pagination.js';
import { Button } from '../../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table.js';
import { buildAssignmentRoleRows } from '../models-page.defaults.js';
import {
  ELEVATED_SURFACE_CLASS_NAME,
  renderOverridesSummaryChip,
  renderRoleStatusBadge,
  SubsectionPanel,
} from '../models-page.chrome.js';
import {
  ModelReasoningSelect,
  normalizeReasoningConfig,
  summarizeRoleDescription,
  summarizeStaleRoleBadgeLabel,
  truncateRoleDescription,
  type RoleState,
  type RoleStateSetter,
} from './assignment-controls.js';
import type { LlmModel, RoleAssignment, SystemDefault } from '../models-page.types.js';

type AssignmentRoleRow = ReturnType<typeof buildAssignmentRoleRows>[number];

export function RoleAssignmentsOverridesPanel(props: {
  activeRoleCount: number;
  enabledModels: LlmModel[];
  explicitOverrideCount: number;
  isOverridesExpanded: boolean;
  missingAssignmentCount: number;
  onPageChange(value: number): void;
  onPageSizeChange(value: number): void;
  onToggleExpanded(): void;
  pageSize: number;
  pagination: PaginatedListResult<AssignmentRoleRow>;
  roleStates: Record<string, RoleState>;
  setRoleStates: RoleStateSetter;
  staleRoleCount: number;
}): JSX.Element {
  return (
    <SubsectionPanel
      title="Orchestrator and specialist agent model overrides"
      description="Use the shared system default unless the orchestrator or a specific role needs a different model or reasoning policy."
      headerAction={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={props.onToggleExpanded}
          aria-expanded={props.isOverridesExpanded}
        >
          {props.isOverridesExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted" />
          )}
          {props.isOverridesExpanded ? 'Hide overrides' : 'Show overrides'}
        </Button>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        {renderOverridesSummaryChip(`${props.activeRoleCount} active roles`)}
        {renderOverridesSummaryChip(`${props.explicitOverrideCount} explicit overrides`)}
        {props.staleRoleCount > 0
          ? renderOverridesSummaryChip(
              summarizeStaleRoleBadgeLabel({
                missingAssignmentCount: props.missingAssignmentCount,
              }),
              'warning',
            )
          : null}
      </div>
      {props.isOverridesExpanded ? (
        <div className="space-y-4 border-t border-border/70 pt-4">
          <p className="text-xs text-muted">
            Choose explicit models only where the default is not enough.
          </p>
          <div className="grid gap-3 md:hidden">
            {props.pagination.items.map((role) => {
              const state = props.roleStates[role.name] ?? {
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
                    <p className="text-sm leading-6 text-muted">{summarizeRoleDescription(role)}</p>
                  </CardHeader>
                  <CardContent>
                    <ModelReasoningSelect
                      layout="stack"
                      modelId={state.modelId}
                      reasoningConfig={state.reasoningConfig}
                      enabledModels={props.enabledModels}
                      modelError={undefined}
                      onModelChange={(id) =>
                        updateRoleState(props.setRoleStates, role.name, {
                          modelId: id,
                          reasoningConfig: null,
                        })
                      }
                      onReasoningChange={(config) =>
                        updateRoleState(props.setRoleStates, role.name, {
                          reasoningConfig: config,
                        })
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
                  {props.pagination.items.map((role) => {
                    const state = props.roleStates[role.name] ?? {
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
                            updateRoleState(props.setRoleStates, role.name, {
                              modelId: id,
                              reasoningConfig: null,
                            })
                          }
                          onReasoningChange={(config) =>
                            updateRoleState(props.setRoleStates, role.name, {
                              reasoningConfig: config,
                            })
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
            page={props.pagination.page}
            pageSize={props.pageSize}
            totalItems={props.pagination.totalItems}
            totalPages={props.pagination.totalPages}
            start={props.pagination.start}
            end={props.pagination.end}
            itemLabel="overrides"
            onPageChange={props.onPageChange}
            onPageSizeChange={(value) => {
              props.onPageSizeChange(value);
              props.onPageChange(1);
            }}
          />
        </div>
      ) : null}
    </SubsectionPanel>
  );
}

export function buildRoleStateMap(
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

export function readHasUnsavedChanges(input: {
  assignments: RoleAssignment[];
  defaultModelId: string;
  defaultReasoning: Record<string, unknown> | null;
  roleRows: Array<{ name: string }>;
  roleStates: Record<string, RoleState>;
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
