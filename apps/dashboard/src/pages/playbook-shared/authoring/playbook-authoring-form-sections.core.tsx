import { ChevronDown, ChevronUp, Minus, Plus } from 'lucide-react';

import { Button } from '../../../components/ui/button.js';
import { Input } from '../../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select.js';
import { Textarea } from '../../../components/ui/textarea.js';
import {
  createEmptyParameterDraft,
  createEmptyRoleDraft,
  createEmptyStageDraft,
  validateParameterDrafts,
  validateRoleDrafts,
  validateWorkflowRulesDraft,
} from './playbook-authoring-support.js';
import { SectionCard, ToggleField } from './playbook-authoring-form-fields.js';
import {
  moveHandler,
  resolveMissingRoleValue,
  resolveRoleSelectionValue,
  updateParameter,
  updateParameterBoolean,
  updateParameterTitle,
  updateStage,
} from './playbook-authoring-form-sections.state.js';
import {
  IconButton,
  ROLE_SELECT_UNSET,
  type SectionProps,
  ValidationText,
} from './playbook-authoring-form-sections.shared.js';

export function ProcessInstructionsSection(props: SectionProps): JSX.Element {
  return (
    <SectionCard
      id="playbook-process-instructions"
      title="Process Instructions"
      description="Define the best-intent guide for this workflow: mandatory outcomes, preferred steps, real blockers, acceptable fallback paths, and the evidence the orchestrator must leave behind when it drives the work to closure."
    >
      <div className="space-y-2">
        <Textarea
          value={props.draft.process_instructions}
          onChange={(event) =>
            props.onChange((current) => ({
              ...current,
              process_instructions: event.target.value,
            }))
          }
          className="min-h-[220px]"
          placeholder="Example: Mandatory outcomes: ship a validated release packet and close the workflow with any residual risks recorded. Preferred steps: the architect clarifies scope, the developer implements in the delivery stage, a reviewer performs a substantive release review, and the orchestrator requests human approval once the release packet is ready. If a preferred step stalls or fails, the orchestrator must still drive the workflow to closure, record waived steps or unresolved advisory items, and explain the final judgement call."
        />
        <p className="max-w-full overflow-x-auto whitespace-nowrap text-sm text-muted">
          This guidance is the workflow contract: write it as a process guide that spells out
          mandatory outcomes, preferred steps, acceptable fallback paths, true blockers, and any
          callouts or residual risks the orchestrator must record when the happy path does not land
          perfectly.
        </p>
      </div>
    </SectionCard>
  );
}

