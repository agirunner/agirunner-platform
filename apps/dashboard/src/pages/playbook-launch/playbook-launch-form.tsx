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
  ResolutionOrderPanel,
  StructuredSection,
} from './playbook-launch-page.sections.js';
import { ParameterField } from './playbook-launch-parameters.js';
import { LaunchReadinessPanel } from './playbook-launch-readiness.js';
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
  launchDefinition: LaunchDefinitionSummary;
  parameterDrafts: Record<string, string>;
  extraParameterDrafts: StructuredEntryDraft[];
  extraParametersValidation: StructuredEntryValidationResult;
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
  isLaunching: boolean;
  onPlaybookChange(id: string): void;
  onWorkflowNameChange(name: string): void;
  onWorkspaceChange(id: string): void;
  onParameterChange(key: string, value: string): void;
  onExtraParameterDraftsChange(drafts: StructuredEntryDraft[]): void;
  onMetadataDraftsChange(drafts: StructuredEntryDraft[]): void;
  onWorkflowConfigChange(path: string, value: string): void;
  onExtraWorkflowConfigDraftsChange(drafts: StructuredEntryDraft[]): void;
  onSuppressedInstructionLayersChange(layers: InstructionLayerName[]): void;
  onWorkflowBudgetChange(draft: WorkflowBudgetDraft): void;
  onModelOverrideDraftsChange(drafts: RoleOverrideDraft[]): void;
  onLaunch(): void;
}): JSX.Element {
  const hasAdditionalParameters = props.extraParameterDrafts.length > 0;
  const hasMetadataEntries = props.metadataDrafts.length > 0;
  const hasWorkflowOverrides = props.configuredWorkflowOverrideCount > 0;
  const hasPrimaryParameterSpecs = props.launchDefinition.parameterSpecs.length > 0;
  const hasWorkflowBudgetGuardrails = readWorkflowBudgetMode(props.workflowBudgetDraft) === 'guarded';
  const advancedAdjustmentCount = [
    hasPrimaryParameterSpecs && hasAdditionalParameters ? 1 : 0,
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
        (hasPrimaryParameterSpecs && props.launchValidation.fieldErrors.additionalParameters) ||
        props.launchValidation.fieldErrors.metadata,
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
                Start with the playbook process, add workspace context when it can autofill inputs,
                then open advanced launch policy only when this run needs extra control.
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
              description="Resolution order is playbook default, then workspace autofill, then any launch override you enter here."
            >
              <ResolutionOrderPanel />

              {hasPrimaryParameterSpecs ? (
                <div className="grid gap-4">
                  {props.launchDefinition.parameterSpecs.map((spec) => (
                    <ParameterField
                      key={spec.key}
                      spec={spec}
                      workspace={props.selectedWorkspace}
                      value={props.parameterDrafts[spec.key] ?? ''}
                      onChange={(value) => props.onParameterChange(spec.key, value)}
                    />
                  ))}
                </div>
              ) : (
                <StructuredEntryEditor
                  title="Parameters"
                  description="This playbook does not define parameter specs yet, so add only the launch inputs this run actually needs."
                  drafts={props.extraParameterDrafts}
                  validation={props.extraParametersValidation}
                  onChange={props.onExtraParameterDraftsChange}
                  addLabel="Add parameter"
                />
              )}
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
                {hasPrimaryParameterSpecs ? (
                  <StructuredSection
                    id="launch-extra-parameters"
                    title="Additional Parameters"
                    description="Add extra launch parameters only when this run needs fields beyond the playbook-defined inputs."
                  >
                    <StructuredEntryEditor
                      title="Additional Parameters"
                      description="Add extra launch parameters without typing a full JSON object."
                      drafts={props.extraParameterDrafts}
                      validation={props.extraParametersValidation}
                      onChange={props.onExtraParameterDraftsChange}
                      addLabel="Add parameter"
                    />
                  </StructuredSection>
                ) : null}

                <StructuredSection
                  id="launch-metadata"
                  title="Metadata"
                  description="Attach structured workflow metadata as key/value entries instead of a raw JSON blob."
                >
                  <StructuredEntryEditor
                    title="Metadata Entries"
                    drafts={props.metadataDrafts}
                    validation={props.metadataValidation}
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
                    fieldErrors={props.launchValidation.fieldErrors}
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
                    onChange={props.onModelOverrideDraftsChange}
                  />
                  {props.hasLlmLoadError ? (
                    <p className="text-sm text-red-600 dark:text-red-400">
                      Failed to load provider or model options for workflow overrides.
                    </p>
                  ) : null}
                </StructuredSection>

                {props.workflowConfigBlockingError ? (
                  <p className="text-sm text-red-600 dark:text-red-400">
                    {props.workflowConfigBlockingError}
                  </p>
                ) : null}
                {props.workflowOverrideBlockingError ? (
                  <p className="text-sm text-red-600 dark:text-red-400">
                    {props.workflowOverrideBlockingError}
                  </p>
                ) : null}
                {props.error ? (
                  <p className="text-sm text-red-600 dark:text-red-400">{props.error}</p>
                ) : null}
              </div>
            </details>
          </CardContent>
        </Card>

        <div className="space-y-4 xl:sticky xl:top-6">
          <LaunchActionCard
            canLaunch={props.canLaunch}
            isLaunching={props.isLaunching}
            blockingIssueCount={props.launchValidation.blockingIssues.length}
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
          <LaunchReadinessPanel
            selectedPlaybook={props.selectedPlaybook}
            selectedWorkspace={props.selectedWorkspace}
            workflowName={props.workflowName}
            hasStructuredParameters={
              props.launchDefinition.parameterSpecs.length > 0 || hasAdditionalParameters
            }
            hasMetadataEntries={hasMetadataEntries}
            hasWorkflowConfigOverrides={
              props.configuredWorkflowConfigOverrideCount > 0 ||
              props.hasInstructionConfigOverride
            }
            hasWorkflowOverrides={hasWorkflowOverrides}
            budgetDraft={props.workflowBudgetDraft}
            validation={props.launchValidation}
          />
        </div>
      </div>
    </>
  );
}
