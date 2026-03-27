import type { ReactNode } from 'react';

import { Badge } from '../../../components/ui/badge.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card.js';
import type {
  DashboardMissionControlWorkflowCard,
  DashboardMissionControlWorkspaceOverview as DashboardMissionControlWorkspaceOverviewRecord,
} from '../../../lib/api.js';
import { formatKeyPreview, formatCountLabel } from '../../workflow-detail/workflow-ux-formatting.js';
import { readMissionControlRelationCount } from './mission-control-workspace-support.js';

export function MissionControlWorkspaceOverview(props: {
  workflow: DashboardMissionControlWorkflowCard;
  overview: DashboardMissionControlWorkspaceOverviewRecord;
}): JSX.Element {
  const relationCount = readMissionControlRelationCount(props.overview.relationSummary);

  return (
    <div className="grid gap-4">
      <OverviewPacket title="Current operator ask" description="The current workflow ask as presented to the operator.">
        <p className="text-sm text-foreground">{props.overview.currentOperatorAsk ?? props.workflow.pulse.summary}</p>
      </OverviewPacket>

      <OverviewPacket title="Latest output" description="Most recent deliverable surfaced by the platform-owned output descriptors.">
        {props.overview.latestOutput ? (
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <strong>{props.overview.latestOutput.title}</strong>
              <Badge variant="outline">{props.overview.latestOutput.status.replaceAll('_', ' ')}</Badge>
            </div>
            {props.overview.latestOutput.summary ? (
              <p className="text-sm text-muted-foreground">{props.overview.latestOutput.summary}</p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No output has been published yet.</p>
        )}
      </OverviewPacket>

      <OverviewPacket title="Inputs" description="Immutable launch parameters and hidden execution-context highlights.">
        <ul className="grid gap-2 text-sm text-foreground">
          <li>{formatCountLabel(props.overview.inputSummary.parameterCount, 'launch parameter', 'No launch parameters')}</li>
          <li>Parameters: {formatKeyPreview(props.overview.inputSummary.parameterKeys, 'No parameter keys')}</li>
          <li>Execution context: {formatKeyPreview(props.overview.inputSummary.contextKeys, 'No context keys')}</li>
        </ul>
      </OverviewPacket>

      <OverviewPacket title="Workflow relations" description="Linked workflow lineage visible from the selected run.">
        <ul className="grid gap-2 text-sm text-foreground">
          <li>{formatCountLabel(relationCount, 'related workflow', 'No related workflows')}</li>
          <li>Recorded relation fields: {formatKeyPreview(Object.keys(props.overview.relationSummary), 'No relation fields')}</li>
        </ul>
      </OverviewPacket>

      <OverviewPacket title="Run health and risk" description="Operator-facing risk posture derived from current workflow metrics.">
        <ul className="grid gap-2 text-sm text-foreground">
          <li>{formatCountLabel(props.overview.riskSummary.blockedWorkItemCount, 'blocked work item', 'No blocked work items')}</li>
          <li>{formatCountLabel(props.overview.riskSummary.openEscalationCount, 'open escalation', 'No open escalations')}</li>
          <li>{formatCountLabel(props.overview.riskSummary.failedTaskCount, 'failed task', 'No failed tasks')}</li>
          <li>{formatCountLabel(props.overview.riskSummary.recoverableIssueCount, 'recoverable issue', 'No recoverable issues')}</li>
        </ul>
      </OverviewPacket>
    </div>
  );
}

function OverviewPacket(props: {
  title: string;
  description: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
        <CardDescription>{props.description}</CardDescription>
      </CardHeader>
      <CardContent>{props.children}</CardContent>
    </Card>
  );
}
