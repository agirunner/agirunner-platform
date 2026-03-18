import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { ToggleCard } from '../../components/ui/toggle-card.js';
import type { StructuredEntryValidationResult } from './playbook-launch-entry-validation.js';
import { StructuredEntryEditor } from './playbook-launch-entries.js';
import { StructuredSection } from './playbook-launch-page.sections.js';
import { ValueInput } from './playbook-launch-parameters.js';
import type { StructuredEntryDraft } from './playbook-launch-support.js';
import {
  haveSameInstructionLayers,
  type InstructionLayerName,
  type WorkflowConfigOverrideValidationResult,
  type WorkflowPolicyDefinition,
  summarizeInstructionLayerSelection,
  toggleInstructionLayer,
} from './playbook-launch-workflow-policy.support.js';

const INSTRUCTION_LAYER_DETAILS: Array<{
  value: InstructionLayerName;
  label: string;
  description: string;
}> = [
  {
    value: 'platform',
    label: 'Platform instructions',
    description: 'Shared system-wide guidance applied before workspace or playbook layers.',
  },
  {
    value: 'workspace',
    label: 'Workspace instructions',
    description: 'Workspace-specific instructions and run context resolved for the selected workspace.',
  },
  {
    value: 'playbook',
    label: 'Playbook instructions',
    description:
      'Default playbook instruction layer attached to every run created from this revision.',
  },
  {
    value: 'role',
    label: 'Role instructions',
    description: 'Role-specific instructions merged when work is claimed for a playbook role.',
  },
  {
    value: 'task',
    label: 'Task instructions',
    description: 'Task-level instructions and acceptance criteria emitted as work is delegated.',
  },
];

export function WorkflowLaunchPolicySections(props: {
  workflowPolicyDefinition: WorkflowPolicyDefinition;
  workflowConfigDrafts: Record<string, string>;
  workflowConfigValidation: WorkflowConfigOverrideValidationResult;
  extraWorkflowConfigDrafts: StructuredEntryDraft[];
  extraWorkflowConfigValidation: StructuredEntryValidationResult;
  suppressedInstructionLayers: InstructionLayerName[];
  onWorkflowConfigChange(path: string, value: string): void;
  onExtraWorkflowConfigDraftsChange(drafts: StructuredEntryDraft[]): void;
  onSuppressedInstructionLayersChange(layers: InstructionLayerName[]): void;
}): JSX.Element {
  const canRestorePlaybookDefaults = !haveSameInstructionLayers(
    props.suppressedInstructionLayers,
    props.workflowPolicyDefinition.defaultSuppressedLayers,
  );

  return (
    <>
      <StructuredSection
        id="workflow-config-overrides"
        title="Workflow Config Overrides"
        description="Apply workflow-scoped runtime config overrides without dropping into an API-only JSON payload."
      >
        <WorkflowConfigOverrideEditor
          definition={props.workflowPolicyDefinition}
          draftValues={props.workflowConfigDrafts}
          validation={props.workflowConfigValidation}
          extraDrafts={props.extraWorkflowConfigDrafts}
          extraValidation={props.extraWorkflowConfigValidation}
          onWorkflowConfigChange={props.onWorkflowConfigChange}
          onExtraDraftsChange={props.onExtraWorkflowConfigDraftsChange}
        />
      </StructuredSection>

      <StructuredSection
        id="instruction-layer-policy"
        title="Instruction Layer Policy"
        description="Choose which instruction layers this workflow should suppress before tasks are claimed."
      >
        <div className="space-y-4">
          <div className="grid gap-3">
            {INSTRUCTION_LAYER_DETAILS.map((layer) => (
              <ToggleCard
                key={layer.value}
                label={layer.label}
                description={layer.description}
                meta={
                  props.workflowPolicyDefinition.defaultSuppressedLayers.includes(layer.value)
                    ? 'Suppressed by playbook default'
                    : 'Active by default'
                }
                checked={props.suppressedInstructionLayers.includes(layer.value)}
                onCheckedChange={(checked) =>
                  props.onSuppressedInstructionLayersChange(
                    toggleInstructionLayer(props.suppressedInstructionLayers, layer.value, checked),
                  )
                }
              />
            ))}
          </div>

          <div className="rounded-xl border border-border/70 bg-muted/10 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="text-sm font-medium text-foreground">Instruction posture</div>
                <p className="text-sm text-muted">
                  {summarizeInstructionLayerSelection({
                    suppressedLayers: props.suppressedInstructionLayers,
                    defaultSuppressedLayers: props.workflowPolicyDefinition.defaultSuppressedLayers,
                  })}
                </p>
              </div>
              {canRestorePlaybookDefaults ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    props.onSuppressedInstructionLayersChange(
                      props.workflowPolicyDefinition.defaultSuppressedLayers,
                    )
                  }
                >
                  Restore playbook defaults
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </StructuredSection>
    </>
  );
}

