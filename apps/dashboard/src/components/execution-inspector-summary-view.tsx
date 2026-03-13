import { Activity, AlertTriangle, Clock3, DollarSign } from 'lucide-react';

import type {
  LogActorRecord,
  LogOperationRecord,
  LogRoleRecord,
  LogStatsResponse,
} from '../lib/api.js';
import { Badge } from './ui/badge.js';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card.js';
import {
  describeExecutionOperationLabel,
  formatCost,
  formatDuration,
  formatNumber,
  topGroups,
} from './execution-inspector-support.js';

interface ExecutionInspectorSummaryViewProps {
  stats?: LogStatsResponse;
  operations: LogOperationRecord[];
  roles: LogRoleRecord[];
  actors: LogActorRecord[];
  isLoading: boolean;
}

export function ExecutionInspectorSummaryView(
  props: ExecutionInspectorSummaryViewProps,
): JSX.Element {
  const totals = props.stats?.data.totals;
  const groups = props.stats?.data.groups ?? [];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Activity coverage"
          value={formatNumber(totals?.count ?? 0)}
          detail="captured records in the current slice"
          icon={<Activity className="h-4 w-4" />}
        />
        <MetricCard
          title="Review posture"
          value={formatNumber(totals?.error_count ?? 0)}
          detail="records that may need operator review"
          icon={<AlertTriangle className="h-4 w-4" />}
        />
        <MetricCard
          title="Captured runtime"
          value={formatDuration(totals?.total_duration_ms ?? 0)}
          detail="reported time across the visible slice"
          icon={<Clock3 className="h-4 w-4" />}
        />
        <MetricCard
          title="Reported spend"
          value={formatCost(
            groups.reduce((sum, group) => sum + Number(group.agg.total_cost_usd ?? 0), 0),
          )}
          detail="visible telemetry with recorded cost"
          icon={<DollarSign className="h-4 w-4" />}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <TopListCard
          title="Activity families"
          description="Where the current slice is concentrating operator attention"
          items={topGroups(groups, 8).map((group) => ({
            label: describeActivityFamilyLabel(group.group),
            count: group.count,
            meta: `${formatDuration(group.avg_duration_ms)} avg • ${formatCost(group.agg.total_cost_usd)}`,
            badge: group.error_count > 0 ? `${group.error_count} errors` : undefined,
          }))}
          isLoading={props.isLoading}
        />
        <TopListCard
          title="Top activity paths"
          description="Execution paths showing up most often in this slice"
          items={topGroups(props.operations, 10).map((item) => ({
            label: describeExecutionOperationLabel(item.operation),
            count: item.count,
            meta: `Activity key · ${item.operation}`,
          }))}
          isLoading={props.isLoading}
        />
        <TopListCard
          title="Role lanes"
          description="Roles driving visible activity in this slice"
          items={topGroups(props.roles, 8).map((item) => ({
            label: item.role,
            count: item.count,
          }))}
          isLoading={props.isLoading}
        />
        <TopListCard
          title="Workers and operators"
          description="Actors contributing activity in the current slice"
          items={topGroups(props.actors, 8).map((item) => ({
            label: item.actor_name || `${item.actor_type}:${item.actor_id}`,
            count: item.count,
            meta: `Actor key · ${item.actor_type}:${item.actor_id}`,
          }))}
          isLoading={props.isLoading}
        />
      </div>
    </div>
  );
}

function describeActivityFamilyLabel(value: string): string {
  switch (value) {
    case 'agent_loop':
      return 'Agent loop';
    case 'task_lifecycle':
      return 'Task lifecycle';
    case 'llm':
      return 'LLM';
    case 'container':
      return 'Container runtime';
    default:
      return value
        .split('_')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
  }
}

function MetricCard(props: {
  title: string;
  value: string;
  detail: string;
  icon: JSX.Element;
}): JSX.Element {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted">
          {props.icon}
          {props.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <div className="text-2xl font-semibold">{props.value}</div>
        <p className="text-sm text-muted">{props.detail}</p>
      </CardContent>
    </Card>
  );
}

function TopListCard(props: {
  title: string;
  description: string;
  items: Array<{ label: string; count: number; meta?: string; badge?: string }>;
  isLoading: boolean;
}): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
        <p className="text-sm text-muted">{props.description}</p>
      </CardHeader>
      <CardContent>
        {props.isLoading ? <p className="text-sm text-muted">Loading…</p> : null}
        {!props.isLoading && props.items.length === 0 ? (
          <p className="text-sm text-muted">No data for the current filter set.</p>
        ) : null}
        <div className="space-y-3">
          {props.items.map((item) => (
            <div key={`${item.label}:${item.count}`} className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <div className="font-medium">{item.label}</div>
                {item.meta ? <div className="text-xs text-muted">{item.meta}</div> : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {item.badge ? <Badge variant="warning">{item.badge}</Badge> : null}
                <Badge variant="secondary">{formatNumber(item.count)}</Badge>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
