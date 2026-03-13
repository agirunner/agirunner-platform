import { Badge } from '../../components/ui/badge.js';
import type {
  DashboardPlaybookRecord,
  DashboardProjectRecord,
} from '../../lib/api.js';
import {
  summarizeWorkflowBudgetDraft,
  type LaunchValidationResult,
  type WorkflowBudgetDraft,
} from './playbook-launch-support.js';

export function LaunchReadinessPanel(props: {
  selectedPlaybook: DashboardPlaybookRecord | null;
  selectedProject: DashboardProjectRecord | null;
  workflowName: string;
  hasStructuredParameters: boolean;
  hasMetadataEntries: boolean;
  hasWorkflowOverrides: boolean;
  budgetDraft: WorkflowBudgetDraft;
  validation: LaunchValidationResult;
}): JSX.Element {
  const budgetSummary = summarizeWorkflowBudgetDraft(props.budgetDraft);
  const checks = buildReadinessChecks(props, budgetSummary);

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {checks.map((check) => (
        <div
          key={check.label}
          className="rounded-md border border-border bg-muted/20 p-3 text-sm"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="font-medium">{check.label}</div>
            <Badge variant={check.isReady ? 'secondary' : 'destructive'}>
              {check.isReady ? 'Ready' : 'Action needed'}
            </Badge>
          </div>
          <p className="mt-2 text-muted">{check.detail}</p>
        </div>
      ))}
      <div className="rounded-md border border-border bg-surface p-3 text-sm sm:col-span-2">
        <div className="font-medium">Launch status</div>
        {props.validation.blockingIssues.length > 0 ? (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
            {props.validation.blockingIssues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-muted">All required launch inputs are present.</p>
        )}
      </div>
    </div>
  );
}

interface ReadinessCheck {
  label: string;
  detail: string;
  isReady: boolean;
}

function buildReadinessChecks(
  props: {
    selectedPlaybook: DashboardPlaybookRecord | null;
    selectedProject: DashboardProjectRecord | null;
    workflowName: string;
    hasStructuredParameters: boolean;
    hasMetadataEntries: boolean;
    hasWorkflowOverrides: boolean;
    validation: LaunchValidationResult;
  },
  budgetSummary: string,
): ReadinessCheck[] {
  return [
    {
      label: 'Playbook selected',
      detail:
        props.selectedPlaybook?.is_active === false
          ? `${props.selectedPlaybook.name} is archived and must be restored before launch.`
          : props.selectedPlaybook?.name ?? 'Choose the playbook to launch.',
      isReady: Boolean(props.selectedPlaybook) && props.selectedPlaybook?.is_active !== false,
    },
    {
      label: 'Workflow named',
      detail: props.workflowName.trim() || 'Enter a descriptive run name.',
      isReady: !props.validation.fieldErrors.workflowName,
    },
    {
      label: 'Project context',
      detail: props.selectedProject?.name ?? 'Standalone workflow',
      isReady: true,
    },
    {
      label: 'Structured launch inputs',
      detail: props.validation.fieldErrors.additionalParameters
        ? props.validation.fieldErrors.additionalParameters
        : props.hasStructuredParameters
          ? 'Parameters are configured through structured controls.'
          : 'This run will start with playbook defaults only.',
      isReady: !props.validation.fieldErrors.additionalParameters,
    },
    {
      label: 'Metadata and model policy',
      detail: props.validation.fieldErrors.metadata
        ? props.validation.fieldErrors.metadata
        : props.validation.fieldErrors.workflowOverrides
          ? props.validation.fieldErrors.workflowOverrides
          : props.hasMetadataEntries || props.hasWorkflowOverrides
            ? 'Metadata or workflow model policy is configured.'
            : 'Using existing defaults and no workflow-specific overrides.',
      isReady:
        !props.validation.fieldErrors.metadata &&
        !props.validation.fieldErrors.workflowOverrides,
    },
    {
      label: 'Workflow budget policy',
      detail:
        props.validation.fieldErrors.tokenBudget ||
        props.validation.fieldErrors.costCapUsd ||
        props.validation.fieldErrors.maxDurationMinutes ||
        budgetSummary,
      isReady:
        !props.validation.fieldErrors.tokenBudget &&
        !props.validation.fieldErrors.costCapUsd &&
        !props.validation.fieldErrors.maxDurationMinutes,
    },
  ];
}
