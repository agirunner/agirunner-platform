import { Link } from 'react-router-dom';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table.js';
import type {
  DashboardProjectRecord,
  DashboardScheduledWorkItemTriggerRecord,
  DashboardWebhookWorkItemTriggerRecord,
  DashboardWorkflowRecord,
} from '../../lib/api.js';
import type {
  TriggerOperatorFocusPacket,
  TriggerOverviewSummaryCard,
} from './work-item-triggers-page.support.js';
import {
  describeScheduledTriggerHealth,
  describeScheduledTriggerPacket,
  describeWebhookTriggerActivity,
  describeWebhookTriggerPacket,
} from './work-item-triggers-page.support.js';

export function TriggerSummarySection(props: {
  focus: TriggerOperatorFocusPacket;
  summaries: TriggerOverviewSummaryCard[];
}): JSX.Element {
  return (
    <div className="space-y-4">
      <Card className="border-border/70 shadow-sm">
        <CardHeader className="gap-2">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted">
            Operator focus
          </p>
          <CardTitle className="text-lg">{props.focus.title}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="text-2xl font-semibold text-foreground">{props.focus.value}</p>
            <p className="max-w-3xl text-sm leading-6 text-muted">{props.focus.detail}</p>
          </div>
          <Button asChild variant="outline" className="w-full sm:w-auto">
            <Link to="/projects">Open project settings</Link>
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        {props.summaries.map((summary) => (
          <Card key={summary.label} className="border-border/70 shadow-sm">
            <CardHeader className="space-y-1">
              <p className="text-sm font-medium text-muted">{summary.label}</p>
              <CardTitle className="text-2xl">{summary.value}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-6 text-muted">{summary.detail}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function ScheduledTriggerSection(props: {
  projects: DashboardProjectRecord[];
  workflows: DashboardWorkflowRecord[];
  triggers: DashboardScheduledWorkItemTriggerRecord[];
}): JSX.Element {
  const projectsById = new Map(props.projects.map((project) => [project.id, project.name] as const));
  const workflowsById = new Map(
    props.workflows.map((workflow) => [workflow.id, workflow.name || workflow.id] as const),
  );

  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader className="space-y-2">
        <CardTitle>Scheduled Triggers</CardTitle>
        <p className="max-w-3xl text-sm leading-6 text-muted">
          Review cadence, next-run posture, and the owning project before changing recurring
          work-item automation.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-4 lg:hidden">
          {props.triggers.map((trigger) => {
            const packet = describeScheduledTriggerPacket(trigger);
            const health = describeScheduledTriggerHealth(trigger);
            return (
              <Card key={trigger.id} className="border-border/70 bg-muted/10 shadow-none">
                <CardHeader className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-base">{trigger.name}</CardTitle>
                    <Badge variant={health.variant}>{health.label}</Badge>
                  </div>
                  <p className="text-sm text-muted">
                    {describeProjectLabel(projectsById, trigger.project_id)}
                  </p>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <TriggerInfo label="Cadence" value={packet.cadence} />
                  <TriggerInfo label="Next run" value={packet.nextRun} />
                  <TriggerInfo label="Source" value={packet.source} />
                  <TriggerInfo
                    label="Open board"
                    value={workflowsById.get(trigger.workflow_id) ?? trigger.workflow_id}
                  />
                  <TriggerInfo label="Next action" value={packet.nextAction} />
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button asChild size="sm" variant="outline">
                      <Link to={`/projects/${trigger.project_id}`}>Open project</Link>
                    </Button>
                    <Button asChild size="sm" variant="outline">
                      <Link to={`/work/workflows/${trigger.workflow_id}`}>Open board</Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="hidden overflow-x-auto lg:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rule</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Cadence</TableHead>
                <TableHead>Next run</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Next action</TableHead>
                <TableHead className="text-right">Links</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {props.triggers.map((trigger) => {
                const packet = describeScheduledTriggerPacket(trigger);
                const health = describeScheduledTriggerHealth(trigger);
                return (
                  <TableRow key={trigger.id}>
                    <TableCell className="font-medium">{trigger.name}</TableCell>
                    <TableCell>{describeProjectLabel(projectsById, trigger.project_id)}</TableCell>
                    <TableCell>{packet.cadence}</TableCell>
                    <TableCell>{packet.nextRun}</TableCell>
                    <TableCell>
                      <Badge variant={health.variant}>{health.label}</Badge>
                    </TableCell>
                    <TableCell className="max-w-sm text-sm text-muted">{packet.nextAction}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button asChild size="sm" variant="outline">
                          <Link to={`/projects/${trigger.project_id}`}>Open project</Link>
                        </Button>
                        <Button asChild size="sm" variant="outline">
                          <Link to={`/work/workflows/${trigger.workflow_id}`}>Open board</Link>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

export function WebhookTriggerSection(props: {
  projects: DashboardProjectRecord[];
  workflows: DashboardWorkflowRecord[];
  triggers: DashboardWebhookWorkItemTriggerRecord[];
}): JSX.Element {
  const projectsById = new Map(props.projects.map((project) => [project.id, project.name] as const));
  const workflowsById = new Map(
    props.workflows.map((workflow) => [workflow.id, workflow.name || workflow.id] as const),
  );

  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader className="space-y-2">
        <CardTitle>Webhook Triggers</CardTitle>
        <p className="max-w-3xl text-sm leading-6 text-muted">
          Review inbound trigger coverage, signature mode, and the owning project before changing
          external intake.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-4 lg:hidden">
          {props.triggers.map((trigger) => {
            const packet = describeWebhookTriggerPacket(trigger);
            const activity = describeWebhookTriggerActivity(trigger);
            return (
              <Card key={trigger.id} className="border-border/70 bg-muted/10 shadow-none">
                <CardHeader className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-base">{trigger.name}</CardTitle>
                    <Badge variant={activity.variant}>{activity.label}</Badge>
                  </div>
                  <p className="text-sm text-muted">
                    {describeProjectLabel(projectsById, trigger.project_id)}
                  </p>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <TriggerInfo label="Source" value={packet.source} />
                  <TriggerInfo label="Signature mode" value={packet.mode} />
                  <TriggerInfo label="Activity" value={packet.activity} />
                  <TriggerInfo
                    label="Open board"
                    value={workflowsById.get(trigger.workflow_id) ?? trigger.workflow_id}
                  />
                  <TriggerInfo label="Next action" value={packet.nextAction} />
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button asChild size="sm" variant="outline">
                      <Link to={`/projects/${trigger.project_id}`}>Open project</Link>
                    </Button>
                    <Button asChild size="sm" variant="outline">
                      <Link to={`/work/workflows/${trigger.workflow_id}`}>Open board</Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="hidden overflow-x-auto lg:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Trigger</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Signature mode</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Next action</TableHead>
                <TableHead className="text-right">Links</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {props.triggers.map((trigger) => {
                const packet = describeWebhookTriggerPacket(trigger);
                const activity = describeWebhookTriggerActivity(trigger);
                return (
                  <TableRow key={trigger.id}>
                    <TableCell className="font-medium">{trigger.name}</TableCell>
                    <TableCell>{describeProjectLabel(projectsById, trigger.project_id)}</TableCell>
                    <TableCell>{packet.source}</TableCell>
                    <TableCell>{packet.mode}</TableCell>
                    <TableCell>
                      <Badge variant={activity.variant}>{activity.label}</Badge>
                    </TableCell>
                    <TableCell className="max-w-sm text-sm text-muted">{packet.nextAction}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button asChild size="sm" variant="outline">
                          <Link to={`/projects/${trigger.project_id}`}>Open project</Link>
                        </Button>
                        <Button asChild size="sm" variant="outline">
                          <Link to={`/work/workflows/${trigger.workflow_id}`}>Open board</Link>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function TriggerInfo(props: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{props.label}</p>
      <p className="text-sm text-foreground">{props.value}</p>
    </div>
  );
}

function describeProjectLabel(
  projectsById: Map<string, string>,
  projectId: string | null | undefined,
): string {
  if (!projectId) {
    return 'Unscoped project';
  }
  return projectsById.get(projectId) ?? projectId;
}
