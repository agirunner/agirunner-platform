import { useQuery } from '@tanstack/react-query';
import { ClipboardList, ExternalLink, Workflow } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';

import { LogsSurface } from '../mission-control/logs-page.js';
import { dashboardApi } from '../../lib/api.js';
import { buildProjectArtifactBrowserPath } from '../../lib/artifact-navigation.js';
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
import {
  buildWorkflowInspectorFocusSummary,
  buildWorkflowInspectorTraceModel,
} from './workflow-inspector-support.js';
import { WorkflowInspectorTelemetryPanel } from './workflow-inspector-telemetry-panel.js';
import { buildWorkflowInspectorTelemetryModel } from './workflow-inspector-telemetry.js';
import {
  describeWorkflowScopeSummary,
  describeWorkflowStageLabel,
  describeWorkflowStageValue,
} from './workflow-inspector-stage-presentation.js';
import {
  InspectorFocusCard,
  InspectorLinkCard,
  InspectorMetric,
  InspectorSectionJumpStrip,
  TraceCoverageNote,
} from './workflow-inspector-page.sections.js';

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
  const stageLabel = describeWorkflowStageLabel(workflow);
  const stageValue = describeWorkflowStageValue(workflow);
  const scopeSummary = describeWorkflowScopeSummary(workflow);
  const traceModel = buildWorkflowInspectorTraceModel({
    workflow,
    project: projectQuery.data,
  });
  const taskCostQuery = useQuery({
    queryKey: ['workflow', workflowId, 'inspector-task-cost'],
    queryFn: () => dashboardApi.getLogStats({ workflow_id: workflowId, group_by: 'task_id' }),
    enabled: workflowId.length > 0,
    staleTime: 30_000,
  });
  const activationCostQuery = useQuery({
    queryKey: ['workflow', workflowId, 'inspector-activation-cost'],
    queryFn: () =>
      dashboardApi.getLogStats({
        workflow_id: workflowId,
        group_by: 'activation_id',
        is_orchestrator_task: 'true',
      }),
    enabled: workflowId.length > 0,
    staleTime: 30_000,
  });
  const memoryHistoryQuery = useQuery({
    queryKey: ['workflow', workflowId, 'inspector-memory-history', traceModel.focusWorkItem?.id],
    queryFn: () =>
      dashboardApi.getWorkflowWorkItemMemoryHistory(
        workflowId,
        traceModel.focusWorkItem?.id ?? '',
        8,
      ),
    enabled: workflowId.length > 0 && Boolean(traceModel.focusWorkItem?.id),
    staleTime: 30_000,
  });
  const latestHandoffQuery = useQuery({
    queryKey: ['workflow', workflowId, 'inspector-latest-handoff', traceModel.focusWorkItem?.id],
    queryFn: () =>
      dashboardApi.getLatestWorkflowWorkItemHandoff(
        workflowId,
        traceModel.focusWorkItem?.id ?? '',
      ),
    enabled: workflowId.length > 0 && Boolean(traceModel.focusWorkItem?.id),
    staleTime: 30_000,
  });
  const telemetryModel = buildWorkflowInspectorTelemetryModel({
    workflowId,
    workflow,
    taskCostStats: taskCostQuery.data,
    activationCostStats: activationCostQuery.data,
    focusWorkItem: traceModel.focusWorkItem,
    memoryHistory: memoryHistoryQuery.data?.history,
  });
  const focusSummary = buildWorkflowInspectorFocusSummary({
    workflowId,
    workflow,
    liveStageLabel: stageValue,
    traceModel,
    latestHandoff: latestHandoffQuery.data,
  });
  const jumpSections = [
    {
      id: 'workflow-inspector-scope',
      label: 'Board posture',
      value: workflow?.name ?? 'Workflow scope',
      detail:
        'Start with board posture, lifecycle state, and operator scope before moving into trace or spend detail.',
      buttonLabel: 'Jump to board posture',
    },
    {
      id: 'workflow-inspector-trace-coverage',
      label: 'Trace coverage',
      value: `${traceModel.metrics.length} trace lanes`,
      detail:
        'Use activation, work-item, gate, artifact, and memory packets to decide where the real execution story lives.',
      buttonLabel: 'Jump to trace coverage',
    },
    {
      id: 'workflow-inspector-log-trace',
      label: 'Scoped log trace',
      value: workflowId ? 'Raw log stream ready' : 'Trace unavailable',
      detail:
        'Move from board packets into raw execution evidence without leaving the inspector shell.',
      buttonLabel: 'Jump to log trace',
    },
  ];

  return (
    <div className="space-y-6">
      <Card className="mx-6 mt-6 border-border/70 bg-card/80 shadow-sm">
        <CardHeader className="gap-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Workflow className="h-5 w-5 text-muted-foreground" />
                <CardTitle>Workflow Board Inspector</CardTitle>
              </div>
              <CardDescription className="max-w-3xl">
                Inspect execution traces for a single workflow with the shared inspector tooling,
                while keeping workflow scope, live board posture, and quick navigation visible.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <Link to={`/work/boards/${workflowId}`}>
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
                  <Link
                    to={buildProjectArtifactBrowserPath(workflow.project_id, {
                      workflowId,
                    })}
                  >
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
              <InspectorSectionJumpStrip sections={jumpSections} />

              <section id="workflow-inspector-scope" className="scroll-mt-24 space-y-4">
                <div className="grid gap-1">
                  <div className="text-sm font-medium text-foreground">Board posture</div>
                  <p className="text-sm leading-6 text-muted">
                    Confirm the live board state first so the inspector packets below answer a
                    specific operator question instead of becoming another raw telemetry dump.
                  </p>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <InspectorMetric label="Workflow" value={workflow.name} />
                  <InspectorMetric
                    label={stageLabel}
                    value={stageValue}
                    detail={
                      workflow.lifecycle === 'ongoing'
                        ? `${workflow.work_item_summary?.active_stage_count ?? 0} active stage${workflow.work_item_summary?.active_stage_count === 1 ? '' : 's'} in the current workflow scope`
                        : 'Current board stage in the scoped workflow shell'
                    }
                  />
                  <InspectorMetric
                    label="Open Work Items"
                    value={workflow.work_item_summary?.open_work_item_count ?? 0}
                    detail="Use open work as the top-level pressure check before drilling into step traces."
                  />
                </div>
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
                  <div className="rounded-xl border border-border/70 bg-border/10 p-4">
                    <div className="flex items-start gap-3">
                      <ClipboardList className="mt-0.5 h-4 w-4 text-muted-foreground" />
                      <div className="space-y-1 text-sm">
                        <p className="font-medium text-foreground">Current operator scope</p>
                        <p className="text-muted">
                          {workflow.project_name ? `${workflow.project_name} · ` : ''}
                          {scopeSummary}
                        </p>
                      </div>
                    </div>
                  </div>
                  <InspectorFocusCard
                    title={focusSummary.title}
                    detail={focusSummary.detail}
                    nextAction={focusSummary.nextAction}
                    actionLabel={focusSummary.actionLabel}
                    actionHref={focusSummary.actionHref}
                  />
                </div>
              </section>

              <section
                id="workflow-inspector-trace-coverage"
                className="scroll-mt-24 grid gap-4 rounded-xl border border-border/70 bg-background/70 p-4"
              >
                <div className="grid gap-1">
                  <div className="text-sm font-medium text-foreground">Trace coverage</div>
                  <p className="text-sm leading-6 text-muted">
                    Follow activations, work items, gate lanes, artifacts, memory handoff, and
                    scoped log drill-ins without leaving the workflow inspector shell.
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
                <div className="grid gap-3 xl:grid-cols-2">
                  {traceModel.links.map((link) => (
                    <InspectorLinkCard
                      key={link.label}
                      label={link.label}
                      href={link.href}
                      detail={link.detail}
                    />
                  ))}
                </div>
              </section>

              <section id="workflow-inspector-telemetry" className="scroll-mt-24 space-y-4">
                <div className="grid gap-1">
                  <div className="text-sm font-medium text-foreground">Workflow telemetry</div>
                  <p className="text-sm leading-6 text-muted">
                    Confirm which spend and memory lanes explain the current board posture before
                    opening a deeper execution slice.
                  </p>
                </div>
                <WorkflowInspectorTelemetryPanel
                  telemetry={telemetryModel}
                  isMemoryLoading={memoryHistoryQuery.isLoading}
                />
              </section>
            </>
          ) : (
            <div className="rounded-xl border border-border/70 bg-border/5 p-4 text-sm text-muted">
              Workflow context is unavailable right now. The scoped inspector is still available below.
            </div>
          )}
        </CardContent>
      </Card>

      <section id="workflow-inspector-log-trace" className="scroll-mt-24 space-y-4">
        <Card className="mx-6 border-border/70 bg-card/75 shadow-sm">
          <CardContent className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] lg:items-start">
            <div className="grid gap-1">
              <div className="text-sm font-medium text-foreground">Scoped log trace</div>
              <p className="text-sm leading-6 text-muted">
                Raw logs stay in the same inspector route so you can move from board-level packets
                into delivery traces, debug detail, and export without losing workflow context.
              </p>
            </div>
            <div className="rounded-xl border border-border/70 bg-background/80 p-4">
              <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
                Trace drill-in posture
              </div>
              <p className="mt-2 text-sm leading-6 text-foreground">
                Start with the raw stream, then open delivery or trace detail only for the packet
                that actually explains the current board posture.
              </p>
            </div>
          </CardContent>
        </Card>
        <LogsSurface scopedWorkflowId={workflowId} mode="inspector" />
      </section>
    </div>
  );
}
