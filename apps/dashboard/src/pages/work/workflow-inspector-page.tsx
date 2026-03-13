import { useQuery } from '@tanstack/react-query';
import { ClipboardList, ExternalLink, Workflow } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';

import { LogsSurface } from '../mission-control/logs-page.js';
import { dashboardApi } from '../../lib/api.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.js';
import { Skeleton } from '../../components/ui/skeleton.js';
import { buildWorkflowInspectorTraceModel } from './workflow-inspector-support.js';

function InspectorMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail?: string;
}): JSX.Element {
  return (
    <div className="rounded-xl border border-border/70 bg-background/70 p-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
      {detail ? <p className="mt-2 text-sm leading-6 text-muted">{detail}</p> : null}
    </div>
  );
}

export function WorkflowInspectorPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const workflowId = params.id ?? '';
  const workflowQuery = useQuery({
    queryKey: ['workflow', workflowId, 'inspector-entry'],
    queryFn: () => dashboardApi.getWorkflow(workflowId),
    enabled: workflowId.length > 0,
    staleTime: 30_000,
  });

  const workflow = workflowQuery.data;
  const projectQuery = useQuery({
    queryKey: ['project', workflow?.project_id, 'inspector-trace'],
    queryFn: () => dashboardApi.getProject(workflow?.project_id ?? ''),
    enabled: Boolean(workflow?.project_id),
    staleTime: 30_000,
  });
  const liveStageLabel = describeLiveStageLabel(workflow);
  const traceModel = buildWorkflowInspectorTraceModel({
    workflow,
    project: projectQuery.data,
  });

  return (
    <div className="space-y-6">
      <Card className="mx-6 mt-6 border-border/70 bg-card/80 shadow-sm">
        <CardHeader className="gap-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Workflow className="h-5 w-5 text-muted-foreground" />
                <CardTitle>Workflow Inspector</CardTitle>
              </div>
              <CardDescription className="max-w-3xl">
                Inspect execution traces for a single workflow with the shared inspector tooling,
                while keeping workflow scope, live board posture, and quick navigation visible.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <Link to={`/work/workflows/${workflowId}`}>
                  Workflow Board
                  <ExternalLink className="h-4 w-4" />
                </Link>
              </Button>
              {workflow?.project_id ? (
                <Button asChild variant="outline">
                  <Link to={`/projects/${workflow.project_id}`}>
                    Project
                    <ExternalLink className="h-4 w-4" />
                  </Link>
                </Button>
              ) : null}
              {workflow?.project_id ? (
                <Button asChild variant="outline">
                  <Link to={`/projects/${workflow.project_id}/memory`}>
                    Project Memory
                    <ExternalLink className="h-4 w-4" />
                  </Link>
                </Button>
              ) : null}
              {workflow?.project_id ? (
                <Button asChild variant="outline">
                  <Link to={`/projects/${workflow.project_id}/artifacts`}>
                    Project Artifacts
                    <ExternalLink className="h-4 w-4" />
                  </Link>
                </Button>
              ) : null}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {workflowQuery.isLoading ? (
            <div className="grid gap-3 md:grid-cols-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : workflow ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{workflow.state}</Badge>
                {workflow.lifecycle ? <Badge variant="secondary">{workflow.lifecycle}</Badge> : null}
                {workflow.playbook_name ? <Badge variant="outline">{workflow.playbook_name}</Badge> : null}
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <InspectorMetric label="Workflow" value={workflow.name} />
                <InspectorMetric
                  label="Live Stages"
                  value={workflow.work_item_summary?.active_stage_count ?? 0}
                />
                <InspectorMetric
                  label="Open Work Items"
                  value={workflow.work_item_summary?.open_work_item_count ?? 0}
                />
              </div>
              <div className="rounded-xl border border-border/70 bg-border/10 p-4">
                <div className="flex items-start gap-3">
                  <ClipboardList className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  <div className="space-y-1 text-sm">
                    <p className="font-medium text-foreground">Current operator scope</p>
                    <p className="text-muted">
                      {workflow.project_name ? `${workflow.project_name} · ` : ''}
                      {liveStageLabel}
                    </p>
                  </div>
                </div>
              </div>
              <div className="grid gap-4 rounded-xl border border-border/70 bg-background/70 p-4">
                <div className="grid gap-1">
                  <div className="text-sm font-medium text-foreground">Trace coverage</div>
                  <p className="text-sm leading-6 text-muted">
                    Follow activations, work items, gates, artifacts, and memory handoff without leaving the workflow inspector shell.
                  </p>
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                  {traceModel.metrics.map((metric) => (
                    <InspectorMetric
                      key={metric.label}
                      label={metric.label}
                      value={metric.value}
                      detail={metric.detail}
                    />
                  ))}
                </div>
                <div className="grid gap-3 xl:grid-cols-2">
                  <TraceCoverageNote
                    title="Highest reported stage spend"
                    value={
                      traceModel.topStageSpend
                      ?? 'No per-stage spend packet is available in the current run summary.'
                    }
                  />
                  <TraceCoverageNote
                    title="Latest activation packet"
                    value={
                      traceModel.latestActivationSummary
                      ?? 'No activation batch has been recorded for this workflow yet.'
                    }
                  />
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  {traceModel.links.map((link) => (
                    <Card key={link.label} className="border-border/70 bg-card/70 shadow-none">
                      <CardContent className="grid gap-2 p-4">
                        <div className="text-sm font-medium text-foreground">{link.label}</div>
                        <div className="text-sm leading-6 text-muted">{link.detail}</div>
                        <Button asChild variant="outline" className="justify-between">
                          <Link to={link.href}>
                            Open
                            <ExternalLink className="h-4 w-4" />
                          </Link>
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-border/70 bg-border/5 p-4 text-sm text-muted">
              Workflow context is unavailable right now. The scoped inspector is still available below.
            </div>
          )}
        </CardContent>
      </Card>

      <LogsSurface scopedWorkflowId={workflowId} />
    </div>
  );
}

function describeLiveStageLabel(
  workflow:
    | {
        lifecycle?: 'standard' | 'continuous' | null;
        work_item_summary?: { active_stage_names?: string[] | null } | null;
        active_stages?: string[] | null;
        current_stage?: string | null;
      }
    | undefined,
) {
  const summaryStages = workflow?.work_item_summary?.active_stage_names?.filter(Boolean) ?? [];
  const activeStages = workflow?.active_stages?.filter(Boolean) ?? [];
  const liveStages = summaryStages.length > 0 ? summaryStages : activeStages;
  if (liveStages.length > 0) {
    return liveStages.join(', ');
  }
  if (workflow?.lifecycle === 'continuous') {
    return 'No live stages';
  }
  return workflow?.current_stage ?? 'No live stage';
}

function TraceCoverageNote(props: { title: string; value: string }): JSX.Element {
  return (
    <div className="rounded-xl border border-border/70 bg-border/5 p-4">
      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
        {props.title}
      </div>
      <p className="mt-2 text-sm leading-6 text-foreground">{props.value}</p>
    </div>
  );
}
