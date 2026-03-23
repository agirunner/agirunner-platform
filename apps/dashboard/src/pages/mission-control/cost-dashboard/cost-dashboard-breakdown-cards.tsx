import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card.js';
import type { CostSummaryRecord } from './cost-dashboard-page.support.js';
import { buildCostBreakdownSummary } from './cost-dashboard-page.support.js';

export function CostDashboardBreakdownCards(props: {
  summary: CostSummaryRecord;
}): JSX.Element {
  const breakdown = buildCostBreakdownSummary(props.summary);

  return (
    <section className="grid gap-4 lg:grid-cols-3">
      <BreakdownCard
        title="Board spend leaders"
        detail="Use this quick list when the chart is too dense or you need a phone-friendly scan."
        entries={breakdown.boardDrivers}
      />
      <BreakdownCard
        title="Model spend leaders"
        detail="Confirm whether the current model mix still matches the quality bar for active boards."
        entries={breakdown.modelDrivers}
      />
      <BreakdownCard
        title="Peak spend day"
        detail="Review the busiest daily spend point before you assume the current trend is safe."
        entries={
          breakdown.peakSpendDay
            ? [breakdown.peakSpendDay]
            : [
                {
                  label: 'No daily trend published yet',
                  value: '$0.00',
                  detail: 'This card will update after the next visible spend window.',
                },
              ]
        }
      />
    </section>
  );
}

function BreakdownCard(props: {
  title: string;
  detail: string;
  entries: Array<{
    label: string;
    value: string;
    detail: string;
  }>;
}): JSX.Element {
  return (
    <Card className="border-border/70 bg-card/80 shadow-none">
      <CardHeader className="space-y-1">
        <CardTitle className="text-base">{props.title}</CardTitle>
        <p className="text-sm leading-6 text-muted">{props.detail}</p>
      </CardHeader>
      <CardContent className="grid gap-3">
        {props.entries.map((entry) => (
          <div
            key={`${props.title}:${entry.label}`}
            className="rounded-xl border border-border/70 bg-background/70 p-3"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="grid gap-1">
                <p className="text-sm font-medium text-foreground">{entry.label}</p>
                <p className="text-sm leading-6 text-muted">{entry.detail}</p>
              </div>
              <div className="text-sm font-semibold text-foreground">{entry.value}</div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
