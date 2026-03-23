import { Badge } from '../../components/ui/badge.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import type {
  DashboardEffectiveModelResolution,
  DashboardPlaybookRecord,
  DashboardWorkspaceRecord,
  DashboardWorkspaceResolvedModelsResponse,
  DashboardRoleModelOverride,
} from '../../lib/api.js';
import type { readLaunchDefinition } from './playbook-launch-support.js';

export function PlaybookSummaryCard(props: {
  playbook: DashboardPlaybookRecord | null;
  workspaces: DashboardWorkspaceRecord[];
  selectedWorkspaceId: string;
  workspaceResolvedModels?: DashboardWorkspaceResolvedModelsResponse;
  previewData?: {
    roles: string[];
    workspace_model_overrides: Record<string, DashboardRoleModelOverride>;
    workflow_model_overrides: Record<string, DashboardRoleModelOverride>;
    effective_models: Record<string, DashboardEffectiveModelResolution>;
  };
  previewError: unknown;
  previewLoading: boolean;
  workflowOverrides: Record<string, DashboardRoleModelOverride>;
  workflowConfigOverrideCount: number;
  instructionConfigSummary: string;
  launchDefinition: ReturnType<typeof readLaunchDefinition>;
  isLoading: boolean;
}): JSX.Element {
  const selectedWorkspace =
    props.workspaces.find((workspace) => workspace.id === props.selectedWorkspaceId) ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Selected Playbook</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {props.isLoading ? <p className="text-sm text-muted">Loading playbook details...</p> : null}
        {!props.isLoading && !props.playbook ? (
          <p className="text-sm text-muted">
            Select a playbook to review its workflow shape before launch.
          </p>
        ) : null}
        {props.playbook ? (
          <PlaybookSummaryBody
            playbook={props.playbook}
            selectedWorkspace={selectedWorkspace}
            launchDefinition={props.launchDefinition}
            workflowOverrides={props.workflowOverrides}
            workspaceResolvedModels={props.workspaceResolvedModels}
            previewData={props.previewData}
            previewError={props.previewError}
            previewLoading={props.previewLoading}
            workflowConfigOverrideCount={props.workflowConfigOverrideCount}
            instructionConfigSummary={props.instructionConfigSummary}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function PlaybookSummaryBody(props: {
  playbook: DashboardPlaybookRecord;
  selectedWorkspace: DashboardWorkspaceRecord | null;
  launchDefinition: ReturnType<typeof readLaunchDefinition>;
  workflowOverrides: Record<string, DashboardRoleModelOverride>;
  workspaceResolvedModels?: DashboardWorkspaceResolvedModelsResponse;
  previewData?: {
    effective_models: Record<string, DashboardEffectiveModelResolution>;
  };
  previewError: unknown;
  previewLoading: boolean;
  workflowConfigOverrideCount: number;
  instructionConfigSummary: string;
}): JSX.Element {
  return (
    <>
      <div className="space-y-1">
        <div className="text-lg font-medium">{props.playbook.name}</div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary">{props.playbook.lifecycle}</Badge>
        <Badge variant="outline">{props.launchDefinition.boardColumns.length} columns</Badge>
        <Badge variant="outline">{props.launchDefinition.checkpointNames.length} checkpoints</Badge>
        <Badge variant="outline">{props.launchDefinition.roles.length} roles</Badge>
        {props.playbook.is_active === false ? <Badge variant="destructive">Inactive</Badge> : null}
      </div>
      {props.playbook.is_active === false ? (
        <div className="rounded-md border border-amber-300 bg-amber-50/80 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          Launch is disabled while this playbook is inactive. Save a reactivated version from the
          detail page before starting a new workflow.
        </div>
      ) : null}
      {props.launchDefinition.checkpointNames.length > 0 ? (
        <SummaryList
          title="Workflow checkpoints"
          values={props.launchDefinition.checkpointNames}
          emptyMessage="No checkpoints defined."
        />
      ) : null}
      {props.launchDefinition.boardColumns.length > 0 ? (
        <SummaryList
          title="Board columns"
          values={props.launchDefinition.boardColumns.map((column) => column.label)}
          emptyMessage="No board columns defined."
        />
      ) : null}
      <SummaryDetail label="Outcome" value={props.playbook.outcome} />
      <SummaryDetail label="Workspace" value={props.selectedWorkspace?.name ?? 'Standalone workflow'} />
      <SummaryDetail
        label="Workflow override roles"
        value={
          Object.keys(props.workflowOverrides).length > 0
            ? Object.keys(props.workflowOverrides).join(', ')
            : 'No workflow-specific overrides configured.'
        }
      />
      <SummaryDetail
        label="Workflow config overrides"
        value={
          props.workflowConfigOverrideCount > 0
            ? `${props.workflowConfigOverrideCount} workflow config override${
                props.workflowConfigOverrideCount === 1 ? '' : 's'
              } configured.`
            : 'No workflow config overrides configured.'
        }
      />
      <SummaryDetail label="Instruction layer policy" value={props.instructionConfigSummary} />
      <EffectiveModelPreview
        previewLoading={props.previewLoading}
        previewError={props.previewError}
        previewData={props.previewData}
        workspaceResolvedModels={props.workspaceResolvedModels}
      />
    </>
  );
}

function EffectiveModelPreview(props: {
  previewLoading: boolean;
  previewError: unknown;
  previewData?: { effective_models: Record<string, DashboardEffectiveModelResolution> };
  workspaceResolvedModels?: DashboardWorkspaceResolvedModelsResponse;
}): JSX.Element {
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3 text-sm">
      <div className="font-medium">Resolved Effective Models</div>
      {props.previewLoading ? (
        <p className="text-muted">Resolving effective models...</p>
      ) : props.previewError ? (
        <p className="text-red-600 dark:text-red-400">Failed to resolve effective models.</p>
      ) : props.previewData && Object.keys(props.previewData.effective_models).length > 0 ? (
        <ResolvedModelList effectiveModels={props.previewData.effective_models} />
      ) : props.workspaceResolvedModels &&
        Object.keys(props.workspaceResolvedModels.effective_models).length > 0 ? (
        <ResolvedModelList effectiveModels={props.workspaceResolvedModels.effective_models} />
      ) : (
        <p className="text-muted">
          Add workspace or workflow overrides to preview the effective model stack.
        </p>
      )}
    </div>
  );
}

function ResolvedModelList(props: {
  effectiveModels: Record<string, DashboardEffectiveModelResolution>;
}): JSX.Element {
  return (
    <div className="mt-2 space-y-3">
      {Object.entries(props.effectiveModels).map(([role, resolution]) => (
        <div key={role} className="rounded-md border border-border bg-surface p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge variant="outline">{role}</Badge>
            <Badge variant={resolution.fallback ? 'destructive' : 'secondary'}>
              {resolution.source}
            </Badge>
          </div>
          {resolution.resolved ? (
            <div className="space-y-1 text-sm">
              <div className="break-all">
                {resolution.resolved.provider.name} / {resolution.resolved.model.modelId}
              </div>
              {resolution.resolved.model.endpointType ? (
                <div className="text-muted">Endpoint: {resolution.resolved.model.endpointType}</div>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted">No resolved model available.</p>
          )}
          {resolution.fallback_reason ? (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">{resolution.fallback_reason}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function SummaryList(props: {
  title: string;
  values: string[];
  emptyMessage: string;
}): JSX.Element {
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3 text-sm">
      <div className="font-medium">{props.title}</div>
      <div className="mt-2 flex flex-wrap gap-2">
        {props.values.length > 0 ? (
          props.values.map((value) => (
            <Badge key={value} variant="outline">
              {value}
            </Badge>
          ))
        ) : (
          <span className="text-muted">{props.emptyMessage}</span>
        )}
      </div>
    </div>
  );
}

function SummaryDetail(props: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3 text-sm">
      <div className="font-medium">{props.label}</div>
      <div className="text-muted">{props.value}</div>
    </div>
  );
}
