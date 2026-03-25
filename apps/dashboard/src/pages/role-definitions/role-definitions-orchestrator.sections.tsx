import type { ComponentType, ReactNode } from 'react';
import { AlertTriangle, ExternalLink, Settings2 } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import type {
  OrchestratorControlReadiness,
  OrchestratorControlSurface,
} from './role-definitions-orchestrator.support.js';

export function ReadinessBanner(props: {
  readiness: OrchestratorControlReadiness;
}): JSX.Element {
  return (
    <div
      className={
        props.readiness.isReady
          ? 'rounded-xl bg-emerald-500/10 p-4'
          : 'rounded-xl bg-amber-500/10 p-4'
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-foreground">{props.readiness.headline}</p>
        <Badge variant={props.readiness.isReady ? 'success' : 'warning'}>
          {props.readiness.isReady ? 'Ready' : `${props.readiness.issues.length} blockers`}
        </Badge>
      </div>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">{props.readiness.detail}</p>
      {props.readiness.issues.length > 0 ? (
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {props.readiness.issues.map((issue) => (
            <div key={issue.id} className="rounded-lg bg-background/80 p-3">
              <p className="text-sm font-medium text-foreground">{issue.title}</p>
              <p className="mt-1 text-sm leading-6 text-muted">{issue.detail}</p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function EditableControlPacket(props: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  status: string;
  value: string;
  detail: string;
  detailClassName?: string;
  facts?: Array<{
    label: string;
    value: string;
    mono?: boolean;
  }>;
  primaryLabel: string;
  secondaryHref?: string;
  secondaryLabel?: string;
  isLoading: boolean;
  onEdit: () => void;
}): JSX.Element {
  return (
    <div className="flex h-full flex-col gap-3 rounded-xl border border-border/70 bg-muted/10 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-base font-semibold text-foreground">{props.title}</p>
          <p className="text-xs text-muted">{props.status}</p>
        </div>
        <props.icon className="h-4 w-4 text-muted" />
      </div>
      {props.isLoading ? (
        <div className="flex-1 space-y-2">
          <div className="h-6 w-2/3 rounded bg-border/70" />
          <div className="h-4 w-full rounded bg-border/50" />
        </div>
      ) : (
        <div className="flex-1 space-y-3">
          <p className="text-base font-semibold leading-6 text-foreground">{props.value}</p>
          <p className={['text-sm leading-6 text-muted', props.detailClassName].filter(Boolean).join(' ')}>
            {props.detail}
          </p>
          {props.facts?.length ? (
            <div className="grid gap-2 border-t border-border/70 pt-3">
              {props.facts.map((fact) => (
                <p key={fact.label} className="text-sm text-muted">
                  <span className="font-medium text-foreground">{fact.label}:</span>{' '}
                  <span className={fact.mono ? 'font-mono text-xs text-foreground' : 'text-foreground'}>
                    {fact.value}
                  </span>
                </p>
              ))}
            </div>
          ) : null}
        </div>
      )}
      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        <Button size="sm" onClick={props.onEdit}>
          <Settings2 className="h-4 w-4" />
          {props.primaryLabel}
        </Button>
        {props.secondaryHref && props.secondaryLabel ? (
          <Button asChild variant="ghost" size="sm">
            <Link to={props.secondaryHref}>
              <ExternalLink className="h-4 w-4" />
              {props.secondaryLabel}
            </Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function AdvancedSurfaceCard(props: {
  surface: OrchestratorControlSurface;
}): JSX.Element {
  return (
    <div className="grid gap-3 rounded-xl border border-border/70 bg-muted/10 p-4">
      <div className="space-y-1">
        <p className="text-base font-semibold text-foreground">{props.surface.title}</p>
        <p className="text-sm font-semibold text-foreground">{props.surface.summary}</p>
        <p className="text-sm leading-6 text-muted">{props.surface.detail}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link to={props.surface.href}>
            <ExternalLink className="h-4 w-4" />
            {props.surface.label}
          </Link>
        </Button>
        {props.surface.secondaryHref && props.surface.secondaryLabel ? (
          <Button asChild variant="ghost" size="sm">
            <Link to={props.surface.secondaryHref}>
              <ExternalLink className="h-4 w-4" />
              {props.surface.secondaryLabel}
            </Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function InlineWarning(props: {
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <p>{props.children}</p>
    </div>
  );
}
