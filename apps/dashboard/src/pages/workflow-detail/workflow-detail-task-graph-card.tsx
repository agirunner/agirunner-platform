import { Link } from 'react-router-dom';

import { Badge } from '../../components/ui/badge.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table.js';
import { buildTaskDetailHref } from '../work-shared/work-href-support.js';
import {
  describeTaskGraphPacket,
  type DashboardWorkflowTaskRow,
} from './workflow-detail-support.js';

export function TaskGraphCard(props: {
  tasks: DashboardWorkflowTaskRow[];
  stageGroups: Array<{ stageName: string; tasks: DashboardWorkflowTaskRow[] }>;
  isLoading: boolean;
  hasError: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Execution Steps</CardTitle>
        <CardDescription>
          Human-readable specialist steps grouped by board stage for faster operator scanning.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {props.isLoading ? (
          <p className="rounded-xl border border-dashed border-border/70 bg-border/5 px-4 py-3 text-sm text-muted">
            Loading tasks...
          </p>
        ) : null}
        {props.hasError ? (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
            Failed to load tasks.
          </p>
        ) : null}
        {props.stageGroups.map((group) => (
          <Card key={group.stageName} className="border-border/70 bg-border/10 shadow-none">
            <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
              <div className="grid gap-1">
                <CardTitle className="text-base">{group.stageName}</CardTitle>
                <CardDescription>Execution flow, ownership, and upstream dependencies for this stage.</CardDescription>
              </div>
              <Badge variant="secondary">{group.tasks.length} steps</Badge>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 lg:hidden">
                {group.tasks.map((task) => {
                  const packet = describeTaskGraphPacket(task, props.tasks);
                  return (
                    <article
                      key={task.id}
                      className="grid gap-3 rounded-xl border border-border/70 bg-background/80 p-4 shadow-sm"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="grid gap-1">
                          <Link to={buildTaskDetailHref(task.id)} className="font-medium text-foreground">
                            {task.title}
                          </Link>
                          <p className="text-sm text-muted">{packet.focus}</p>
                        </div>
                        <Badge variant={badgeVariantForState(task.state)} className="w-fit">
                          {task.state}
                        </Badge>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <TaskGraphMetric label="Upstream steps" value={packet.upstream} />
                        <TaskGraphMetric label="Execution focus" value={packet.timing} />
                      </div>
                    </article>
                  );
                })}
              </div>
              <div className="hidden overflow-x-auto lg:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Step</TableHead>
                      <TableHead>Focus</TableHead>
                      <TableHead>Upstream</TableHead>
                      <TableHead>Updated</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.tasks.map((task) => {
                      const packet = describeTaskGraphPacket(task, props.tasks);
                      return (
                        <TableRow key={task.id}>
                          <TableCell className="font-medium">
                            <div className="grid gap-1">
                              <Link to={buildTaskDetailHref(task.id)}>{task.title}</Link>
                              <Badge variant={badgeVariantForState(task.state)} className="w-fit">
                                {task.state}
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-muted">{packet.focus}</TableCell>
                          <TableCell className="text-sm text-muted">{packet.upstream}</TableCell>
                          <TableCell className="text-sm text-muted">{packet.timing}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        ))}
      </CardContent>
    </Card>
  );
}

function TaskGraphMetric(props: { label: string; value: string }): JSX.Element {
  return (
    <div className="grid gap-1 rounded-lg border border-border/70 bg-surface/70 p-3">
      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
        {props.label}
      </div>
      <div className="text-sm text-foreground">{props.value}</div>
    </div>
  );
}

function badgeVariantForState(
  state: string | null | undefined,
): 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' {
  switch (state) {
    case 'completed':
    case 'approved':
      return 'success';
    case 'failed':
    case 'rejected':
    case 'cancelled':
      return 'destructive';
    case 'blocked':
    case 'escalated':
    case 'awaiting_approval':
      return 'warning';
    case 'in_progress':
    case 'running':
    case 'processing':
      return 'default';
    default:
      return 'outline';
  }
}
