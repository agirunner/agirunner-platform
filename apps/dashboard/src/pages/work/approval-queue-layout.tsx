import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';

export function QueueInfoTile(props: {
  label: string;
  value: string;
  monospace?: boolean;
}): JSX.Element {
  return (
    <div className="rounded-md border border-border/70 bg-border/10 p-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted">
        {props.label}
      </div>
      <div className={props.monospace ? 'mt-1 font-mono text-sm' : 'mt-1 text-sm font-medium'}>
        {props.value}
      </div>
    </div>
  );
}

export function QueueMetricCard(props: {
  icon: JSX.Element;
  label: string;
  value: string | number;
  detail?: string;
}): JSX.Element {
  return (
    <article className="rounded-xl border border-border/70 bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted">
        {props.icon}
        {props.label}
      </div>
      <div className="mt-2 break-words text-2xl font-semibold">{props.value}</div>
      {props.detail ? <p className="mt-2 text-xs leading-5 text-muted">{props.detail}</p> : null}
    </article>
  );
}

export function QueueSectionHeader(props: {
  icon: JSX.Element;
  title: string;
  count: number;
  description: string;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          {props.icon}
          <h2 className="text-lg font-medium">{props.title}</h2>
          <Badge variant="secondary">{props.count}</Badge>
        </div>
        <p className="text-sm text-muted">{props.description}</p>
      </div>
    </div>
  );
}

export function ApprovalQueueSectionJumpStrip(props: {
  stageGateCount: number;
  taskApprovalCount: number;
  firstGateSummary: string;
  oldestWaiting: string;
}): JSX.Element {
  const sections = [
    {
      id: 'approval-stage-gates',
      label: 'Stage gate queue',
      count: props.stageGateCount,
      summary: props.firstGateSummary,
      detail: 'Jump straight to the oldest gate packets and operator follow-up context.',
      buttonLabel: 'Jump to stage gates',
    },
    {
      id: 'approval-step-approvals',
      label: 'Specialist step reviews',
      count: props.taskApprovalCount,
      summary:
        props.taskApprovalCount > 0
          ? `${props.taskApprovalCount} grouped work-item or direct step reviews waiting.`
          : 'No step approvals are waiting right now.',
      detail: 'Review specialist steps from grouped work-item context instead of hunting through the full queue.',
      buttonLabel: 'Jump to step approvals',
    },
  ];

  return (
    <nav aria-label="Approval queue sections" className="grid gap-3 lg:grid-cols-2">
      {sections.map((section) => (
        <article
          key={section.id}
          className="rounded-2xl border border-border/70 bg-background/70 p-4 shadow-sm"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted">
                {section.label}
              </div>
              <div className="text-base font-semibold">{section.count} waiting</div>
            </div>
            <Badge variant="outline">{section.id === 'approval-stage-gates' ? props.oldestWaiting : 'Work-item aware'}</Badge>
          </div>
          <div className="mt-3 rounded-xl border border-border/70 bg-muted/10 p-3 text-sm text-muted">
            {section.summary}
          </div>
          <p className="mt-3 text-sm text-muted">{section.detail}</p>
          {section.count > 0 ? (
            <Button asChild variant="outline" className="mt-4 w-full justify-between">
              <a href={`#${section.id}`}>{section.buttonLabel}</a>
            </Button>
          ) : (
            <div className="mt-4 rounded-xl border border-dashed border-border/70 px-4 py-3 text-sm text-muted">
              Nothing is waiting in this section right now.
            </div>
          )}
        </article>
      ))}
    </nav>
  );
}
