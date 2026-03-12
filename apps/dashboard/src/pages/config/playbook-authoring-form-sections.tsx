import { Minus, Plus } from 'lucide-react';

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
  type PlaybookAuthoringDraft,
} from './playbook-authoring-support.js';
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
          <div key={`role-${index}`} className="flex items-center gap-2">
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
                <SelectTrigger className="min-w-[220px]">
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
              size="icon"
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
  return (
    <SectionCard
      id="playbook-board-columns"
      title="Board Columns"
      description="Work-item columns that define the board posture and terminal lanes."
    >
      <div className="space-y-4">
        {props.draft.columns.map((column, index) => (
          <div key={`column-${index}`} className="rounded-md border border-border p-4">
            <div className="grid gap-3 md:grid-cols-2">
              <LabeledField label="Column ID">
                <Input
                  value={column.id}
                  onChange={(event) =>
                    updateColumn(props.onChange, index, 'id', event.target.value)
                  }
                  placeholder="planned"
                />
              </LabeledField>
              <LabeledField label="Label">
                <Input
                  value={column.label}
                  onChange={(event) =>
                    updateColumn(props.onChange, index, 'label', event.target.value)
                  }
                  placeholder="Planned"
                />
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
            <div className="mt-3 flex justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  props.onChange((current) => ({
                    ...current,
                    columns:
                      current.columns.length === 1
                        ? current.columns
                        : current.columns.filter((_, entryIndex) => entryIndex !== index),
                  }))
                }
              >
                <Minus className="h-4 w-4" />
                Remove Column
              </Button>
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

  return (
    <SectionCard
      id="playbook-workflow-stages"
      title="Workflow Stages"
      description="Ordered stages the orchestrator uses to progress a standard workflow or classify active work in a continuous workflow."
    >
      <div className="space-y-4">
        {props.draft.stages.map((stage, index) => (
          <div key={`stage-${index}`} className="rounded-md border border-border p-4">
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
            <div className="mt-3 flex items-center justify-between gap-4">
              <ToggleField
                label="Requires human gate"
                checked={stage.human_gate}
                onCheckedChange={(checked) =>
                  updateStage(props.onChange, index, 'human_gate', checked)
                }
              />
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  props.onChange((current) => ({
                    ...current,
                    stages:
                      current.stages.length === 1
                        ? current.stages
                        : current.stages.filter((_, entryIndex) => entryIndex !== index),
                  }))
                }
              >
                <Minus className="h-4 w-4" />
                Remove Stage
              </Button>
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

export function OrchestratorSection(
  props: SectionProps & { availableToolOptions?: OrchestratorToolOption[] },
): JSX.Element {
  const availableToolOptions = props.availableToolOptions ?? [];
  const requiredTools = availableToolOptions.filter((tool) => tool.required);
  const optionalTools = availableToolOptions.filter((tool) => !tool.required);

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
            <div className="grid gap-2 md:grid-cols-2">
              {optionalTools.map((tool) => (
                <label
                  key={tool.id}
                  className="flex items-start gap-3 rounded-md border border-border/70 bg-muted/10 px-3 py-3"
                >
                  <input
                    type="checkbox"
                    checked={props.draft.orchestrator.tools.includes(tool.id)}
                    onChange={() => toggleOrchestratorTool(props.onChange, tool.id)}
                    className="mt-1 rounded"
                  />
                  <div className="grid gap-1">
                    <div className="font-medium">{tool.name}</div>
                    {tool.description ? (
                      <div className="text-xs text-muted">{tool.description}</div>
                    ) : null}
                  </div>
                </label>
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

export function RuntimeAndParametersSection(props: SectionProps): JSX.Element {
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
          {props.draft.parameters.map((parameter, index) => (
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
                    onValueChange={(value) => updateParameter(props.onChange, index, 'type', value)}
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
                  <SelectWithCustomControl
                    value={parameter.category}
                    options={PARAMETER_CATEGORY_OPTIONS}
                    placeholder="Select a category"
                    unsetLabel="No category"
                    customPlaceholder="Custom category"
                    onChange={(value) => updateParameter(props.onChange, index, 'category', value)}
                  />
                </LabeledField>
                <LabeledField label="Maps to">
                  <SelectWithCustomControl
                    value={parameter.maps_to}
                    options={PARAMETER_MAP_OPTIONS}
                    placeholder="Select a project value"
                    unsetLabel="No project mapping"
                    customPlaceholder="Custom project path"
                    onChange={(value) => updateParameter(props.onChange, index, 'maps_to', value)}
                  />
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
          ))}
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
