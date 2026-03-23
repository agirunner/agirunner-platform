import { Activity, DollarSign, GitBranch, ShieldAlert } from 'lucide-react';

import { Card, CardContent } from '../../components/ui/card.js';
import {
  describeCollectionAttention,
  describeCollectionProgress,
  describeCollectionSpend,
  summarizeWorkflowCollection,
} from './workflow-list-support.js';

export function WorkflowSummaryCards(props: {
  summary: ReturnType<typeof summarizeWorkflowCollection>;
}): JSX.Element {
  const attentionBoards = props.summary.gated + props.summary.blocked;
  const cards = [
    {
      title: 'Boards in Scope',
      value: String(props.summary.total),
      detail: `${props.summary.active} active • ${props.summary.gated} gated • ${props.summary.blocked} blocked`,
      icon: GitBranch,
    },
    {
      title: 'Delivery Progress',
      value:
        props.summary.completedWorkItems > 0
          ? `${props.summary.completedWorkItems} complete`
          : 'No completions',
      detail: describeCollectionProgress(props.summary),
      icon: Activity,
    },
    {
      title: 'Attention Posture',
      value: attentionBoards > 0 ? `${attentionBoards} need review` : 'Stable',
      detail: describeCollectionAttention(props.summary),
      icon: ShieldAlert,
    },
    {
      title: 'Spend Coverage',
      value:
        props.summary.spentBoards > 0 ? `$${props.summary.reportedSpend.toFixed(2)}` : 'No spend',
      detail: describeCollectionSpend(props.summary),
      icon: DollarSign,
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.title} className="border-border/70 shadow-sm">
          <CardContent className="grid gap-3 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-muted">{card.title}</p>
              <card.icon className="h-4 w-4 text-muted" />
            </div>
            <p className="text-2xl font-semibold tracking-tight">{card.value}</p>
            <p className="text-xs leading-5 text-muted">{card.detail}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