function WorkflowConfigOverrideEditor(props: {
  definition: WorkflowPolicyDefinition;
  draftValues: Record<string, string>;
  validation: WorkflowConfigOverrideValidationResult;
  extraDrafts: StructuredEntryDraft[];
  extraValidation: StructuredEntryValidationResult;
  onWorkflowConfigChange(path: string, value: string): void;
  onExtraDraftsChange(drafts: StructuredEntryDraft[]): void;
}): JSX.Element {
  return (
    <div className="space-y-4">
      {props.definition.configOverrideSpecs.length > 0 ? (
        <div className="grid gap-4">
          {props.validation.blockingIssues.length > 0 ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50/80 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
              Resolve the highlighted config override fields before launch.
            </div>
          ) : null}
          {props.definition.configOverrideSpecs.map((spec) => (
            <WorkflowConfigOverrideField
              key={spec.path}
              path={spec.path}
              label={spec.label}
              description={spec.description}
              valueType={spec.valueType}
              value={props.draftValues[spec.path] ?? ''}
              options={spec.options}
              defaultValue={spec.defaultValue}
              fieldError={props.validation.fieldErrors[spec.path]}
              onChange={(value) => props.onWorkflowConfigChange(spec.path, value)}
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted">
          This playbook does not declare specific runtime config paths. Add any backend-supported
          dotted path below when a workflow needs an explicit launch-time override.
        </p>
      )}

      <StructuredEntryEditor
        title="Additional Config Override Paths"
        description="Add backend-supported dotted paths such as tools.web_search_provider or model_override.reasoning_config without authoring a raw JSON object."
        drafts={props.extraDrafts}
        validation={props.extraValidation}
        onChange={props.onExtraDraftsChange}
        addLabel="Add config override"
      />
    </div>
  );
}

function WorkflowConfigOverrideField(props: {
  path: string;
  label: string;
  description: string;
  valueType: 'string' | 'number' | 'boolean' | 'json';
  value: string;
  options: string[];
  defaultValue?: unknown;
  fieldError?: string;
  onChange(value: string): void;
}): JSX.Element {
  return (
    <div className="grid gap-3 rounded-xl border border-border/70 bg-muted/10 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="font-medium text-foreground">{props.label}</div>
          <p className="text-xs leading-5 text-muted">{props.description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {props.options.length > 0 ? (
            <Badge variant="secondary">{props.options.length} options</Badge>
          ) : null}
          <Badge variant="outline">{props.path}</Badge>
        </div>
      </div>

      {props.defaultValue !== undefined ? (
        <div className="rounded-lg border border-border/70 bg-background/80 p-3 text-sm">
          <div className="font-medium text-foreground">Playbook default</div>
          <div className="mt-1 break-all text-muted">{formatDefaultValue(props.defaultValue)}</div>
        </div>
      ) : null}

      <div className="grid gap-2">
        <ValueInput
          valueType={props.valueType}
          value={props.value}
          options={props.options}
          hasError={Boolean(props.fieldError)}
          onChange={props.onChange}
        />
        {props.fieldError ? (
          <span className="text-xs text-red-600 dark:text-red-400">{props.fieldError}</span>
        ) : (
          <span className="text-xs text-muted">
            Leave this empty to keep the playbook and workspace-resolved value.
          </span>
        )}
      </div>

      {props.value.trim().length > 0 ? (
        <div className="flex justify-end">
          <Button type="button" variant="outline" size="sm" onClick={() => props.onChange('')}>
            Clear override
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function formatDefaultValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value, null, 2);
}
