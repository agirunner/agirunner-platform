import { Link } from 'react-router-dom';

import type { DashboardMissionControlLiveSection, DashboardMissionControlWorkflowCard } from '../../lib/api.js';
import { Badge } from '../../components/ui/badge.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card.js';
import { buildMissionControlShellHref } from './mission-control-page.support.js';
import { formatCountLabel } from '../workflow-detail/workflow-ux-formatting.js';

export function MissionControlCanvas(props: {
  sections: DashboardMissionControlLiveSection[];
  selectedWorkflowId: string | null;
  onSelectWorkflow: (workflowId: string) => void;
}): JSX.Element {
  const sections = props.sections.filter((section) => section.workflows.length > 0);

  if (sections.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Tenant canvas</CardTitle>
          <CardDescription>No active workflows match the current Workflows scope.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {sections.map((section) => (
        <section key={section.id} className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">{section.title}</h2>
              <p className="text-xs text-muted-foreground">
                {formatCountLabel(section.count, 'workflow', 'No workflows')} in this posture
              </p>
            </div>
            <Badge variant="outline">{section.count}</Badge>
          </div>
          <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            {section.workflows.map((workflow) => (
              <WorkflowCanvasCard
                key={workflow.id}
                workflow={workflow}
                isSelected={workflow.id === props.selectedWorkflowId}
                onSelectWorkflow={props.onSelectWorkflow}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function WorkflowCanvasCard(props: {
  workflow: DashboardMissionControlWorkflowCard;
  isSelected: boolean;
  onSelectWorkflow: (workflowId: string) => void;
}): JSX.Element {
  const { workflow } = props;
  const output = workflow.outputDescriptors[0] ?? null;

  return (
    <Card className={props.isSelected ? 'border-accent/80 ring-1 ring-accent/30' : undefined}>
      <CardHeader className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="truncate text-base">{workflow.name}</CardTitle>
            <CardDescription className="truncate">
              {[workflow.playbookName, workflow.workspaceName].filter(Boolean).join(' • ') || 'Workflow'}
            </CardDescription>
          </div>
          <Badge variant="outline">{describePosture(workflow.posture)}</Badge>
        </div>
        {props.isSelected ? <Badge>Current focus</Badge> : null}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">{workflow.pulse.summary}</p>
          <p className="text-xs text-muted-foreground">
            {workflow.currentStage ? `Stage ${workflow.currentStage}` : 'Continuous workflow'}
          </p>
        </div>

        <div className="grid gap-2 rounded-lg border border-border/60 bg-muted/10 p-3 text-xs sm:grid-cols-2">
          <Metric label="Tasks" value={formatCountLabel(workflow.metrics.activeTaskCount, 'active task', 'No active tasks')} />
          <Metric
            label="Work items"
            value={formatCountLabel(workflow.metrics.activeWorkItemCount, 'active work item', 'No active work items')}
          />
          <Metric
            label="Decisions"
            value={formatCountLabel(workflow.metrics.waitingForDecisionCount, 'pending decision', 'No pending decisions')}
          />
          <Metric
            label="Risk"
            value={formatCountLabel(workflow.metrics.openEscalationCount, 'open escalation', 'No open escalations')}
          />
        </div>

        <div className="rounded-lg border border-border/60 bg-background/70 p-3">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Output snapshot
          </p>
          <p className="mt-2 text-sm text-foreground">{output?.title ?? 'No published outputs yet'}</p>
          {output?.summary ? (
            <p className="mt-1 text-xs text-muted-foreground">{output.summary}</p>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {workflow.metrics.lastChangedAt ? 'Recently changed' : 'No recent changes'}
          </span>
          <Link
            className="text-sm font-medium text-accent hover:underline"
            aria-label={`Open ${workflow.name} workflow`}
            to={buildMissionControlShellHref({ rail: 'workflow', workflowId: workflow.id })}
            onClick={() => props.onSelectWorkflow(workflow.id)}
          >
            Open workflow
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function Metric(props: { label: string; value: string }): JSX.Element {
  return (
    <div className="space-y-1">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{props.label}</p>
      <p className="text-sm text-foreground">{props.value}</p>
    </div>
  );
}

function describePosture(posture: DashboardMissionControlWorkflowCard['posture']): string {
  switch (posture) {
    case 'needs_decision':
      return 'Needs decision';
    case 'needs_intervention':
      return 'Needs intervention';
    case 'recoverable_needs_steering':
      return 'Needs steering';
    case 'waiting_by_design':
      return 'Waiting';
    case 'terminal_failed':
      return 'Failed';
    default:
      return posture.replaceAll('_', ' ');
  }
}
