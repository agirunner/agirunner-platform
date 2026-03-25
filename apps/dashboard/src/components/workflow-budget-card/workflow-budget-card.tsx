import { Link } from 'react-router-dom';

import type { DashboardWorkflowBudgetRecord } from '../../lib/api.js';
import { Badge } from '../ui/badge.js';
import { Button } from '../ui/button.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../ui/card.js';

interface WorkflowBudgetCardProps {
  workflowId: string;
  budget?: DashboardWorkflowBudgetRecord | null;
  isLoading: boolean;
  hasError: boolean;
  context: 'workflow-detail' | 'inspector';
}

export function WorkflowBudgetCard(props: WorkflowBudgetCardProps): JSX.Element {
  const status = readBudgetStatus(props.budget);
  const actionCopy =
    props.context === 'workflow-detail'
      ? 'Pause, resume, and cancel controls remain in the mission-control card beside this summary.'
      : 'Return to the board to intervene if this workflow needs to be paused, resumed, or cancelled.';

  return (
    <Card className="border-border/70 bg-card/80 shadow-sm">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>Workflow Budget</CardTitle>
            <CardDescription>
              Operator-facing guardrails for spend, specialist agent capacity, and orchestration volume.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={status.variant}>{status.label}</Badge>
            {props.budget?.warning_dimensions.length ? (
              <Badge variant="warning">
                Warning: {props.budget.warning_dimensions.map(humanizeDimension).join(', ')}
              </Badge>
            ) : null}
            {props.budget?.exceeded_dimensions.length ? (
              <Badge variant="destructive">
                Exceeded: {props.budget.exceeded_dimensions.map(humanizeDimension).join(', ')}
              </Badge>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {props.isLoading ? (
          <p className="rounded-xl border border-dashed border-border/70 bg-border/5 px-4 py-3 text-sm text-muted">
            Loading workflow budget...
          </p>
        ) : null}
        {props.hasError ? (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
            Failed to load workflow budget state.
          </p>
        ) : null}
        {!props.isLoading && !props.hasError && props.budget ? (
          <>
            <div className="grid gap-3 xl:grid-cols-3">
              <BudgetMetricTile
                label="Token budget"
                used={formatInteger(props.budget.tokens_used)}
                limit={formatOptionalInteger(props.budget.tokens_limit, 'No cap')}
                remaining={formatOptionalInteger(props.budget.tokens_remaining, 'Unbounded')}
                percent={readPercent(props.budget.tokens_used, props.budget.tokens_limit)}
              />
              <BudgetMetricTile
                label="Cost cap"
                used={formatCurrency(props.budget.cost_usd)}
                limit={formatOptionalCurrency(props.budget.cost_limit_usd, 'No cap')}
                remaining={formatOptionalCurrency(props.budget.cost_remaining_usd, 'Unbounded')}
                percent={readPercent(props.budget.cost_usd, props.budget.cost_limit_usd)}
              />
              <BudgetMetricTile
                label="Duration cap"
                used={formatMinutes(props.budget.elapsed_minutes)}
                limit={formatOptionalMinutes(props.budget.duration_limit_minutes, 'No cap')}
                remaining={formatOptionalMinutes(props.budget.time_remaining_minutes, 'Unbounded')}
                percent={readPercent(
                  props.budget.elapsed_minutes,
                  props.budget.duration_limit_minutes,
                )}
              />
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <CompactStat label="Task count" value={formatInteger(props.budget.task_count)} />
              <CompactStat
                label="Orchestrator activations"
                value={formatInteger(props.budget.orchestrator_activations)}
              />
            </div>

            <div className="rounded-xl border border-border/70 bg-surface/80 p-4 text-sm">
              <div className="font-medium text-foreground">Operator guidance</div>
              <p className="mt-2 text-muted">{actionCopy}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              {props.context === 'inspector' ? (
                <Button variant="outline" asChild>
                  <Link to={`/mission-control/workflows/${props.workflowId}`}>Back to board controls</Link>
                </Button>
              ) : (
                <Button variant="outline" asChild>
                  <Link to={`/mission-control/workflows/${props.workflowId}/inspector`}>
                    Inspect budget context
                  </Link>
                </Button>
              )}
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function BudgetMetricTile(props: {
  label: string;
  used: string;
  limit: string;
  remaining: string;
  percent: number | null;
}): JSX.Element {
  return (
    <div className="rounded-xl border border-border/70 bg-surface/80 p-4">
      <div className="text-sm font-medium text-foreground">{props.label}</div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted">Used</div>
          <div className="text-lg font-semibold text-foreground">{props.used}</div>
        </div>
        <Badge variant="outline">{props.limit}</Badge>
      </div>
      <div className="mt-3 h-2 rounded-full bg-border/60">
        <div
          className="h-2 rounded-full bg-accent transition-[width]"
          style={{ width: `${readProgressWidth(props.percent)}%` }}
        />
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted">
        <span>Remaining: {props.remaining}</span>
        <span>{props.percent === null ? 'No limit' : `${props.percent}% used`}</span>
      </div>
    </div>
  );
}

function CompactStat(props: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-xl border border-border/70 bg-border/10 px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-muted">{props.label}</div>
      <div className="mt-1 text-lg font-semibold text-foreground">{props.value}</div>
    </div>
  );
}

function readBudgetStatus(
  budget: DashboardWorkflowBudgetRecord | null | undefined,
): { label: string; variant: 'secondary' | 'warning' | 'destructive' } {
  if (!budget) {
    return { label: 'No budget data', variant: 'secondary' };
  }
  if (budget.exceeded_dimensions.length > 0) {
    return { label: 'Exceeded', variant: 'destructive' };
  }
  if (budget.warning_dimensions.length > 0) {
    return { label: 'Warning', variant: 'warning' };
  }
  if (
    budget.tokens_limit === null &&
    budget.cost_limit_usd === null &&
    budget.duration_limit_minutes === null
  ) {
    return { label: 'Unbounded', variant: 'secondary' };
  }
  return { label: 'Within budget', variant: 'secondary' };
}

function readPercent(used: number, limit: number | null): number | null {
  if (limit === null || limit <= 0) {
    return null;
  }
  return Math.min(100, Math.max(0, Math.round((used / limit) * 100)));
}

function readProgressWidth(percent: number | null): number {
  if (percent === null) {
    return 0;
  }
  if (percent === 0) {
    return 4;
  }
  return percent;
}

function humanizeDimension(value: string): string {
  if (value === 'cost') {
    return 'cost';
  }
  if (value === 'duration') {
    return 'duration';
  }
  return 'tokens';
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatOptionalInteger(value: number | null, fallback: string): string {
  return value === null ? fallback : formatInteger(value);
}

function formatCurrency(value: number): string {
  return `$${value.toFixed(4)}`;
}

function formatOptionalCurrency(value: number | null, fallback: string): string {
  return value === null ? fallback : formatCurrency(value);
}

function formatMinutes(value: number): string {
  return `${value.toFixed(2)} min`;
}

function formatOptionalMinutes(value: number | null, fallback: string): string {
  return value === null ? fallback : formatMinutes(value);
}
