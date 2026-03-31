import { Loader2, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';

export function RuntimePacket(props: {
  label: string;
  value: string;
  mono?: boolean;
  accent?: 'neutral' | 'destructive';
  children?: ReactNode;
}): JSX.Element {
  return (
    <div
      className={`rounded-xl border p-4 ${
        props.accent === 'destructive'
          ? 'border-rose-300/70 bg-rose-500/5'
          : 'border-border/70 bg-muted/10'
      }`}
    >
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
        {props.label}
      </p>
      <p className={`mt-2 text-sm leading-6 ${props.mono ? 'font-mono text-xs' : 'font-medium'}`}>
        {props.value}
      </p>
      {props.children ? (
        <div className="mt-2 text-xs leading-5 text-muted">{props.children}</div>
      ) : null}
    </div>
  );
}

export function RuntimeBriefCard(props: {
  brief: {
    tone: 'linked' | 'valid' | 'failed';
    headline: string;
    detail: string;
    steps: string[];
  };
}): JSX.Element {
  const toneClasses =
    props.brief.tone === 'failed'
      ? 'border-rose-300/70 bg-rose-500/5'
      : props.brief.tone === 'valid'
        ? 'border-amber-300/70 bg-amber-500/5'
        : 'border-emerald-300/70 bg-emerald-500/5';

  return (
    <div className={`rounded-xl border p-4 ${toneClasses}`}>
      <div className="space-y-1">
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
          Operator recovery brief
        </p>
        <p className="text-sm font-medium text-foreground">{props.brief.headline}</p>
        <p className="text-xs leading-5 text-muted">{props.brief.detail}</p>
      </div>
      <ol className="mt-3 grid gap-2 text-sm text-foreground">
        {props.brief.steps.map((step, index) => (
          <li key={step} className="flex items-start gap-2">
            <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-current/20 text-[11px] font-semibold">
              {index + 1}
            </span>
            <span className="leading-6">{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function RuntimeLoadingCard(props: { title: string }): JSX.Element {
  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base">{props.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex items-center justify-center p-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted" />
      </CardContent>
    </Card>
  );
}

export function RuntimeUnavailableCard(props: { title: string; body: string }): JSX.Element {
  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base">{props.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted">{props.body}</p>
      </CardContent>
    </Card>
  );
}

export function RuntimeActionResult(props: {
  tone: 'linked' | 'valid' | 'failed';
  headline: string;
  children?: ReactNode;
}): JSX.Element {
  const toneClasses =
    props.tone === 'failed'
      ? 'border-rose-300/70 bg-rose-500/5'
      : props.tone === 'linked'
        ? 'border-emerald-300/70 bg-emerald-500/5'
        : 'border-amber-300/70 bg-amber-500/5';

  return (
    <div className={`rounded-xl border p-4 ${toneClasses}`}>
      <p className="text-sm font-medium">{props.headline}</p>
      {props.children}
    </div>
  );
}

export function ActionIcon(props: {
  isPending: boolean;
  PendingIcon: typeof Loader2;
  IdleIcon: LucideIcon;
}): JSX.Element {
  return props.isPending ? (
    <props.PendingIcon className="h-3 w-3 animate-spin" />
  ) : (
    <props.IdleIcon className="h-3 w-3" />
  );
}
