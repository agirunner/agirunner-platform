import { Badge } from '../../components/ui/badge.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import type {
  DashboardEffectiveModelResolution,
  DashboardLlmModelRecord,
  DashboardLlmProviderRecord,
  DashboardPlaybookRecord,
  DashboardWorkspaceRecord,
  DashboardWorkspaceResolvedModelsResponse,
  DashboardRoleModelOverride,
} from '../../lib/api.js';
import type {
  RoleOverrideValidationResult,
  StructuredEntryValidationResult,
} from './playbook-launch-entry-validation.js';
import { StructuredEntryEditor } from './playbook-launch-entries.js';
import { LaunchPageHeader, RunIdentitySection } from './playbook-launch-identity.js';
import {
  LaunchActionCard,
  LaunchDefinitionSnapshot,
  StructuredSection,
} from './playbook-launch-page.sections.js';
import { ParameterField } from './playbook-launch-parameters.js';
import {
  type LaunchDefinitionSummary,
  type LaunchValidationResult,
  type RoleOverrideDraft,
  type StructuredEntryDraft,
  type WorkflowBudgetDraft,
  readWorkflowBudgetMode,
} from './playbook-launch-support.js';
import { PlaybookSummaryCard } from './playbook-launch-summary.js';
import { WorkflowBudgetEditor } from './playbook-launch-budget.js';
import { RoleOverrideEditor } from './playbook-launch-overrides.js';
import { WorkflowLaunchPolicySections } from './playbook-launch-workflow-policy.js';
import type {
  InstructionLayerName,
  WorkflowConfigOverrideValidationResult,
  WorkflowPolicyDefinition,
} from './playbook-launch-workflow-policy.support.js';

