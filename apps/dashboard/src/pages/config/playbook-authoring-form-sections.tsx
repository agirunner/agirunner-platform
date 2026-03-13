import { useEffect } from 'react';
import { ChevronDown, ChevronUp, Minus, Plus } from 'lucide-react';

import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { Textarea } from '../../components/ui/textarea.js';
import { ToggleCard } from '../../components/ui/toggle-card.js';
import {
  createEmptyColumnDraft,
  createEmptyParameterDraft,
  createEmptyRoleDraft,
  createEmptyStageDraft,
  validateBoardColumnsDraft,
  validateParameterDrafts,
  type PlaybookAuthoringDraft,
} from './playbook-authoring-support.js';
import {
  canMoveDraftItem,
  moveDraftItem,
  type DraftReorderDirection,
} from './playbook-authoring-reorder.js';
import {
  LabeledField,
  RuntimePoolFields,
  SectionCard,
  ToggleField,
} from './playbook-authoring-form-fields.js';
import {
  MultiChoiceButtonsControl,
  SelectWithCustomControl,
  TypedParameterValueControl,
  type StructuredChoiceOption,
} from './playbook-authoring-structured-controls.js';

interface SectionProps {
  draft: PlaybookAuthoringDraft;
  onChange(updater: (current: PlaybookAuthoringDraft) => PlaybookAuthoringDraft): void;
}

export interface OrchestratorToolOption {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  required?: boolean;
}

