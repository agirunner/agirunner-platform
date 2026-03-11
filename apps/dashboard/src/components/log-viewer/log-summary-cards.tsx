import type { LogStatGroup } from '../../lib/api.js';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card.js';
import { Skeleton } from '../ui/skeleton.js';

interface LogSummaryCardsProps {
  groups: LogStatGroup[] | undefined;
  totals: { count: number; error_count: number; total_duration_ms: number } | undefined;
  isLoading: boolean;
  isScoped: boolean;
}

const fmt = new Intl.NumberFormat('en-US');

function formatTokens(raw: number): string {
  if (raw >= 1_000_000) return `${(raw / 1_000_000).toFixed(1)}M`;
  if (raw >= 1_000) return `${(raw / 1_000).toFixed(0)}K`;
  return fmt.format(raw);
}

function formatCost(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '0s';
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function findGroup(groups: LogStatGroup[] | undefined, name: string): LogStatGroup | undefined {
  return groups?.find((g) => g.group === name);
}

function aggNumber(agg: Record<string, unknown>, key: string): number {
  const val = agg[key];
  return typeof val === 'number' ? val : 0;
}

function StatValue({ isLoading, children }: { isLoading: boolean; children: React.ReactNode }) {
  if (isLoading) return <Skeleton className="h-6 w-16" />;
  return <span className="text-lg font-semibold">{children}</span>;
}

function StatSubtext({ isLoading, children }: { isLoading: boolean; children: React.ReactNode }) {
  if (isLoading) return <Skeleton className="mt-1 h-3 w-20" />;
  return <span className="text-xs text-muted">{children}</span>;
}

function SummaryCard({
  title,
  isLoading,
  value,
  subtext,
  valueClassName,
}: {
  title: string;
  isLoading: boolean;
  value: React.ReactNode;
  subtext?: React.ReactNode;
  valueClassName?: string;
}) {
  return (
    <Card className="flex-1 min-w-[140px]">
      <CardHeader className="p-3 pb-1">
        <CardTitle className="text-xs font-medium text-muted">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0 flex flex-col">
        <StatValue isLoading={isLoading}>
          <span className={valueClassName}>{value}</span>
        </StatValue>
        {subtext !== undefined && <StatSubtext isLoading={isLoading}>{subtext}</StatSubtext>}
      </CardContent>
    </Card>
  );
}

export function LogSummaryCards({
  groups,
  totals,
  isLoading,
  isScoped,
}: LogSummaryCardsProps): JSX.Element | null {
  if (!isScoped) return null;

  const llmGroup = findGroup(groups, 'llm');
  const toolGroup = findGroup(groups, 'tool');

  const inputTokens = llmGroup ? aggNumber(llmGroup.agg, 'total_input_tokens') : 0;
  const outputTokens = llmGroup ? aggNumber(llmGroup.agg, 'total_output_tokens') : 0;
  const totalCost = llmGroup ? aggNumber(llmGroup.agg, 'total_cost_usd') : 0;
  const toolFailed = toolGroup?.error_count ?? 0;
  const errorCount = totals?.error_count ?? 0;

  return (
    <div className="flex gap-4 flex-wrap">
      <SummaryCard
        title="LLM Calls"
        isLoading={isLoading}
        value={fmt.format(llmGroup?.count ?? 0)}
        subtext={`avg ${llmGroup ? formatDuration(llmGroup.avg_duration_ms) : '—'}`}
      />
      <SummaryCard
        title="Tool Runs"
        isLoading={isLoading}
        value={fmt.format(toolGroup?.count ?? 0)}
        subtext={toolFailed > 0 ? `${fmt.format(toolFailed)} failed` : 'none failed'}
      />
      <SummaryCard
        title="Tokens"
        isLoading={isLoading}
        value={`${formatTokens(inputTokens)}/${formatTokens(outputTokens)}`}
        subtext="input / output"
      />
      <SummaryCard
        title="Cost"
        isLoading={isLoading}
        value={formatCost(totalCost)}
      />
      <SummaryCard
        title="Errors"
        isLoading={isLoading}
        value={fmt.format(errorCount)}
        valueClassName={errorCount > 0 ? 'text-red-500' : undefined}
      />
    </div>
  );
}
