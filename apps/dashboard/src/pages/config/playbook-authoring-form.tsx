import type { ReactNode } from 'react';
import { Minus, Plus } from 'lucide-react';

import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { Switch } from '../../components/ui/switch.js';
import { Textarea } from '../../components/ui/textarea.js';
import {
  createEmptyColumnDraft,
  createEmptyParameterDraft,
  createEmptyRoleDraft,
  createEmptyStageDraft,
  createRuntimePoolDraft,
  type PlaybookAuthoringDraft,
} from './playbook-authoring-support.js';

interface PlaybookAuthoringFormProps {
  draft: PlaybookAuthoringDraft;
  onChange(next: PlaybookAuthoringDraft): void;
  onClearError(): void;
}

export function PlaybookAuthoringForm(props: PlaybookAuthoringFormProps): JSX.Element {
  function updateDraft(updater: (current: PlaybookAuthoringDraft) => PlaybookAuthoringDraft): void {
    props.onClearError();
    props.onChange(updater(props.draft));
  }

  return (
    <div className="grid gap-4">
      <SectionCard title="Team Roles" description="Roles available to the orchestrator when it assigns specialist work.">
        <div className="space-y-3">
          {props.draft.roles.map((role, index) => (
            <div key={`role-${index}`} className="flex items-center gap-2">
              <Input
                value={role.value}
                onChange={(event) =>
                  updateDraft((current) => ({
                    ...current,
                    roles: current.roles.map((entry, entryIndex) =>
                      entryIndex === index ? { value: event.target.value } : entry,
                    ),
                  }))
                }
                placeholder="developer"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() =>
                  updateDraft((current) => ({
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
              updateDraft((current) => ({
                ...current,
                roles: [...current.roles, createEmptyRoleDraft()],
              }))
            }
          >
            <Plus className="h-4 w-4" />
            Add Role
          </Button>
        </div>
      </SectionCard>

      <BoardColumnsSection draft={props.draft} onChange={updateDraft} />
      <WorkflowStagesSection draft={props.draft} onChange={updateDraft} />
      <OrchestratorSection draft={props.draft} onChange={updateDraft} />
      <RuntimeSection draft={props.draft} onChange={updateDraft} />
      <ParametersSection draft={props.draft} onChange={updateDraft} />
    </div>
  );
}

function BoardColumnsSection(props: {
  draft: PlaybookAuthoringDraft;
  onChange(updater: (current: PlaybookAuthoringDraft) => PlaybookAuthoringDraft): void;
}): JSX.Element {
  return (
    <SectionCard title="Board Columns" description="Work-item columns that define the board posture and terminal lanes.">
      <div className="space-y-4">
        {props.draft.columns.map((column, index) => (
          <div key={`column-${index}`} className="rounded-md border border-border p-4">
            <div className="grid gap-3 md:grid-cols-2">
              <LabeledField label="Column ID">
                <Input value={column.id} onChange={(event) => updateColumn(props.onChange, index, 'id', event.target.value)} placeholder="planned" />
              </LabeledField>
              <LabeledField label="Label">
                <Input value={column.label} onChange={(event) => updateColumn(props.onChange, index, 'label', event.target.value)} placeholder="Planned" />
              </LabeledField>
            </div>
            <LabeledField label="Description" className="mt-3">
              <Textarea value={column.description} onChange={(event) => updateColumn(props.onChange, index, 'description', event.target.value)} className="min-h-[72px]" />
            </LabeledField>
            <div className="mt-3 flex flex-wrap gap-6">
              <ToggleField label="Blocked column" checked={column.is_blocked} onCheckedChange={(checked) => updateColumn(props.onChange, index, 'is_blocked', checked)} />
              <ToggleField label="Terminal column" checked={column.is_terminal} onCheckedChange={(checked) => updateColumn(props.onChange, index, 'is_terminal', checked)} />
            </div>
            <div className="mt-3 flex justify-end">
              <Button type="button" variant="outline" onClick={() => props.onChange((current) => ({ ...current, columns: current.columns.length === 1 ? current.columns : current.columns.filter((_, entryIndex) => entryIndex !== index) }))}>
                <Minus className="h-4 w-4" />
                Remove Column
              </Button>
            </div>
          </div>
        ))}
        <Button type="button" variant="outline" onClick={() => props.onChange((current) => ({ ...current, columns: [...current.columns, createEmptyColumnDraft()] }))}>
          <Plus className="h-4 w-4" />
          Add Column
        </Button>
      </div>
    </SectionCard>
  );
}

function WorkflowStagesSection(props: {
  draft: PlaybookAuthoringDraft;
  onChange(updater: (current: PlaybookAuthoringDraft) => PlaybookAuthoringDraft): void;
}): JSX.Element {
  return (
    <SectionCard title="Workflow Stages" description="Ordered stages the orchestrator uses to progress a standard workflow or classify active work in a continuous workflow.">
      <div className="space-y-4">
        {props.draft.stages.map((stage, index) => (
          <div key={`stage-${index}`} className="rounded-md border border-border p-4">
            <div className="grid gap-3 md:grid-cols-2">
              <LabeledField label="Stage name">
                <Input value={stage.name} onChange={(event) => updateStage(props.onChange, index, 'name', event.target.value)} placeholder="implementation" />
              </LabeledField>
              <LabeledField label="Involves roles">
                <Input value={stage.involves} onChange={(event) => updateStage(props.onChange, index, 'involves', event.target.value)} placeholder="developer, reviewer" />
              </LabeledField>
            </div>
            <LabeledField label="Goal" className="mt-3">
              <Input value={stage.goal} onChange={(event) => updateStage(props.onChange, index, 'goal', event.target.value)} placeholder="Working code with tests" />
            </LabeledField>
            <LabeledField label="Guidance" className="mt-3">
              <Textarea value={stage.guidance} onChange={(event) => updateStage(props.onChange, index, 'guidance', event.target.value)} className="min-h-[88px]" />
            </LabeledField>
            <div className="mt-3 flex items-center justify-between gap-4">
              <ToggleField label="Requires human gate" checked={stage.human_gate} onCheckedChange={(checked) => updateStage(props.onChange, index, 'human_gate', checked)} />
              <Button type="button" variant="outline" onClick={() => props.onChange((current) => ({ ...current, stages: current.stages.length === 1 ? current.stages : current.stages.filter((_, entryIndex) => entryIndex !== index) }))}>
                <Minus className="h-4 w-4" />
                Remove Stage
              </Button>
            </div>
          </div>
        ))}
        <Button type="button" variant="outline" onClick={() => props.onChange((current) => ({ ...current, stages: [...current.stages, createEmptyStageDraft()] }))}>
          <Plus className="h-4 w-4" />
          Add Stage
        </Button>
      </div>
    </SectionCard>
  );
}

function OrchestratorSection(props: {
  draft: PlaybookAuthoringDraft;
  onChange(updater: (current: PlaybookAuthoringDraft) => PlaybookAuthoringDraft): void;
}): JSX.Element {
  return (
    <SectionCard title="Orchestrator Parallelism" description="Limits and cadence controls that shape how the orchestrator checks progress and uses specialist capacity.">
      <div className="grid gap-3 md:grid-cols-2">
        <LabeledField label="Check interval">
          <Input value={props.draft.orchestrator.check_interval} onChange={(event) => updateOrchestrator(props.onChange, 'check_interval', event.target.value)} placeholder="5m" />
        </LabeledField>
        <LabeledField label="Stale threshold">
          <Input value={props.draft.orchestrator.stale_threshold} onChange={(event) => updateOrchestrator(props.onChange, 'stale_threshold', event.target.value)} placeholder="30m" />
        </LabeledField>
        <LabeledField label="Max rework iterations">
          <Input value={props.draft.orchestrator.max_rework_iterations} onChange={(event) => updateOrchestrator(props.onChange, 'max_rework_iterations', event.target.value)} placeholder="3" />
        </LabeledField>
        <LabeledField label="Max active tasks">
          <Input value={props.draft.orchestrator.max_active_tasks} onChange={(event) => updateOrchestrator(props.onChange, 'max_active_tasks', event.target.value)} placeholder="6" />
        </LabeledField>
        <LabeledField label="Max active tasks per work item">
          <Input value={props.draft.orchestrator.max_active_tasks_per_work_item} onChange={(event) => updateOrchestrator(props.onChange, 'max_active_tasks_per_work_item', event.target.value)} placeholder="2" />
        </LabeledField>
        <div className="flex items-end">
          <ToggleField label="Allow parallel work items" checked={props.draft.orchestrator.allow_parallel_work_items} onCheckedChange={(checked) => updateOrchestrator(props.onChange, 'allow_parallel_work_items', checked)} />
        </div>
      </div>
    </SectionCard>
  );
}

function RuntimeSection(props: {
  draft: PlaybookAuthoringDraft;
  onChange(updater: (current: PlaybookAuthoringDraft) => PlaybookAuthoringDraft): void;
}): JSX.Element {
  return (
    <SectionCard title="Runtime Controls" description="Default runtime pool settings plus optional overrides for orchestrator and specialist pools.">
      <div className="space-y-4">
        <RuntimePoolFields title="Shared runtime defaults" pool={props.draft.runtime.shared} onChange={(field, value) => updateRuntimePool(props.onChange, 'shared', field, value)} />
        <RuntimePoolFields title="Orchestrator pool override" pool={props.draft.runtime.orchestrator_pool} canDisable onEnabledChange={(enabled) => props.onChange((current) => ({ ...current, runtime: { ...current.runtime, orchestrator_pool: { ...current.runtime.orchestrator_pool, enabled } } }))} onChange={(field, value) => updateRuntimePool(props.onChange, 'orchestrator_pool', field, value)} />
        <RuntimePoolFields title="Specialist pool override" pool={props.draft.runtime.specialist_pool} canDisable onEnabledChange={(enabled) => props.onChange((current) => ({ ...current, runtime: { ...current.runtime, specialist_pool: { ...current.runtime.specialist_pool, enabled } } }))} onChange={(field, value) => updateRuntimePool(props.onChange, 'specialist_pool', field, value)} />
      </div>
    </SectionCard>
  );
}

function ParametersSection(props: {
  draft: PlaybookAuthoringDraft;
  onChange(updater: (current: PlaybookAuthoringDraft) => PlaybookAuthoringDraft): void;
}): JSX.Element {
  return (
    <SectionCard title="Playbook Parameters" description="Typed workflow inputs resolved at launch time and stored in workflow parameters.">
      <div className="space-y-4">
        {props.draft.parameters.map((parameter, index) => (
          <div key={`parameter-${index}`} className="rounded-md border border-border p-4">
            <div className="grid gap-3 md:grid-cols-2">
              <LabeledField label="Name">
                <Input value={parameter.name} onChange={(event) => updateParameter(props.onChange, index, 'name', event.target.value)} placeholder="goal" />
              </LabeledField>
              <LabeledField label="Type">
                <Select value={parameter.type} onValueChange={(value) => updateParameter(props.onChange, index, 'type', value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="string">string</SelectItem>
                    <SelectItem value="number">number</SelectItem>
                    <SelectItem value="boolean">boolean</SelectItem>
                    <SelectItem value="object">object</SelectItem>
                    <SelectItem value="array">array</SelectItem>
                  </SelectContent>
                </Select>
              </LabeledField>
              <LabeledField label="Category">
                <Input value={parameter.category} onChange={(event) => updateParameter(props.onChange, index, 'category', event.target.value)} placeholder="input" />
              </LabeledField>
              <LabeledField label="Maps to">
                <Input value={parameter.maps_to} onChange={(event) => updateParameter(props.onChange, index, 'maps_to', event.target.value)} placeholder="project.repository_url" />
              </LabeledField>
            </div>
            <LabeledField label="Description" className="mt-3">
              <Textarea value={parameter.description} onChange={(event) => updateParameter(props.onChange, index, 'description', event.target.value)} className="min-h-[72px]" />
            </LabeledField>
            <LabeledField label="Default value" className="mt-3">
              <Input value={parameter.default_value} onChange={(event) => updateParameter(props.onChange, index, 'default_value', event.target.value)} placeholder="main" />
            </LabeledField>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap gap-6">
                <ToggleField label="Required" checked={parameter.required} onCheckedChange={(checked) => updateParameter(props.onChange, index, 'required', checked)} />
                <ToggleField label="Secret" checked={parameter.secret} onCheckedChange={(checked) => updateParameter(props.onChange, index, 'secret', checked)} />
              </div>
              <Button type="button" variant="outline" onClick={() => props.onChange((current) => ({ ...current, parameters: current.parameters.filter((_, entryIndex) => entryIndex !== index) }))}>
                <Minus className="h-4 w-4" />
                Remove Parameter
              </Button>
            </div>
          </div>
        ))}
        <Button type="button" variant="outline" onClick={() => props.onChange((current) => ({ ...current, parameters: [...current.parameters, createEmptyParameterDraft()] }))}>
          <Plus className="h-4 w-4" />
          Add Parameter
        </Button>
      </div>
    </SectionCard>
  );
}

function updateColumn<K extends keyof PlaybookAuthoringDraft['columns'][number]>(
  onChange: (updater: (current: PlaybookAuthoringDraft) => PlaybookAuthoringDraft) => void,
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
  onChange: (updater: (current: PlaybookAuthoringDraft) => PlaybookAuthoringDraft) => void,
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
  onChange: (updater: (current: PlaybookAuthoringDraft) => PlaybookAuthoringDraft) => void,
  field: K,
  value: PlaybookAuthoringDraft['orchestrator'][K],
): void {
  onChange((current) => ({
    ...current,
    orchestrator: { ...current.orchestrator, [field]: value },
  }));
}

function updateRuntimePool(
  onChange: (updater: (current: PlaybookAuthoringDraft) => PlaybookAuthoringDraft) => void,
  pool: keyof PlaybookAuthoringDraft['runtime'],
  field: Exclude<keyof ReturnType<typeof createRuntimePoolDraft>, 'enabled'>,
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
  onChange: (updater: (current: PlaybookAuthoringDraft) => PlaybookAuthoringDraft) => void,
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

function SectionCard(props: { title: string; description: string; children: ReactNode }): JSX.Element {
  return (
    <Card className="border-dashed">
      <CardHeader className="space-y-1 pb-4">
        <CardTitle className="text-base">{props.title}</CardTitle>
        <p className="text-sm text-muted">{props.description}</p>
      </CardHeader>
      <CardContent>{props.children}</CardContent>
    </Card>
  );
}

function LabeledField(props: { label: string; className?: string; children: ReactNode }): JSX.Element {
  return (
    <label className={`grid gap-2 text-sm ${props.className ?? ''}`.trim()}>
      <span className="font-medium">{props.label}</span>
      {props.children}
    </label>
  );
}

function ToggleField(props: { label: string; checked: boolean; onCheckedChange(checked: boolean): void }): JSX.Element {
  return (
    <label className="flex items-center gap-3 text-sm">
      <Switch checked={props.checked} onCheckedChange={props.onCheckedChange} />
      <span className="font-medium">{props.label}</span>
    </label>
  );
}

function RuntimePoolFields(props: {
  title: string;
  pool: ReturnType<typeof createRuntimePoolDraft>;
  canDisable?: boolean;
  onEnabledChange?: (enabled: boolean) => void;
  onChange: (field: Exclude<keyof ReturnType<typeof createRuntimePoolDraft>, 'enabled'>, value: string) => void;
}): JSX.Element {
  const disabled = props.canDisable && props.pool.enabled === false;

  return (
    <div className="rounded-md border border-border p-4">
      <div className="mb-3 flex items-center justify-between gap-4">
        <div className="text-sm font-medium">{props.title}</div>
        {props.canDisable ? <ToggleField label="Enable override" checked={props.pool.enabled !== false} onCheckedChange={(checked) => props.onEnabledChange?.(checked)} /> : null}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <LabeledField label="Pool mode">
          <Select value={props.pool.pool_mode || '__unset__'} onValueChange={(value) => props.onChange('pool_mode', value === '__unset__' ? '' : value)} disabled={disabled}>
            <SelectTrigger><SelectValue placeholder="inherit" /></SelectTrigger>
            <SelectContent><SelectItem value="__unset__">inherit</SelectItem><SelectItem value="warm">warm</SelectItem><SelectItem value="cold">cold</SelectItem></SelectContent>
          </Select>
        </LabeledField>
        <LabeledField label="Pull policy">
          <Select value={props.pool.pull_policy || '__unset__'} onValueChange={(value) => props.onChange('pull_policy', value === '__unset__' ? '' : value)} disabled={disabled}>
            <SelectTrigger><SelectValue placeholder="inherit" /></SelectTrigger>
            <SelectContent><SelectItem value="__unset__">inherit</SelectItem><SelectItem value="always">always</SelectItem><SelectItem value="if-not-present">if-not-present</SelectItem><SelectItem value="never">never</SelectItem></SelectContent>
          </Select>
        </LabeledField>
        <LabeledField label="Image"><Input value={props.pool.image} onChange={(event) => props.onChange('image', event.target.value)} disabled={disabled} placeholder="ghcr.io/agirunner/runtime:latest" /></LabeledField>
        <LabeledField label="Max runtimes"><Input value={props.pool.max_runtimes} onChange={(event) => props.onChange('max_runtimes', event.target.value)} disabled={disabled} placeholder="4" /></LabeledField>
        <LabeledField label="CPU"><Input value={props.pool.cpu} onChange={(event) => props.onChange('cpu', event.target.value)} disabled={disabled} placeholder="2" /></LabeledField>
        <LabeledField label="Memory"><Input value={props.pool.memory} onChange={(event) => props.onChange('memory', event.target.value)} disabled={disabled} placeholder="4Gi" /></LabeledField>
        <LabeledField label="Priority"><Input value={props.pool.priority} onChange={(event) => props.onChange('priority', event.target.value)} disabled={disabled} placeholder="10" /></LabeledField>
        <LabeledField label="Idle timeout (seconds)"><Input value={props.pool.idle_timeout_seconds} onChange={(event) => props.onChange('idle_timeout_seconds', event.target.value)} disabled={disabled} placeholder="600" /></LabeledField>
        <LabeledField label="Grace period (seconds)"><Input value={props.pool.grace_period_seconds} onChange={(event) => props.onChange('grace_period_seconds', event.target.value)} disabled={disabled} placeholder="60" /></LabeledField>
      </div>
    </div>
  );
}
