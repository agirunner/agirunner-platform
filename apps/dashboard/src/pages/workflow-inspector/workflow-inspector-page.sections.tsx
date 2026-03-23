import { ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Button } from '../../components/ui/button.js';
import { Card, CardContent } from '../../components/ui/card.js';
import { Badge } from '../../components/ui/badge.js';

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

export interface InspectorSectionJump {
  id: string;
  label: string;
  value: string;
  detail: string;
  buttonLabel: string;
}

export function InspectorSectionJumpStrip(props: {
  sections: InspectorSectionJump[];
}): JSX.Element {
  return (
    <nav aria-label="Workflow inspector sections" className="grid gap-3 xl:grid-cols-3">
      {props.sections.map((section) => (
        <article
          key={section.id}
          className="rounded-2xl border border-border/70 bg-background/70 p-4 shadow-sm"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
                {section.label}
              </div>
              <div className="text-base font-semibold text-foreground">{section.value}</div>
            </div>
            <Badge variant="outline">Jump</Badge>
          </div>
          <p className="mt-3 text-sm leading-6 text-muted">{section.detail}</p>
          <Button asChild variant="outline" className="mt-4 w-full justify-between">
            <a href={`#${section.id}`}>{section.buttonLabel}</a>
          </Button>
        </article>
      ))}
    </nav>
  );
}

export function InspectorLinkCard(props: {
  label: string;
  href: string;
  detail: string;
}): JSX.Element {
  return (
    <Card className="border-border/70 bg-card/70 shadow-none">
      <CardContent className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div className="space-y-1">
          <div className="text-sm font-medium text-foreground">{props.label}</div>
          <p className="text-sm leading-6 text-muted">{props.detail}</p>
        </div>
        <Button asChild variant="ghost" className="h-auto justify-start px-0 lg:justify-end">
          <Link to={props.href}>
            Open link
            <ExternalLink className="h-4 w-4" />
          </Link>
        </Button>
      </CardContent>
    </Card>
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
