import { ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Button } from '../../components/ui/button.js';
import { Card, CardContent } from '../../components/ui/card.js';

export function InspectorMetric(props: {
  label: string;
  value: string | number;
  detail?: string;
}): JSX.Element {
  return (
    <div className="rounded-xl border border-border/70 bg-background/70 p-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted">
        {props.label}
      </p>
      <p className="mt-1 text-lg font-semibold text-foreground">{props.value}</p>
      {props.detail ? <p className="mt-2 text-sm leading-6 text-muted">{props.detail}</p> : null}
    </div>
  );
}

export function TraceCoverageNote(props: {
  title: string;
  value: string;
}): JSX.Element {
  return (
    <div className="rounded-xl border border-border/70 bg-border/5 p-4">
      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
        {props.title}
      </div>
      <p className="mt-2 text-sm leading-6 text-foreground">{props.value}</p>
    </div>
  );
}

export function InspectorFocusCard(props: {
  title: string;
  detail: string;
  nextAction: string;
  actionLabel: string;
  actionHref: string;
}): JSX.Element {
  return (
    <Card className="border-border/70 bg-background/70 shadow-none">
      <CardContent className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <div className="space-y-2">
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
            Operator focus
          </div>
          <div className="text-base font-semibold text-foreground">{props.title}</div>
          <p className="text-sm leading-6 text-muted">{props.detail}</p>
          <div className="rounded-xl border border-border/70 bg-card/80 p-3 text-sm leading-6 text-muted">
            <span className="font-medium text-foreground">Best next step:</span> {props.nextAction}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 xl:justify-end">
          <Button asChild variant="outline" className="justify-between">
            <Link to={props.actionHref}>
              {props.actionLabel}
              <ExternalLink className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
