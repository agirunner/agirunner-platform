import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, GripVertical, Minus, Plus } from 'lucide-react';

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
import {
  createEmptyColumnDraft,
  createEmptyParameterDraft,
  createEmptyRoleDraft,
  createEmptyStageDraft,
  validateBoardColumnsDraft,
  validateParameterDrafts,
  validateRoleDrafts,
  type PlaybookAuthoringDraft,
} from './playbook-authoring-support.js';
import {
  canMoveDraftItem,
  moveDraftItem,
  spliceDraftItem,
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

export function TeamRolesSection(
  props: SectionProps & { availableRoleNames?: string[] },
): JSX.Element {
  const availableRoleNames = props.availableRoleNames ?? [];
  const roleValidation = validateRoleDrafts(props.draft.roles, availableRoleNames);

  return (
    <SectionCard
      id="playbook-team-roles"
      title="Team Roles"
      description="Roles available to the orchestrator when it assigns specialist work."
    >
      <div className="space-y-3">
        <p className="text-sm text-muted">
          Playbooks use active role definitions from the shared role catalog.
        </p>
        {props.draft.roles.map((role, index) => (
          <div key={`role-${index}`} className="grid gap-1.5">
            <div className="flex items-start gap-2">
              {availableRoleNames.length > 0 ? (
                <Select
                  value={resolveRoleSelectionValue(role.value, availableRoleNames, index)}
                  onValueChange={(value) =>
                    props.onChange((current) => ({
                      ...current,
                      roles: current.roles.map((entry, entryIndex) =>
                        entryIndex === index
                          ? { value: value === ROLE_SELECT_UNSET ? '' : value }
                          : entry,
                      ),
                    }))
                  }
                >
                  <SelectTrigger className="min-w-0 flex-1">
                    <SelectValue placeholder="Select a role definition" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ROLE_SELECT_UNSET}>Select a role definition</SelectItem>
                    {availableRoleNames.map((name) => (
                      <SelectItem key={name} value={name}>
                        {name}
                      </SelectItem>
                    ))}
                    {!availableRoleNames.includes(role.value) && role.value.trim().length > 0 ? (
                      <SelectItem value={resolveMissingRoleValue(index)}>
                        Unknown role: {role.value}
                      </SelectItem>
                    ) : null}
                  </SelectContent>
                </Select>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 whitespace-nowrap px-3"
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
            {roleValidation.roleErrors[index] ? (
              <p className="text-xs text-red-600 dark:text-red-400">
                {roleValidation.roleErrors[index]}
              </p>
            ) : null}
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          disabled={availableRoleNames.length === 0}
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
            Manage the shared role catalog on the Roles page when you need a new specialist.
          </p>
        ) : (
          <p className="text-sm text-muted">
            Create active role definitions before assigning team roles to this playbook.
          </p>
        )}
      </div>
    </SectionCard>
  );
}

export function BoardColumnsSection(props: SectionProps): JSX.Element {
  const columnCount = props.draft.columns.length;
  const boardColumnValidation = validateBoardColumnsDraft(
    props.draft.columns,
    props.draft.entry_column_id,
  );
  const columnDrag = useDraftDragReorder(props.draft.columns, (next) =>
    props.onChange((current) => ({ ...current, columns: next })),
  );

  return (
    <SectionCard
      id="playbook-board-columns"
      title="Board Columns"
      description="Work-item columns that define the board posture and terminal lanes."
    >
      <div className="space-y-4">
        {boardColumnValidation.blockingIssues.length > 0 ? (
          <div className="rounded-md border border-amber-300 bg-amber-50/80 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            Resolve board-column blockers before save.
          </div>
        ) : null}
        <LabeledField label="Default intake column">
          <div className="space-y-1">
            <Select
              value={resolveBoardEntryColumnValue(props.draft)}
              onValueChange={(value) =>
                props.onChange((current) => ({
                  ...current,
                  entry_column_id: value === ENTRY_COLUMN_UNSET ? '' : value,
                }))
              }
            >
              <SelectTrigger
                aria-invalid={boardColumnValidation.entryColumnError ? true : undefined}
                className={
                  boardColumnValidation.entryColumnError
                    ? 'border-red-300 focus-visible:ring-red-500'
                    : undefined
                }
              >
                <SelectValue placeholder="Select the intake column" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ENTRY_COLUMN_UNSET}>Select the intake column</SelectItem>
                {buildEntryColumnOptions(props.draft.columns).map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {boardColumnValidation.entryColumnError ? (
              <p className="text-xs text-red-600 dark:text-red-400">
                {boardColumnValidation.entryColumnError}
              </p>
            ) : (
              <p className="text-xs text-muted">
                Automation and manual intake land here unless a work item explicitly targets
                another column.
              </p>
            )}
          </div>
        </LabeledField>
        {props.draft.columns.map((column, index) => {
          const dropTargetProps = columnDrag.getDropTargetProps(index);
          return (
          <div
            key={`column-${index}`}
            className={`rounded-md border p-4 transition-colors duration-150${
              dropTargetProps['data-drag-over']
                ? ' border-primary/50 bg-primary/5'
                : columnDrag.dragState.dragIndex === index
                  ? ' border-border opacity-50'
                  : ' border-border'
            }`}
            onDragOver={dropTargetProps.onDragOver}
            onDragLeave={dropTargetProps.onDragLeave}
            onDrop={dropTargetProps.onDrop}
            onDragEnd={dropTargetProps.onDragEnd}
          >
            <ReorderableCardHeader
              positionLabel={`Column ${index + 1} of ${columnCount}`}
              title={resolveBoardColumnTitle(column, index)}
              itemLabel={`column ${index + 1}`}
              index={index}
              total={columnCount}
              removeLabel="Remove Column"
              disableRemove={columnCount === 1}
              dragHandleProps={columnDrag.getDragHandleProps(index)}
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
                    <p className="text-xs text-red-600 dark:text-red-400">
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
                    <p className="text-xs text-red-600 dark:text-red-400">
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
            <div className="mt-3 grid gap-2 text-xs text-muted md:grid-cols-2">
              <p>Blocked columns signal stalled work that needs intervention.</p>
              <p>Terminal columns mark end-state lanes such as done or cancelled.</p>
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
  const stageDrag = useDraftDragReorder(props.draft.stages, (next) =>
    props.onChange((current) => ({ ...current, stages: next })),
  );

  return (
    <SectionCard
      id="playbook-workflow-stages"
      title="Workflow Stages"
      description="Ordered stages the orchestrator uses to progress a planned workflow or classify active work in an ongoing workflow."
    >
      <div className="space-y-4">
        {props.draft.stages.map((stage, index) => {
          const dropTargetProps = stageDrag.getDropTargetProps(index);
          return (
          <div
            key={`stage-${index}`}
            className={`rounded-md border p-4 transition-colors duration-150${
              dropTargetProps['data-drag-over']
                ? ' border-primary/50 bg-primary/5'
                : stageDrag.dragState.dragIndex === index
                  ? ' border-border opacity-50'
                  : ' border-border'
            }`}
            onDragOver={dropTargetProps.onDragOver}
            onDragLeave={dropTargetProps.onDragLeave}
            onDrop={dropTargetProps.onDrop}
            onDragEnd={dropTargetProps.onDragEnd}
          >
            <ReorderableCardHeader
              positionLabel={`Stage ${index + 1} of ${stageCount}`}
              title={resolveStageTitle(stage, index)}
              itemLabel={`stage ${index + 1}`}
              index={index}
              total={stageCount}
              removeLabel="Remove Stage"
              disableRemove={stageCount === 1}
              dragHandleProps={stageDrag.getDragHandleProps(index)}
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
          );
        })}
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
  dragHandleProps?: DragHandleProps;
  onMove(direction: DraftReorderDirection): void;
  onRemove(): void;
}

function ReorderableCardHeader(props: ReorderableCardHeaderProps): JSX.Element {
  const canMoveEarlier = canMoveDraftItem(props.index, props.total, 'earlier');
  const canMoveLater = canMoveDraftItem(props.index, props.total, 'later');

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-md bg-muted/15 p-3 md:flex-row md:items-start md:justify-between">
      <div className="flex min-w-0 items-start gap-2">
        {props.dragHandleProps ? (
          <button
            type="button"
            className="mt-1 cursor-grab rounded p-1 text-muted hover:bg-muted/30 hover:text-foreground active:cursor-grabbing"
            draggable
            aria-label={`Drag to reorder ${props.itemLabel}`}
            aria-roledescription="drag handle"
            onDragStart={props.dragHandleProps.onDragStart}
            onKeyDown={(event) => {
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                if (canMoveEarlier) props.onMove('earlier');
              } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                if (canMoveLater) props.onMove('later');
              }
            }}
          >
            <GripVertical className="h-4 w-4" />
          </button>
        ) : null}
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">
            {props.positionLabel}
          </p>
          <h3 className="truncate text-sm font-semibold text-foreground">{props.title}</h3>
        </div>
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

interface DragHandleProps {
  onDragStart(event: React.DragEvent): void;
}

interface DragState {
  dragIndex: number | null;
  overIndex: number | null;
}

function useDraftDragReorder<T>(
  items: readonly T[],
  onReorder: (next: T[]) => void,
): {
  dragState: DragState;
  getDragHandleProps(index: number): DragHandleProps;
  getDropTargetProps(index: number): {
    onDragOver(event: React.DragEvent): void;
    onDragLeave(): void;
    onDrop(event: React.DragEvent): void;
    onDragEnd(): void;
    'data-drag-over': boolean;
  };
} {
  const [dragState, setDragState] = useState<DragState>({ dragIndex: null, overIndex: null });
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const getDragHandleProps = useCallback(
    (index: number): DragHandleProps => ({
      onDragStart(event: React.DragEvent) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(index));
        setDragState({ dragIndex: index, overIndex: null });
      },
    }),
    [],
  );

  const getDropTargetProps = useCallback(
    (index: number) => ({
      onDragOver(event: React.DragEvent) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setDragState((current) =>
          current.dragIndex !== null ? { ...current, overIndex: index } : current,
        );
      },
      onDragLeave() {
        setDragState((current) =>
          current.overIndex === index ? { ...current, overIndex: null } : current,
        );
      },
      onDrop(event: React.DragEvent) {
        event.preventDefault();
        const fromIndex = Number(event.dataTransfer.getData('text/plain'));
        if (Number.isFinite(fromIndex) && fromIndex !== index) {
          onReorder(spliceDraftItem(itemsRef.current, fromIndex, index));
        }
        setDragState({ dragIndex: null, overIndex: null });
      },
      onDragEnd() {
        setDragState({ dragIndex: null, overIndex: null });
      },
      'data-drag-over': dragState.overIndex === index && dragState.dragIndex !== index,
    }),
    [dragState.dragIndex, dragState.overIndex, onReorder],
  );

  return { dragState, getDragHandleProps, getDropTargetProps };
}

export function OrchestratorSection(props: SectionProps): JSX.Element {
  return (
    <SectionCard
      id="playbook-orchestrator-controls"
      title="Orchestrator Policy"
      description="Set the workflow-specific orchestration guidance, cadence, stale detection, rework policy, and specialist parallelism limits."
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
            <div className="space-y-1">
              <Input
                type="number"
                inputMode="numeric"
                value={props.draft.orchestrator.max_rework_iterations}
                onChange={(event) =>
                  updateOrchestrator(props.onChange, 'max_rework_iterations', event.target.value)
                }
                placeholder="5"
              />
              <p className="text-xs text-muted">
                Cap how many full rework loops the orchestrator can request before escalating.
              </p>
            </div>
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
            <div className="space-y-1">
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
              <p className="text-xs text-muted">
                Limits specialist fan-out for one work item so a single feature cannot monopolize
                workflow concurrency. In an SDLC workflow, a value of 2 lets one feature run
                implementation and QA in parallel while preserving capacity for other work items.
              </p>
            </div>
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
        description="Most playbooks should inherit tenant runtime defaults. Open the specialist override only when this playbook needs an exception."
      >
        <details className="rounded-xl border border-border/70 bg-background/80 p-4">
          <summary className="cursor-pointer list-none">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="text-sm font-medium">Specialist runtime override</div>
                <p className="text-xs text-muted">
                  Override tenant runtime defaults only when specialist tasks for this playbook
                  need a different pool posture.
                </p>
              </div>
              <span className="rounded-full border border-border/70 bg-muted/20 px-3 py-1 text-xs font-medium">
                {props.draft.runtime.specialist_pool.enabled === false ? 'Using tenant defaults' : 'Override enabled'}
              </span>
            </div>
          </summary>
          <div className="mt-4">
            <RuntimePoolFields
              title="Specialist runtime override"
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
        </details>
      </SectionCard>
      <SectionCard
        id="playbook-parameters"
        title="Playbook Parameters"
        description="Typed workflow inputs resolved at launch time and stored in workflow parameters."
      >
        <div className="space-y-4">
          {parameterValidation.blockingIssues.length > 0 ? (
            <div className="rounded-md border border-amber-300 bg-amber-50/80 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
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
                        <p className="text-xs text-red-600 dark:text-red-400">{parameterErrors.maps_to}</p>
                      ) : (
                        <p className="text-xs text-muted">{mappingHint}</p>
                      )}
                    </div>
                  </LabeledField>
                  {showParameterCategoryField(parameter) ? (
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
                          <p className="text-xs text-red-600 dark:text-red-400">
                            {parameterErrors.category}
                          </p>
                        ) : (
                          <p className="text-xs text-muted">
                            Use categories only when mapping repository metadata or secure
                            credential-backed inputs from a project.
                          </p>
                        )}
                      </div>
                    </LabeledField>
                  ) : (
                    <div className="rounded-md border border-dashed border-border/70 bg-muted/10 px-3 py-2 text-xs text-muted md:col-span-2">
                      Category stays hidden until this parameter maps to project data or is marked
                      as secret.
                    </div>
                  )}
                </div>
                <LabeledField label="Operator description" className="mt-3">
                  <div className="space-y-1">
                    <Textarea
                      value={parameter.description}
                      onChange={(event) =>
                        updateParameter(props.onChange, index, 'description', event.target.value)
                      }
                      className="min-h-[72px]"
                    />
                    <p className="text-xs text-muted">
                      Shown to operators at launch. Use stage guidance or orchestrator instructions
                      for execution behavior.
                    </p>
                  </div>
                </LabeledField>
                <div className="mt-3">
                  <LabeledField label="Launch label">
                    <div className="space-y-1">
                      <Input
                        value={parameter.label}
                        onChange={(event) =>
                          updateParameter(props.onChange, index, 'label', event.target.value)
                        }
                        placeholder="Workflow goal"
                      />
                      <p className="text-xs text-muted">
                        Human-readable label shown to operators at launch time.
                      </p>
                    </div>
                  </LabeledField>
                </div>
                <LabeledField label="Help text" className="mt-3">
                  <div className="space-y-1">
                    <Input
                      value={parameter.help_text}
                      onChange={(event) =>
                        updateParameter(props.onChange, index, 'help_text', event.target.value)
                      }
                      placeholder="Brief guidance shown below the input at launch time"
                    />
                    <p className="text-xs text-muted">
                      Contextual guidance displayed below the input field for operators.
                    </p>
                  </div>
                </LabeledField>
                <LabeledField label="Allowed values" className="mt-3">
                  <div className="space-y-1">
                    <Input
                      value={parameter.allowed_values}
                      onChange={(event) =>
                        updateParameter(props.onChange, index, 'allowed_values', event.target.value)
                      }
                      placeholder="main, develop, staging"
                    />
                    <p className="text-xs text-muted">
                      Comma-separated list of accepted values. Leave empty for free-form input.
                    </p>
                  </div>
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
                    <p className="text-xs text-red-600 dark:text-red-400">{parameterErrors.secret}</p>
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

function updateRuntimePool(
  onChange: SectionProps['onChange'],
  pool: keyof PlaybookAuthoringDraft['runtime'],
  field: keyof Omit<PlaybookAuthoringDraft['runtime']['specialist_pool'], 'enabled'>,
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

const ENTRY_COLUMN_UNSET = '__unset__';
const ROLE_SELECT_UNSET = '__unset__';

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
  return 'Choose a known project value when possible. Use a custom path such as project.settings.knowledge.<key> when the standard mappings are not enough.';
}

function showParameterCategoryField(
  parameter: PlaybookAuthoringDraft['parameters'][number],
): boolean {
  return parameter.secret || parameter.maps_to.trim().length > 0;
}

function buildEntryColumnOptions(
  columns: PlaybookAuthoringDraft['columns'],
): StructuredChoiceOption[] {
  return columns
    .map((column) => ({
      value: column.id.trim(),
      label: column.label.trim() || column.id.trim(),
    }))
    .filter((option) => option.value.length > 0);
}

function resolveBoardEntryColumnValue(draft: PlaybookAuthoringDraft): string {
  const current = draft.entry_column_id.trim();
  if (current.length > 0) {
    return current;
  }
  return buildEntryColumnOptions(draft.columns)[0]?.value ?? ENTRY_COLUMN_UNSET;
}

function resolveRoleSelectionValue(
  roleName: string,
  availableRoleNames: string[],
  index: number,
): string {
  const trimmed = roleName.trim();
  if (!trimmed) {
    return ROLE_SELECT_UNSET;
  }
  return availableRoleNames.includes(trimmed) ? trimmed : resolveMissingRoleValue(index);
}

function resolveMissingRoleValue(index: number): string {
  return `__missing__:${index}`;
}
