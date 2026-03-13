import { Loader2, Rocket } from 'lucide-react';

import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import type {
  DashboardEffectiveModelResolution,
  DashboardLlmModelRecord,
  DashboardLlmProviderRecord,
  DashboardPlaybookRecord,
  DashboardProjectRecord,
  DashboardProjectResolvedModelsResponse,
  DashboardRoleModelOverride,
} from '../../lib/api.js';
import type {
  RoleOverrideValidationResult,
  StructuredEntryValidationResult,
} from './playbook-launch-entry-validation.js';
import { StructuredEntryEditor } from './playbook-launch-entries.js';
import { LaunchPageHeader, RunIdentitySection } from './playbook-launch-identity.js';
import {
  LaunchDefinitionSnapshot,
  LaunchOutlineCard,
  StructuredSection,
} from './playbook-launch-page.sections.js';
import { ParameterField } from './playbook-launch-parameters.js';
import { LaunchReadinessPanel } from './playbook-launch-readiness.js';
import {
  type LaunchDefinitionSummary,
  type LaunchSectionLink,
  type LaunchValidationResult,
  type RoleOverrideDraft,
  type StructuredEntryDraft,
  type WorkflowBudgetDraft,
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
  projectId: string;
  projects: DashboardProjectRecord[];
  selectedPlaybook: DashboardPlaybookRecord | null;
  selectedProject: DashboardProjectRecord | null;
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
  sectionLinks: LaunchSectionLink[];
  projectResolvedModels?: DashboardProjectResolvedModelsResponse;
  previewData?: {
    roles: string[];
    project_model_overrides: Record<string, DashboardRoleModelOverride>;
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
  onProjectChange(id: string): void;
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

  return (
    <>
      <LaunchPageHeader selectedPlaybookId={props.selectedPlaybookId} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr),minmax(0,22rem)]">
        <Card>
          <CardHeader>
            <CardTitle>Run Configuration</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-6">
            <RunIdentitySection
              selectedPlaybookId={props.selectedPlaybookId}
              isSelectedPlaybookArchived={props.isSelectedPlaybookArchived}
              launchablePlaybooks={props.launchablePlaybooks}
              workflowName={props.workflowName}
              projectId={props.projectId}
              projects={props.projects}
              launchValidation={props.launchValidation}
              onPlaybookChange={props.onPlaybookChange}
              onWorkflowNameChange={props.onWorkflowNameChange}
              onProjectChange={props.onProjectChange}
            />

            <StructuredSection
              id="launch-readiness"
              title="Launch Readiness"
              description="Review the launch essentials before starting the run."
            >
              <LaunchReadinessPanel
                selectedPlaybook={props.selectedPlaybook}
                selectedProject={props.selectedProject}
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
            </StructuredSection>

            <StructuredSection
              id="playbook-snapshot"
              title="Playbook Snapshot"
              description="Preview the board shape, stages, and declared roles that will frame this run."
            >
              <LaunchDefinitionSnapshot launchDefinition={props.launchDefinition} />
            </StructuredSection>

            <StructuredSection
              id="playbook-parameters"
              title="Playbook Parameters"
              description={
                props.launchDefinition.parameterSpecs.length > 0
                  ? 'Launch-time parameters are driven from the selected playbook definition.'
                  : 'This playbook does not define parameter specs yet. Add structured parameter keys as needed.'
              }
            >
              {props.launchDefinition.parameterSpecs.length > 0 ? (
                <div className="grid gap-4">
                  {props.launchDefinition.parameterSpecs.map((spec) => (
                    <ParameterField
                      key={spec.key}
                      spec={spec}
                      project={props.selectedProject}
                      value={props.parameterDrafts[spec.key] ?? ''}
                      onChange={(value) => props.onParameterChange(spec.key, value)}
                    />
                  ))}
                </div>
              ) : null}

              <StructuredEntryEditor
                title={
                  props.launchDefinition.parameterSpecs.length > 0
                    ? 'Additional Parameters'
                    : 'Parameters'
                }
                description="Add extra launch parameters without typing a full JSON object."
                drafts={props.extraParameterDrafts}
                validation={props.extraParametersValidation}
                onChange={props.onExtraParameterDraftsChange}
                addLabel="Add parameter"
              />
            </StructuredSection>

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
              description="Set optional workflow-level guardrails for token spend, cost, and elapsed runtime."
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
              <p className="text-sm text-red-600 dark:text-red-400">{props.workflowConfigBlockingError}</p>
            ) : null}
            {props.workflowOverrideBlockingError ? (
              <p className="text-sm text-red-600 dark:text-red-400">{props.workflowOverrideBlockingError}</p>
            ) : null}
            {props.error ? <p className="text-sm text-red-600 dark:text-red-400">{props.error}</p> : null}

            <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/10 p-4">
              <div className="space-y-1">
                <div className="text-sm font-medium text-foreground">Ready to launch</div>
                <p className="text-sm text-muted">
                  Start the run from the pinned launch bar after reviewing the structured inputs
                  above.
                </p>
              </div>
              <Badge variant={props.canLaunch ? 'secondary' : 'destructive'}>
                {props.canLaunch ? 'Ready to launch' : 'Action needed'}
              </Badge>
            </section>
          </CardContent>
        </Card>

        <div className="space-y-4 xl:sticky xl:top-6">
          <LaunchOutlineCard sections={props.sectionLinks} />
          <PlaybookSummaryCard
            playbook={props.selectedPlaybook}
            projects={props.projects}
            selectedProjectId={props.projectId}
            projectResolvedModels={props.projectResolvedModels}
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

      <div className="sticky bottom-4 z-10">
        <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-surface/95 p-4 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="text-sm font-medium">Launch stays within reach while you scroll</div>
            <p className="text-sm text-muted">
              The launch bar remains pinned so long parameter, metadata, and override sections stay
              usable on desktop and phone-sized layouts.
            </p>
          </div>
          <Button onClick={props.onLaunch} disabled={!props.canLaunch}>
            {props.isLaunching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Rocket className="h-4 w-4" />
            )}
            Launch Run
          </Button>
        </div>
      </div>
    </>
  );
}