export function TeamRolesSection(
  props: SectionProps & { availableRoleNames?: string[] },
): JSX.Element {
  const availableRoleNames = props.availableRoleNames ?? [];

  return (
    <SectionCard
      id="playbook-team-roles"
      title="Team Roles"
      description="Roles available to the orchestrator when it assigns specialist work."
    >
      <div className="space-y-3">
        {props.draft.roles.map((role, index) => (
          <div key={`role-${index}`} className="flex flex-wrap items-center gap-2">
            {availableRoleNames.length > 0 ? (
              <Select
                value={availableRoleNames.includes(role.value) ? role.value : '__custom__'}
                onValueChange={(value) =>
                  props.onChange((current) => ({
                    ...current,
                    roles: current.roles.map((entry, entryIndex) =>
                      entryIndex === index ? { value: value === '__custom__' ? '' : value } : entry,
                    ),
                  }))
                }
              >
                <SelectTrigger className="w-full sm:min-w-[220px] sm:flex-1">
                  <SelectValue placeholder="Select a role definition" />
                </SelectTrigger>
                <SelectContent>
                  {availableRoleNames.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                  <SelectItem value="__custom__">Custom role</SelectItem>
                </SelectContent>
              </Select>
            ) : null}
            {availableRoleNames.length === 0 || !availableRoleNames.includes(role.value) ? (
              <Input
                className="w-full sm:flex-1"
                value={role.value}
                onChange={(event) =>
                  props.onChange((current) => ({
                    ...current,
                    roles: current.roles.map((entry, entryIndex) =>
                      entryIndex === index ? { value: event.target.value } : entry,
                    ),
                  }))
                }
                placeholder={availableRoleNames.length > 0 ? 'Custom role' : 'developer'}
              />
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                props.onChange((current) => ({
                  ...current,
                  roles:
                    current.roles.length === 1
                      ? current.roles
                      : current.roles.filter((_, entryIndex) => entryIndex !== index),
                }))
              }
            >
              <Minus className="h-4 w-4" />
              Remove Role
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            props.onChange((current) => ({
              ...current,
              roles: [...current.roles, createEmptyRoleDraft()],
            }))
          }
        >
          <Plus className="h-4 w-4" />
          Add Role
        </Button>
        {availableRoleNames.length > 0 ? (
          <p className="text-sm text-muted">
            Choose from active role definitions when possible. Use a custom role only when the
            playbook truly needs a role that is not defined in the catalog yet.
          </p>
        ) : null}
      </div>
    </SectionCard>
  );
}

export function BoardColumnsSection(props: SectionProps): JSX.Element {
  const columnCount = props.draft.columns.length;
  const boardColumnValidation = validateBoardColumnsDraft(props.draft.columns);

  return (
    <SectionCard
      id="playbook-board-columns"
      title="Board Columns"
      description="Work-item columns that define the board posture and terminal lanes."
    >
      <div className="space-y-4">
        {boardColumnValidation.blockingIssues.length > 0 ? (
          <div className="rounded-md border border-amber-300 bg-amber-50/80 px-4 py-3 text-sm text-amber-950">
            Resolve board-column blockers before save.
          </div>
        ) : null}
        {props.draft.columns.map((column, index) => (
          <div key={`column-${index}`} className="rounded-md border border-border p-4">
            <ReorderableCardHeader
              positionLabel={`Column ${index + 1} of ${columnCount}`}
              title={resolveBoardColumnTitle(column, index)}
              itemLabel={`column ${index + 1}`}
              index={index}
              total={columnCount}
              removeLabel="Remove Column"
              disableRemove={columnCount === 1}
              onMove={(direction) => moveColumn(props.onChange, index, direction)}
              onRemove={() => removeColumn(props.onChange, index)}
            />
            <div className="grid gap-3 md:grid-cols-2">
              <LabeledField label="Column ID">
                <div className="space-y-1">
                  <Input
                    value={column.id}
                    aria-invalid={boardColumnValidation.columnErrors[index]?.id ? true : undefined}
                    className={
                      boardColumnValidation.columnErrors[index]?.id
                        ? 'border-red-300 focus-visible:ring-red-500'
                        : undefined
                    }
                    onChange={(event) =>
                      updateColumn(props.onChange, index, 'id', event.target.value)
                    }
                    placeholder="planned"
                  />
                  {boardColumnValidation.columnErrors[index]?.id ? (
                    <p className="text-xs text-red-600">
                      {boardColumnValidation.columnErrors[index]?.id}
                    </p>
                  ) : (
                    <p className="text-xs text-muted">
                      Use a stable slug-style ID. This is what automation, stages, and board links reference.
                    </p>
                  )}
                </div>
              </LabeledField>
              <LabeledField label="Label">
                <div className="space-y-1">
                  <Input
                    value={column.label}
                    aria-invalid={boardColumnValidation.columnErrors[index]?.label ? true : undefined}
                    className={
                      boardColumnValidation.columnErrors[index]?.label
                        ? 'border-red-300 focus-visible:ring-red-500'
                        : undefined
                    }
                    onChange={(event) =>
                      updateColumn(props.onChange, index, 'label', event.target.value)
                    }
                    placeholder="Planned"
                  />
                  {boardColumnValidation.columnErrors[index]?.label ? (
                    <p className="text-xs text-red-600">
                      {boardColumnValidation.columnErrors[index]?.label}
                    </p>
                  ) : (
                    <p className="text-xs text-muted">
                      Labels should match the board language operators use in workflow views.
                    </p>
                  )}
                </div>
              </LabeledField>
            </div>
            <LabeledField label="Description" className="mt-3">
              <Textarea
                value={column.description}
                onChange={(event) =>
                  updateColumn(props.onChange, index, 'description', event.target.value)
                }
                className="min-h-[72px]"
              />
            </LabeledField>
            <div className="mt-3 flex flex-wrap gap-6">
              <ToggleField
                label="Blocked column"
                checked={column.is_blocked}
                onCheckedChange={(checked) =>
                  updateColumn(props.onChange, index, 'is_blocked', checked)
                }
              />
              <ToggleField
                label="Terminal column"
                checked={column.is_terminal}
                onCheckedChange={(checked) =>
                  updateColumn(props.onChange, index, 'is_terminal', checked)
                }
              />
            </div>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            props.onChange((current) => ({
              ...current,
              columns: [...current.columns, createEmptyColumnDraft()],
            }))
          }
        >
          <Plus className="h-4 w-4" />
          Add Column
        </Button>
      </div>
    </SectionCard>
  );
}

export function WorkflowStagesSection(props: SectionProps): JSX.Element {
  const availableRoleOptions = normalizedRoleOptions(props.draft.roles.map((role) => role.value));
  const stageCount = props.draft.stages.length;

  return (
    <SectionCard
      id="playbook-workflow-stages"
      title="Workflow Stages"
      description="Ordered stages the orchestrator uses to progress a standard workflow or classify active work in a continuous workflow."
    >
      <div className="space-y-4">
        {props.draft.stages.map((stage, index) => (
          <div key={`stage-${index}`} className="rounded-md border border-border p-4">
            <ReorderableCardHeader
              positionLabel={`Stage ${index + 1} of ${stageCount}`}
              title={resolveStageTitle(stage, index)}
              itemLabel={`stage ${index + 1}`}
              index={index}
              total={stageCount}
              removeLabel="Remove Stage"
              disableRemove={stageCount === 1}
              onMove={(direction) => moveStagePosition(props.onChange, index, direction)}
              onRemove={() => removeStage(props.onChange, index)}
            />
            <div className="grid gap-3 md:grid-cols-2">
              <LabeledField label="Stage name">
                <Input
                  value={stage.name}
                  onChange={(event) =>
                    updateStage(props.onChange, index, 'name', event.target.value)
                  }
                  placeholder="implementation"
                />
              </LabeledField>
              <LabeledField label="Involves roles">
                <MultiChoiceButtonsControl
                  options={availableRoleOptions}
                  value={stage.involves}
                  emptyMessage="Add team roles above to make them selectable here."
                  customPlaceholder="Additional roles, comma separated"
                  onChange={(value) => updateStage(props.onChange, index, 'involves', value)}
                />
              </LabeledField>
            </div>
            <LabeledField label="Goal" className="mt-3">
              <Input
                value={stage.goal}
                onChange={(event) => updateStage(props.onChange, index, 'goal', event.target.value)}
                placeholder="Working code with tests"
              />
            </LabeledField>
            <LabeledField label="Guidance" className="mt-3">
              <Textarea
                value={stage.guidance}
                onChange={(event) =>
                  updateStage(props.onChange, index, 'guidance', event.target.value)
                }
                className="min-h-[88px]"
              />
            </LabeledField>
            <div className="mt-3">
              <ToggleField
                label="Requires human gate"
                checked={stage.human_gate}
                onCheckedChange={(checked) =>
                  updateStage(props.onChange, index, 'human_gate', checked)
                }
              />
            </div>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            props.onChange((current) => ({
              ...current,
              stages: [...current.stages, createEmptyStageDraft()],
            }))
          }
        >
          <Plus className="h-4 w-4" />
          Add Stage
        </Button>
      </div>
    </SectionCard>
  );
}

interface ReorderableCardHeaderProps {
  positionLabel: string;
  title: string;
  itemLabel: string;
  index: number;
  total: number;
  removeLabel: string;
  disableRemove?: boolean;
  onMove(direction: DraftReorderDirection): void;
  onRemove(): void;
}

function ReorderableCardHeader(props: ReorderableCardHeaderProps): JSX.Element {
  const canMoveEarlier = canMoveDraftItem(props.index, props.total, 'earlier');
  const canMoveLater = canMoveDraftItem(props.index, props.total, 'later');

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-md bg-muted/15 p-3 md:flex-row md:items-start md:justify-between">
      <div className="min-w-0 space-y-1">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">
          {props.positionLabel}
        </p>
        <h3 className="truncate text-sm font-semibold text-foreground">{props.title}</h3>
      </div>
      <div
        role="group"
        aria-label={`${props.positionLabel} ordering controls`}
        className="flex flex-wrap gap-2"
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => props.onMove('earlier')}
          disabled={!canMoveEarlier}
          aria-label={`Move ${props.itemLabel} earlier`}
        >
          <ChevronUp className="h-4 w-4" />
          Move Earlier
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => props.onMove('later')}
          disabled={!canMoveLater}
          aria-label={`Move ${props.itemLabel} later`}
        >
          <ChevronDown className="h-4 w-4" />
          Move Later
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={props.onRemove}
          disabled={props.disableRemove}
        >
          <Minus className="h-4 w-4" />
          {props.removeLabel}
        </Button>
      </div>
    </div>
  );
}

export function OrchestratorSection(
  props: SectionProps & { availableToolOptions?: OrchestratorToolOption[] },
): JSX.Element {
  const availableToolOptions = props.availableToolOptions ?? [];
  const requiredTools = availableToolOptions.filter((tool) => tool.required);
  const optionalTools = availableToolOptions.filter((tool) => !tool.required);
  const enabledOptionalToolCount = optionalTools.filter((tool) =>
    props.draft.orchestrator.tools.includes(tool.id),
  ).length;

  return (
    <SectionCard
      id="playbook-orchestrator-controls"
      title="Orchestrator Controls"
      description="Configure orchestrator instructions, optional verification tools, cadence, stale detection, rework policy, and specialist parallelism in one place."
    >
      <div className="space-y-4">
        <LabeledField label="Orchestrator instructions">
          <Textarea
            value={props.draft.orchestrator.instructions}
            onChange={(event) =>
              updateOrchestrator(props.onChange, 'instructions', event.target.value)
            }
            className="min-h-[144px]"
            placeholder="Add workflow-specific guidance for how the orchestrator should verify work, escalate decisions, and communicate outcomes."
          />
        </LabeledField>
        {requiredTools.length > 0 ? (
          <div className="grid gap-2 text-sm">
            <span className="font-medium">Core management tools</span>
            <p className="text-xs text-muted">
              These stay enabled because the orchestrator cannot manage workflow state without them.
            </p>
            <div className="flex flex-wrap gap-2">
              {requiredTools.map((tool) => (
                <span
                  key={tool.id}
                  className="rounded-full border border-border/70 bg-muted/20 px-3 py-1 text-xs font-medium"
                >
                  {tool.name}
                </span>
              ))}
            </div>
          </div>
        ) : null}
        {optionalTools.length > 0 ? (
          <div className="grid gap-2 text-sm">
            <span className="font-medium">Optional verification tools</span>
            <p className="text-xs text-muted">
              Enable the specialist-grade tools the orchestrator may use when it needs to inspect
              files, run git checks, fetch the web, or escalate.
            </p>
            <div className="rounded-md border border-border/70 bg-surface px-3 py-3 text-xs text-muted">
              {enabledOptionalToolCount > 0
                ? `${enabledOptionalToolCount} optional verification tool${enabledOptionalToolCount === 1 ? '' : 's'} enabled for direct orchestrator inspection.`
                : 'No optional verification tools enabled. The orchestrator will rely on core management tools and specialist tasks for deeper inspection.'}
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {optionalTools.map((tool) => (
                <ToggleCard
                  key={tool.id}
                  label={tool.name}
                  description={tool.description ?? undefined}
                  meta={tool.category ? `Category: ${tool.category}` : undefined}
                  checked={props.draft.orchestrator.tools.includes(tool.id)}
                  onCheckedChange={() => toggleOrchestratorTool(props.onChange, tool.id)}
                />
              ))}
            </div>
          </div>
        ) : null}
        <div className="grid gap-3 md:grid-cols-2">
          <LabeledField label="Check interval">
            <SelectWithCustomControl
              value={props.draft.orchestrator.check_interval}
              options={ORCHESTRATOR_CHECK_INTERVAL_OPTIONS}
              placeholder="Select a cadence"
              unsetLabel="Use default cadence"
              customPlaceholder="Custom interval, e.g. 7m"
              onChange={(value) => updateOrchestrator(props.onChange, 'check_interval', value)}
            />
          </LabeledField>
          <LabeledField label="Stale threshold">
            <SelectWithCustomControl
              value={props.draft.orchestrator.stale_threshold}
              options={ORCHESTRATOR_STALE_THRESHOLD_OPTIONS}
              placeholder="Select a stale threshold"
              unsetLabel="Use default threshold"
              customPlaceholder="Custom threshold, e.g. 45m"
              onChange={(value) => updateOrchestrator(props.onChange, 'stale_threshold', value)}
            />
          </LabeledField>
          <LabeledField label="Max rework iterations">
            <Input
              type="number"
              inputMode="numeric"
              value={props.draft.orchestrator.max_rework_iterations}
              onChange={(event) =>
                updateOrchestrator(props.onChange, 'max_rework_iterations', event.target.value)
              }
              placeholder="3"
            />
          </LabeledField>
          <LabeledField label="Max active tasks">
            <Input
              type="number"
              inputMode="numeric"
              value={props.draft.orchestrator.max_active_tasks}
              onChange={(event) =>
                updateOrchestrator(props.onChange, 'max_active_tasks', event.target.value)
              }
              placeholder="6"
            />
          </LabeledField>
          <LabeledField label="Max active tasks per work item">
            <Input
              type="number"
              inputMode="numeric"
              value={props.draft.orchestrator.max_active_tasks_per_work_item}
              onChange={(event) =>
                updateOrchestrator(
                  props.onChange,
                  'max_active_tasks_per_work_item',
                  event.target.value,
                )
              }
              placeholder="2"
            />
          </LabeledField>
          <div className="flex items-end">
            <ToggleField
              label="Allow parallel work items"
              checked={props.draft.orchestrator.allow_parallel_work_items}
              onCheckedChange={(checked) =>
                updateOrchestrator(props.onChange, 'allow_parallel_work_items', checked)
              }
            />
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

export function RuntimeAndParametersSection(
  props: SectionProps & {
    onParameterIssueChange(index: number, kind: 'default' | 'mapping', issue?: string): void;
  },
): JSX.Element {
  const parameterValidation = validateParameterDrafts(props.draft.parameters);

  useEffect(() => {
    props.draft.parameters.forEach((_, index) => {
      const errors = parameterValidation.parameterErrors[index];
      const issue = errors?.category ?? errors?.maps_to ?? errors?.secret;
      props.onParameterIssueChange(index, 'mapping', issue);
    });
  }, [parameterValidation.parameterErrors, props.draft.parameters.length, props.onParameterIssueChange]);

  return (
    <div className="grid gap-4">
      <SectionCard
        id="playbook-runtime-controls"
        title="Runtime Controls"
        description="Default runtime pool settings plus optional overrides for orchestrator and specialist pools."
      >
        <div className="space-y-4">
          <RuntimePoolFields
            title="Shared runtime defaults"
            pool={props.draft.runtime.shared}
            onChange={(field, value) => updateRuntimePool(props.onChange, 'shared', field, value)}
          />
          <RuntimePoolFields
            title="Orchestrator pool override"
            pool={props.draft.runtime.orchestrator_pool}
            canDisable
            onEnabledChange={(enabled) =>
              props.onChange((current) => ({
                ...current,
                runtime: {
                  ...current.runtime,
                  orchestrator_pool: { ...current.runtime.orchestrator_pool, enabled },
                },
              }))
            }
            onChange={(field, value) =>
              updateRuntimePool(props.onChange, 'orchestrator_pool', field, value)
            }
          />
          <RuntimePoolFields
            title="Specialist pool override"
            pool={props.draft.runtime.specialist_pool}
            canDisable
            onEnabledChange={(enabled) =>
              props.onChange((current) => ({
                ...current,
                runtime: {
                  ...current.runtime,
                  specialist_pool: { ...current.runtime.specialist_pool, enabled },
                },
              }))
            }
            onChange={(field, value) =>
              updateRuntimePool(props.onChange, 'specialist_pool', field, value)
            }
          />
        </div>
      </SectionCard>
      <SectionCard
        id="playbook-parameters"
        title="Playbook Parameters"
        description="Typed workflow inputs resolved at launch time and stored in workflow parameters."
      >
        <div className="space-y-4">
          {parameterValidation.blockingIssues.length > 0 ? (
            <div className="rounded-md border border-amber-300 bg-amber-50/80 px-4 py-3 text-sm text-amber-950">
              Resolve parameter mapping blockers before save.
            </div>
          ) : null}
          {props.draft.parameters.map((parameter, index) => {
            const parameterErrors = parameterValidation.parameterErrors[index] ?? {};
            const mappingOptions = filterParameterMapOptions(parameter);
            const mappingHint = describeParameterMappingHint(parameter);

            return (
              <div key={`parameter-${index}`} className="rounded-md border border-border p-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <LabeledField label="Name">
                    <Input
                      value={parameter.name}
                      onChange={(event) =>
                        updateParameter(props.onChange, index, 'name', event.target.value)
                      }
                      placeholder="goal"
                    />
                  </LabeledField>
                  <LabeledField label="Type">
                    <Select
                      value={parameter.type}
                      onValueChange={(value) =>
                        updateParameter(props.onChange, index, 'type', value)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="string">String</SelectItem>
                        <SelectItem value="number">Number</SelectItem>
                        <SelectItem value="boolean">Boolean</SelectItem>
                        <SelectItem value="object">JSON object</SelectItem>
                        <SelectItem value="array">JSON array</SelectItem>
                      </SelectContent>
                    </Select>
                  </LabeledField>
                  <LabeledField label="Category">
                    <div className="space-y-1">
                      <SelectWithCustomControl
                        value={parameter.category}
                        options={PARAMETER_CATEGORY_OPTIONS}
                        placeholder="Select a category"
                        unsetLabel="No category"
                        customPlaceholder="Custom category"
                        onChange={(value) =>
                          updateParameter(props.onChange, index, 'category', value)
                        }
                      />
                      {parameterErrors.category ? (
                        <p className="text-xs text-red-600">{parameterErrors.category}</p>
                      ) : (
                        <p className="text-xs text-muted">
                          Match repository auto-fill to repository metadata and secure values to the credential category.
                        </p>
                      )}
                    </div>
                  </LabeledField>
                  <LabeledField label="Maps to">
                    <div className="space-y-1">
                      <SelectWithCustomControl
                        value={parameter.maps_to}
                        options={mappingOptions}
                        placeholder="Select a project value"
                        unsetLabel="No project mapping"
                        customPlaceholder="Custom project path"
                        onChange={(value) =>
                          updateParameter(props.onChange, index, 'maps_to', value)
                        }
                      />
                      {parameterErrors.maps_to ? (
                        <p className="text-xs text-red-600">{parameterErrors.maps_to}</p>
                      ) : (
                        <p className="text-xs text-muted">{mappingHint}</p>
                      )}
                    </div>
                  </LabeledField>
                </div>
                <LabeledField label="Description" className="mt-3">
                  <Textarea
                    value={parameter.description}
                    onChange={(event) =>
                      updateParameter(props.onChange, index, 'description', event.target.value)
                    }
                    className="min-h-[72px]"
                  />
                </LabeledField>
                <LabeledField label="Default value" className="mt-3">
                  <TypedParameterValueControl
                    valueType={parameter.type}
                    value={parameter.default_value}
                    onValidationChange={(issue) =>
                      props.onParameterIssueChange(index, 'default', issue)
                    }
                    onChange={(value) =>
                      updateParameter(props.onChange, index, 'default_value', value)
                    }
                  />
                </LabeledField>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
                  <div className="flex flex-wrap gap-6">
                    <ToggleField
                      label="Required"
                      checked={parameter.required}
                      onCheckedChange={(checked) =>
                        updateParameter(props.onChange, index, 'required', checked)
                      }
                    />
                    <ToggleField
                      label="Secret"
                      checked={parameter.secret}
                      onCheckedChange={(checked) =>
                        updateParameter(props.onChange, index, 'secret', checked)
                      }
                    />
                  </div>
                  {parameterErrors.secret ? (
                    <p className="text-xs text-red-600">{parameterErrors.secret}</p>
                  ) : (
                    <p className="text-xs text-muted">
                      Mark only credential-backed launch inputs as secret so operators can still review normal repository metadata at launch time.
                    </p>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      props.onChange((current) => ({
                        ...current,
                        parameters: current.parameters.filter(
                          (_, entryIndex) => entryIndex !== index,
                        ),
                      }))
                    }
                  >
                    <Minus className="h-4 w-4" />
                    Remove Parameter
                  </Button>
                </div>
              </div>
            );
          })}
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              props.onChange((current) => ({
                ...current,
                parameters: [...current.parameters, createEmptyParameterDraft()],
              }))
            }
          >
            <Plus className="h-4 w-4" />
            Add Parameter
          </Button>
        </div>
      </SectionCard>
    </div>
  );
}

function updateColumn<K extends keyof PlaybookAuthoringDraft['columns'][number]>(
  onChange: SectionProps['onChange'],
  index: number,
  field: K,
  value: PlaybookAuthoringDraft['columns'][number][K],
): void {
  onChange((current) => ({
    ...current,
    columns: current.columns.map((entry, entryIndex) =>
      entryIndex === index ? { ...entry, [field]: value } : entry,
    ),
  }));
}

function moveColumn(
  onChange: SectionProps['onChange'],
  index: number,
  direction: DraftReorderDirection,
): void {
  onChange((current) => ({
    ...current,
    columns: moveDraftItem(current.columns, index, direction),
  }));
}

function removeColumn(onChange: SectionProps['onChange'], index: number): void {
  onChange((current) => ({
    ...current,
    columns:
      current.columns.length === 1
        ? current.columns
        : current.columns.filter((_, entryIndex) => entryIndex !== index),
  }));
}

function updateStage<K extends keyof PlaybookAuthoringDraft['stages'][number]>(
  onChange: SectionProps['onChange'],
  index: number,
  field: K,
  value: PlaybookAuthoringDraft['stages'][number][K],
): void {
  onChange((current) => ({
    ...current,
    stages: current.stages.map((entry, entryIndex) =>
      entryIndex === index ? { ...entry, [field]: value } : entry,
    ),
  }));
}

function moveStagePosition(
  onChange: SectionProps['onChange'],
  index: number,
  direction: DraftReorderDirection,
): void {
  onChange((current) => ({
    ...current,
    stages: moveDraftItem(current.stages, index, direction),
  }));
}

function removeStage(onChange: SectionProps['onChange'], index: number): void {
  onChange((current) => ({
    ...current,
    stages:
      current.stages.length === 1
        ? current.stages
        : current.stages.filter((_, entryIndex) => entryIndex !== index),
  }));
}

function updateOrchestrator<K extends keyof PlaybookAuthoringDraft['orchestrator']>(
  onChange: SectionProps['onChange'],
  field: K,
  value: PlaybookAuthoringDraft['orchestrator'][K],
): void {
  onChange((current) => ({
    ...current,
    orchestrator: { ...current.orchestrator, [field]: value },
  }));
}

function toggleOrchestratorTool(onChange: SectionProps['onChange'], toolId: string): void {
  onChange((current) => ({
    ...current,
    orchestrator: {
      ...current.orchestrator,
      tools: current.orchestrator.tools.includes(toolId)
        ? current.orchestrator.tools.filter((value) => value !== toolId)
        : [...current.orchestrator.tools, toolId],
    },
  }));
}

function updateRuntimePool(
  onChange: SectionProps['onChange'],
  pool: keyof PlaybookAuthoringDraft['runtime'],
  field: keyof Omit<PlaybookAuthoringDraft['runtime']['shared'], 'enabled'>,
  value: string,
): void {
  onChange((current) => ({
    ...current,
    runtime: {
      ...current.runtime,
      [pool]: { ...current.runtime[pool], [field]: value },
    },
  }));
}

function updateParameter<K extends keyof PlaybookAuthoringDraft['parameters'][number]>(
  onChange: SectionProps['onChange'],
  index: number,
  field: K,
  value: PlaybookAuthoringDraft['parameters'][number][K],
): void {
  onChange((current) => ({
    ...current,
    parameters: current.parameters.map((entry, entryIndex) =>
      entryIndex === index ? { ...entry, [field]: value } : entry,
    ),
  }));
}

function normalizedRoleOptions(roleNames: string[]): StructuredChoiceOption[] {
  return roleNames
    .map((role) => role.trim())
    .filter((role, index, values) => role.length > 0 && values.indexOf(role) === index)
    .sort((left, right) => left.localeCompare(right))
    .map((role) => ({ value: role, label: role }));
}

function resolveBoardColumnTitle(
  column: PlaybookAuthoringDraft['columns'][number],
  index: number,
): string {
  return column.label.trim() || column.id.trim() || `Column ${index + 1}`;
}

function resolveStageTitle(
  stage: PlaybookAuthoringDraft['stages'][number],
  index: number,
): string {
  return stage.name.trim() || stage.goal.trim() || `Stage ${index + 1}`;
}

const ORCHESTRATOR_CHECK_INTERVAL_OPTIONS: StructuredChoiceOption[] = [
  { value: '1m', label: 'Every 1 minute' },
  { value: '5m', label: 'Every 5 minutes' },
  { value: '10m', label: 'Every 10 minutes' },
  { value: '15m', label: 'Every 15 minutes' },
  { value: '30m', label: 'Every 30 minutes' },
];

const ORCHESTRATOR_STALE_THRESHOLD_OPTIONS: StructuredChoiceOption[] = [
  { value: '15m', label: '15 minutes' },
  { value: '30m', label: '30 minutes' },
  { value: '45m', label: '45 minutes' },
  { value: '1h', label: '1 hour' },
  { value: '2h', label: '2 hours' },
];

const PARAMETER_CATEGORY_OPTIONS: StructuredChoiceOption[] = [
  { value: 'input', label: 'Input', description: 'Operator-provided launch input.' },
  {
    value: 'repository',
    label: 'Repository',
    description: 'Project repository metadata such as URL or default branch.',
  },
  {
    value: 'credential',
    label: 'Credential',
    description: 'Project-linked credentials that should be injected securely.',
  },
  { value: 'storage', label: 'Storage', description: 'Project storage or document locations.' },
  {
    value: 'integration',
    label: 'Integration',
    description: 'External system identifiers or integration-specific inputs.',
  },
];

const PARAMETER_MAP_OPTIONS: StructuredChoiceOption[] = [
  {
    value: 'project.repository_url',
    label: 'Project repository URL',
    description: 'Auto-fill from the project repository configuration.',
  },
  {
    value: 'project.settings.default_branch',
    label: 'Project default branch',
    description: 'Auto-fill from the project branch settings.',
  },
  {
    value: 'project.credentials.git_token',
    label: 'Project Git token',
    description: 'Use the project Git credential reference at launch time.',
  },
];

function filterParameterMapOptions(
  parameter: PlaybookAuthoringDraft['parameters'][number],
): StructuredChoiceOption[] {
  const category = parameter.category.trim();
  if (parameter.secret || category === 'credential') {
    return PARAMETER_MAP_OPTIONS.filter((option) => option.value === 'project.credentials.git_token');
  }
  if (category === 'repository') {
    return PARAMETER_MAP_OPTIONS.filter((option) =>
      option.value === 'project.repository_url' || option.value === 'project.settings.default_branch',
    );
  }
  return PARAMETER_MAP_OPTIONS;
}

function describeParameterMappingHint(
  parameter: PlaybookAuthoringDraft['parameters'][number],
): string {
  const category = parameter.category.trim();
  if (parameter.secret || category === 'credential') {
    return 'Secret parameters can only map to secret-backed project values.';
  }
  if (category === 'repository') {
    return 'Repository parameters should map to non-secret project metadata.';
  }
  return 'Choose a known project value when possible. Use a custom path only when the standard mappings are not enough.';
}