export function TeamRolesSection(
  props: SectionProps & { availableRoleNames?: string[] },
): JSX.Element {
  const availableRoleNames = props.availableRoleNames ?? [];
  const roleValidation = validateRoleDrafts(props.draft.roles, availableRoleNames);
  return (
    <SectionCard
      id="playbook-team-roles"
      title="Specialists"
      description="Choose the active specialist definitions for this workflow."
    >
      <div className="space-y-3">
        {props.showValidationErrors && roleValidation.selectionIssue ? (
          <p className="text-xs text-red-600 dark:text-red-400">{roleValidation.selectionIssue}</p>
        ) : null}
        {props.draft.roles.map((role, index) => (
          <div key={`role-${index}`} className="grid gap-1.5">
            <div className="flex items-start gap-2">
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
                  <SelectValue placeholder="Select a specialist" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ROLE_SELECT_UNSET}>Select a specialist</SelectItem>
                  {availableRoleNames.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                  {!availableRoleNames.includes(role.value) && role.value.trim() ? (
                    <SelectItem value={resolveMissingRoleValue(index)}>
                      Unknown role: {role.value}
                    </SelectItem>
                  ) : null}
                </SelectContent>
              </Select>
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
                Remove Specialist
              </Button>
            </div>
            {props.showValidationErrors && roleValidation.roleErrors[index] ? (
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
          Add specialist
        </Button>
      </div>
    </SectionCard>
  );
}

export function WorkflowStagesSection(props: SectionProps): JSX.Element {
  const stageValidation = validateWorkflowRulesDraft(props.draft);
  return (
    <SectionCard
      id="playbook-workflow-stages"
      title="Workflow Stages"
      description="Define the structured milestones for this workflow. The process instructions tell the orchestrator what should happen inside each stage, what must finish there, and what can be waived or rerouted when reality does not match the ideal path."
    >
      <div className="space-y-4">
        {props.draft.stages.map((stage, index) => (
          <div key={`stage-${index}`} className="rounded-xl border border-border/70 bg-card/60 p-4">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.35fr)] lg:items-stretch">
              <div className="grid gap-3">
                <label className="grid gap-2 text-sm">
                  <span className="font-medium">Stage name</span>
                  <Input
                    value={stage.name}
                    onChange={(event) => updateStage(props, index, 'name', event.target.value)}
                  />
                  <ValidationText
                    issue={
                      props.showValidationErrors
                        ? stageValidation.stageErrors[index]?.name
                        : undefined
                    }
                  />
                </label>
                <label className="grid gap-2 text-sm">
                  <span className="font-medium">Stage goal</span>
                  <Input
                    value={stage.goal}
                    onChange={(event) => updateStage(props, index, 'goal', event.target.value)}
                  />
                  <ValidationText
                    issue={
                      props.showValidationErrors
                        ? stageValidation.stageErrors[index]?.goal
                        : undefined
                    }
                  />
                </label>
              </div>
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                <label className="grid gap-2 text-sm">
                  <span className="font-medium">Stage guidance</span>
                  <Textarea
                    value={stage.guidance}
                    onChange={(event) => updateStage(props, index, 'guidance', event.target.value)}
                    className="min-h-[110px] lg:h-full"
                    placeholder="Optional stage-specific guidance for the orchestrator."
                  />
                </label>
                <div className="flex items-center gap-2 lg:pt-7">
                  <IconButton
                    icon={<ChevronUp className="h-4 w-4" />}
                    onClick={moveHandler(props, 'stages', index, 'earlier')}
                  />
                  <IconButton
                    icon={<ChevronDown className="h-4 w-4" />}
                    onClick={moveHandler(props, 'stages', index, 'later')}
                  />
                  <IconButton
                    icon={<Minus className="h-4 w-4" />}
                    onClick={() =>
                      props.onChange((current) => ({
                        ...current,
                        stages: current.stages.filter((_, entryIndex) => entryIndex !== index),
                      }))
                    }
                  />
                </div>
              </div>
            </div>
          </div>
        ))}
        {props.showValidationErrors &&
        stageValidation.blockingIssues.length > 0 &&
        props.draft.stages.length === 0 ? (
          <p className="text-xs text-red-600 dark:text-red-400">
            {stageValidation.blockingIssues[0]}
          </p>
        ) : null}
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

export function LaunchInputsSection(props: SectionProps): JSX.Element {
  const parameterValidation = validateParameterDrafts(props.draft.parameters);
  return (
    <SectionCard
      id="playbook-launch-inputs"
      title="Launch Inputs"
      description="Each launch input declares one workflow goal that operators can provide when the workflow starts."
    >
      <div className="space-y-4">
        {props.draft.parameters.map((parameter, index) => (
          <div
            key={`parameter-${index}`}
            className="grid gap-3 rounded-xl border border-border/70 bg-card/60 p-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_auto_auto] lg:items-start"
          >
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Slug</span>
              <Input
                value={parameter.slug}
                onChange={(event) => updateParameter(props, index, 'slug', event.target.value)}
              />
              <ValidationText
                issue={
                  props.showValidationErrors
                    ? parameterValidation.parameterErrors[index]?.slug
                    : undefined
                }
              />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Title</span>
              <Input
                value={parameter.title}
                onChange={(event) => updateParameterTitle(props, index, event.target.value)}
              />
              <ValidationText
                issue={
                  props.showValidationErrors
                    ? parameterValidation.parameterErrors[index]?.title
                    : undefined
                }
              />
            </label>
            <div className="flex items-start lg:min-w-[7rem] lg:pt-7">
              <ToggleField
                label="Required"
                checked={parameter.required}
                onCheckedChange={(checked) =>
                  updateParameterBoolean(props, index, 'required', checked)
                }
              />
            </div>
            <div className="flex items-start gap-2 lg:min-w-[8rem] lg:pt-7">
              <IconButton
                icon={<ChevronUp className="h-4 w-4" />}
                onClick={moveHandler(props, 'parameters', index, 'earlier')}
              />
              <IconButton
                icon={<ChevronDown className="h-4 w-4" />}
                onClick={moveHandler(props, 'parameters', index, 'later')}
              />
              <IconButton
                icon={<Minus className="h-4 w-4" />}
                onClick={() =>
                  props.onChange((current) => ({
                    ...current,
                    parameters: current.parameters.filter((_, entryIndex) => entryIndex !== index),
                  }))
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
              parameters: [...current.parameters, createEmptyParameterDraft()],
            }))
          }
        >
          <Plus className="h-4 w-4" />
          Add Input
        </Button>
      </div>
    </SectionCard>
  );
}
