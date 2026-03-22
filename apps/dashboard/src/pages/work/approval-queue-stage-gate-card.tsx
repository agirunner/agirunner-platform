import { Link } from 'react-router-dom';
import { Clock3, GitBranch, ShieldAlert, Workflow } from 'lucide-react';

import type { DashboardApprovalStageGateRecord } from '../../lib/api.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.js';
import { GateDetailCard } from './gate-detail-card.js';
import { readGateResumeTaskSummary } from './gate-handoff-support.js';
import { ApprovalQueueReviewDisclosure } from './approval-queue-review-disclosure.js';
import {
  computeWaitingTime,
  gateQueuePriorityVariant,
  renderQueuePriorityLabel,
} from './approval-queue-support.js';
import { QueueInfoTile } from './approval-queue-layout.js';
import { OperatorBreadcrumbTrail } from './operator-breadcrumb-trail.js';
import {
  buildGateRecoveryPacket,
  buildGateBreadcrumbs,
  readGateDecisionSummary,
  readGatePacketSummary,
  readGateRequestSourceSummary,
  readGateResumptionSummary,
} from './gate-detail-support.js';
import { buildWorkflowDetailPermalink } from '../workflow-detail-permalinks.js';

export function StageGateQueueCard(props: {
  gate: DashboardApprovalStageGateRecord;
  index: number;
}): JSX.Element {
  const { gate, index } = props;
  const requestedWorkItemPermalink = gate.requested_by_task?.work_item_id
    ? buildWorkflowDetailPermalink(gate.workflow_id, {
        workItemId: gate.requested_by_task.work_item_id,
      })
    : null;
  const resumePermalink = gate.orchestrator_resume?.activation_id
    ? buildWorkflowDetailPermalink(gate.workflow_id, {
        activationId: gate.orchestrator_resume.activation_id,
      })
    : null;
  const breadcrumbs = buildGateBreadcrumbs(gate).map((label) => ({ label }));
  const packetSummary = readGatePacketSummary(gate);
  const requestSource = readGateRequestSourceSummary(gate);
  const decisionSummary = readGateDecisionSummary(gate);
  const resumptionSummary = readGateResumptionSummary(gate);
  const resumeTaskSummary = readGateResumeTaskSummary(gate);
  const recoveryPacket = buildGateRecoveryPacket(gate);

  return (
    <Card className="border-border/80">
      <CardHeader className="gap-3 pb-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={gateQueuePriorityVariant(index)}>
                {renderQueuePriorityLabel(index)}
              </Badge>
              <Badge variant="outline">
                <Clock3 className="mr-1 h-3 w-3" />
                Oldest wait first
              </Badge>
              <Badge variant="outline">{decisionSummary}</Badge>
              <Badge variant="outline">{resumptionSummary}</Badge>
            </div>
            <div className="space-y-1">
              <CardTitle className="text-base">{gate.stage_name}</CardTitle>
              <CardDescription>
                {gate.stage_goal || 'Human decision packet for this stage gate.'}
              </CardDescription>
            </div>
            <OperatorBreadcrumbTrail items={breadcrumbs} />
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button variant="outline" size="sm" className="w-full sm:w-auto" asChild>
              <Link
                to={buildWorkflowDetailPermalink(gate.workflow_id, {
                  gateStageName: gate.stage_name,
                })}
              >
                Open board gate
              </Link>
            </Button>
            {requestedWorkItemPermalink ? (
              <Button variant="outline" size="sm" className="w-full sm:w-auto" asChild>
                <Link to={requestedWorkItemPermalink}>Open work-item flow</Link>
              </Button>
            ) : null}
            {resumePermalink ? (
              <Button variant="outline" size="sm" className="w-full sm:w-auto" asChild>
                <Link to={resumePermalink}>Open follow-up activation</Link>
              </Button>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <QueueInfoTile label="Board" value={gate.workflow_name || gate.workflow_id} />
          <QueueInfoTile label="Stage" value={gate.stage_name} />
          <QueueInfoTile label="Updated" value={computeWaitingTime(gate.updated_at)} />
          <QueueInfoTile label="Gate record" value={gate.gate_id || gate.id} monospace />
        </div>
        {packetSummary.length > 0 || requestSource.length > 0 || resumptionSummary ? (
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="rounded-md border border-border/70 bg-border/10 p-3">
              <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted">
                <GitBranch className="h-3.5 w-3.5" />
                Gate packet
              </div>
              {packetSummary.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {packetSummary.map((item) => (
                    <Badge
                      key={`${gate.workflow_id}:${gate.stage_name}:packet:${item}`}
                      variant="secondary"
                    >
                      {item}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted">
                  Open the full decision packet for the full request summary, concerns, and linked
                  evidence.
                </p>
              )}
            </div>
            <div className="rounded-md border border-border/70 bg-border/10 p-3">
              <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted">
                <ShieldAlert className="h-3.5 w-3.5" />
                Request source
              </div>
              {requestSource.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {requestSource.map((item) => (
                    <Badge
                      key={`${gate.workflow_id}:${gate.stage_name}:source:${item}`}
                      variant="outline"
                    >
                      {item}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted">
                  This gate is already the best operator view. Step diagnostics are only needed when
                  you want source execution evidence.
                </p>
              )}
            </div>
            <div className="rounded-md border border-border/70 bg-border/10 p-3">
              <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted">
                <Workflow className="h-3.5 w-3.5" />
                Next operator move
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={recoveryPacket.tone}>{recoveryPacket.title}</Badge>
                <Badge variant="outline">{decisionSummary}</Badge>
              </div>
              <p className="mt-2 text-xs text-muted">{recoveryPacket.summary}</p>
              <p className="mt-2 text-xs text-muted">{resumptionSummary}</p>
              {gate.orchestrator_resume?.reason ? (
                <p className="mt-2 text-xs text-muted">{gate.orchestrator_resume.reason}</p>
              ) : null}
              {resumeTaskSummary ? (
                <p className="mt-2 text-xs text-muted">Follow-up step: {resumeTaskSummary}</p>
              ) : null}
            </div>
          </div>
        ) : null}
        <ApprovalQueueReviewDisclosure
          title="Gate decision packet"
          summary={`${recoveryPacket.title}. Open the full decision packet for the decision trail, key artifacts, and recovery evidence before acting.`}
        >
          <GateDetailCard gate={gate} source="approval-queue" />
        </ApprovalQueueReviewDisclosure>
      </CardContent>
    </Card>
  );
}