export function PlaybookLaunchForm(props: {
  selectedPlaybookId: string;
  isSelectedPlaybookArchived: boolean;
  launchablePlaybooks: DashboardPlaybookRecord[];
  workflowName: string;
  workspaceId: string;
  workspaces: DashboardWorkspaceRecord[];
  selectedPlaybook: DashboardPlaybookRecord | null;
  selectedWorkspace: DashboardWorkspaceRecord | null;
  launchValidation: LaunchValidationResult;
  showValidationErrors: boolean;
  formFeedbackMessage: string | null;
  launchDefinition: LaunchDefinitionSummary;
  parameterDrafts: Record<string, string>;
  metadataDrafts: StructuredEntryDraft[];
  metadataValidation: StructuredEntryValidationResult;
  workflowPolicyDefinition: WorkflowPolicyDefinition;
  workflowConfigDrafts: Record<string, string>;
  workflowConfigValidation: WorkflowConfigOverrideValidationResult;
  extraWorkflowConfigDrafts: StructuredEntryDraft[];
  extraWorkflowConfigValidation: StructuredEntryValidationResult;
  suppressedInstructionLayers: InstructionLayerName[];
  hasInstructionConfigOverride: boolean;
  configuredWorkflowConfigOverrideCount: number;
  instructionConfigSummary: string;
  workflowBudgetDraft: WorkflowBudgetDraft;
  modelOverrideDrafts: RoleOverrideDraft[];
  roleOverrideValidation: RoleOverrideValidationResult;
  configuredWorkflowOverrideCount: number;
  llmProviders: DashboardLlmProviderRecord[];
  llmModels: DashboardLlmModelRecord[];
  hasLlmLoadError: boolean;
  workflowOverrides: Record<string, DashboardRoleModelOverride>;
  workflowConfigBlockingError?: string;
  workflowOverrideBlockingError?: string;
  workspaceResolvedModels?: DashboardWorkspaceResolvedModelsResponse;
  previewData?: {
    roles: string[];
    workspace_model_overrides: Record<string, DashboardRoleModelOverride>;
    workflow_model_overrides: Record<string, DashboardRoleModelOverride>;
    effective_models: Record<string, DashboardEffectiveModelResolution>;
  };
  previewError: unknown;
  previewLoading: boolean;
  isLoadingSummary: boolean;
  error: string | null;
  canLaunch: boolean;
  isReadyToLaunch: boolean;
  isLaunching: boolean;
  onPlaybookChange(id: string): void;
  onWorkflowNameChange(name: string): void;
  onWorkspaceChange(id: string): void;
  onParameterChange(key: string, value: string): void;
  onMetadataDraftsChange(drafts: StructuredEntryDraft[]): void;
  onWorkflowConfigChange(path: string, value: string): void;
  onExtraWorkflowConfigDraftsChange(drafts: StructuredEntryDraft[]): void;
  onSuppressedInstructionLayersChange(layers: InstructionLayerName[]): void;
  onWorkflowBudgetChange(draft: WorkflowBudgetDraft): void;
  onModelOverrideDraftsChange(drafts: RoleOverrideDraft[]): void;
  onLaunch(): void;
}): JSX.Element {
  const hasMetadataEntries = props.metadataDrafts.length > 0;
  const hasWorkflowOverrides = props.configuredWorkflowOverrideCount > 0;
  const hasPrimaryParameterSpecs = props.launchDefinition.parameterSpecs.length > 0;
  const hasWorkflowBudgetGuardrails = readWorkflowBudgetMode(props.workflowBudgetDraft) === 'guarded';
  const advancedAdjustmentCount = [
    hasMetadataEntries ? 1 : 0,
    props.configuredWorkflowConfigOverrideCount > 0 || props.hasInstructionConfigOverride ? 1 : 0,
    hasWorkflowBudgetGuardrails ? 1 : 0,
    hasWorkflowOverrides ? 1 : 0,
  ].reduce((count, value) => count + value, 0);
  const shouldOpenAdvancedSection =
    advancedAdjustmentCount > 0 ||
    Boolean(
      props.error ||
        props.workflowConfigBlockingError ||
        props.workflowOverrideBlockingError ||
        (props.showValidationErrors && props.launchValidation.fieldErrors.parameters) ||
        (props.showValidationErrors && props.launchValidation.fieldErrors.metadata),
    );

  return (
    <>
      <LaunchPageHeader selectedPlaybookId={props.selectedPlaybookId} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr),minmax(18rem,24rem)]">
        <Card className="border-border/70 bg-card/80 shadow-sm">
          <CardHeader className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">Process-first launch</Badge>
              <Badge variant="outline">Playbook-driven inputs</Badge>
              <Badge variant="outline">Advanced policy optional</Badge>
            </div>
            <div className="space-y-1">
              <CardTitle>Process-First Launch</CardTitle>
              <p className="text-sm text-muted">
                Start with the playbook process, add any declared launch inputs, then open
                advanced launch policy only when this run needs extra control.
              </p>
            </div>
          </CardHeader>
          <CardContent className="grid gap-6">
            <RunIdentitySection
              selectedPlaybookId={props.selectedPlaybookId}
              isSelectedPlaybookArchived={props.isSelectedPlaybookArchived}
              launchablePlaybooks={props.launchablePlaybooks}
              workflowName={props.workflowName}
              workspaceId={props.workspaceId}
              workspaces={props.workspaces}
              launchValidation={props.launchValidation}
              showValidationErrors={props.showValidationErrors}
              onPlaybookChange={props.onPlaybookChange}
              onWorkflowNameChange={props.onWorkflowNameChange}
              onWorkspaceChange={props.onWorkspaceChange}
            />

            <StructuredSection
              id="process-snapshot"
              title="Process Snapshot"
              description="Confirm the outcome, board shape, stage flow, and declared roles before you customize anything for this run."
            >
              <LaunchDefinitionSnapshot
                launchDefinition={props.launchDefinition}
                outcome={props.selectedPlaybook?.outcome}
              />
            </StructuredSection>

            <StructuredSection
              id="launch-inputs"
              title="Launch Inputs"
              description="Declared launch inputs map directly to workflow parameters for this run."
            >
              {hasPrimaryParameterSpecs ? (
                <div className="grid gap-4">
                  {props.launchDefinition.parameterSpecs.map((spec) => (
                    <ParameterField
                      key={spec.slug}
                      spec={spec}
                      value={props.parameterDrafts[spec.slug] ?? ''}
                      hasError={
                        props.showValidationErrors
                          && Boolean(
                            props.launchValidation.fieldErrors.parameters
                            && spec.required
                            && !(props.parameterDrafts[spec.slug]?.trim()),
                          )
                      }
                      onChange={(value) => props.onParameterChange(spec.slug, value)}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted">
                  This playbook does not declare launch inputs.
                </p>
              )}
              {props.showValidationErrors && props.launchValidation.fieldErrors.parameters ? (
                <p className="text-sm text-red-600 dark:text-red-400">
                  {props.launchValidation.fieldErrors.parameters}
                </p>
              ) : null}
            </StructuredSection>

            <details
              open={shouldOpenAdvancedSection}
              className="rounded-2xl border border-border/70 bg-card/60 p-4"
            >
              <summary className="cursor-pointer list-none">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="font-medium text-foreground">Advanced launch policy</div>
                    <p className="text-sm text-muted">
                      Open only when this run needs metadata, workflow policy, budget guardrails,
                      or model overrides.
                    </p>
                  </div>
                  {advancedAdjustmentCount > 0 ? (
                    <Badge variant="secondary">
                      {advancedAdjustmentCount} configured
                    </Badge>
                  ) : (
                    <Badge variant="outline">Closed by default</Badge>
                  )}
                </div>
              </summary>
              <div className="mt-4 grid gap-6">
                <StructuredSection
                  id="launch-metadata"
                  title="Metadata"
                  description="Attach structured workflow metadata as key/value entries instead of a raw JSON blob."
                >
                  <StructuredEntryEditor
                    title="Metadata Entries"
                    drafts={props.metadataDrafts}
                    validation={props.metadataValidation}
                    showValidationErrors={props.showValidationErrors}
                    onChange={props.onMetadataDraftsChange}
                    addLabel="Add metadata field"
                  />
                </StructuredSection>

                <WorkflowLaunchPolicySections
                  workflowPolicyDefinition={props.workflowPolicyDefinition}
                  workflowConfigDrafts={props.workflowConfigDrafts}
                  workflowConfigValidation={props.workflowConfigValidation}
                  extraWorkflowConfigDrafts={props.extraWorkflowConfigDrafts}
                  extraWorkflowConfigValidation={props.extraWorkflowConfigValidation}
                  suppressedInstructionLayers={props.suppressedInstructionLayers}
                  showValidationErrors={props.showValidationErrors}
                  onWorkflowConfigChange={props.onWorkflowConfigChange}
                  onExtraWorkflowConfigDraftsChange={props.onExtraWorkflowConfigDraftsChange}
                  onSuppressedInstructionLayersChange={props.onSuppressedInstructionLayersChange}
                />

                <StructuredSection
                  id="workflow-budget-policy"
                  title="Workflow Budget Policy"
                  description="Set optional workflow-level guardrails for token spend, cost, and elapsed execution time."
                >
                  <WorkflowBudgetEditor
                    draft={props.workflowBudgetDraft}
                    fieldErrors={props.showValidationErrors ? props.launchValidation.fieldErrors : {}}
                    onChange={props.onWorkflowBudgetChange}
                  />
                </StructuredSection>

                <StructuredSection
                  id="workflow-model-overrides"
                  title="Workflow Model Overrides"
                  description="Configure workflow-scoped overrides per playbook role and preview the effective model stack before launch."
                >
                  {props.launchDefinition.roles.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {props.launchDefinition.roles.map((role) => (
                        <Badge key={role} variant="outline">
                          {role}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted">
                      This playbook definition does not declare roles, so custom override rows are
                      available.
                    </p>
                  )}
                  <RoleOverrideEditor
                    drafts={props.modelOverrideDrafts}
                    playbookRoles={props.launchDefinition.roles}
                    providers={props.llmProviders}
                    models={props.llmModels}
                    validation={props.roleOverrideValidation}
                    showValidationErrors={props.showValidationErrors}
                    onChange={props.onModelOverrideDraftsChange}
                  />
                  {props.hasLlmLoadError ? (
                    <p className="text-sm text-red-600 dark:text-red-400">
                      Failed to load provider or model options for workflow overrides.
                    </p>
                  ) : null}
                </StructuredSection>

                {props.showValidationErrors && props.workflowConfigBlockingError ? (
                  <p className="text-sm text-red-600 dark:text-red-400">
                    {props.workflowConfigBlockingError}
                  </p>
                ) : null}
                {props.showValidationErrors && props.workflowOverrideBlockingError ? (
                  <p className="text-sm text-red-600 dark:text-red-400">
                    {props.workflowOverrideBlockingError}
                  </p>
                ) : null}
              </div>
            </details>
          </CardContent>
        </Card>

        <div className="space-y-4 xl:sticky xl:top-6">
          <LaunchActionCard
            canLaunch={props.canLaunch}
            isReadyToLaunch={props.isReadyToLaunch}
            isLaunching={props.isLaunching}
            formFeedbackMessage={props.formFeedbackMessage}
            onLaunch={props.onLaunch}
          />
          <PlaybookSummaryCard
            playbook={props.selectedPlaybook}
            workspaces={props.workspaces}
            selectedWorkspaceId={props.workspaceId}
            workspaceResolvedModels={props.workspaceResolvedModels}
            previewData={props.previewData}
            previewError={props.previewError}
            previewLoading={props.previewLoading}
            workflowOverrides={props.workflowOverrides}
            workflowConfigOverrideCount={props.configuredWorkflowConfigOverrideCount}
            instructionConfigSummary={props.instructionConfigSummary}
            launchDefinition={props.launchDefinition}
            isLoading={props.isLoadingSummary}
          />
        </div>
      </div>
    </>
  );
}
