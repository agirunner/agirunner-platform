import { Loader2 } from 'lucide-react';

import { Card, CardContent } from '../../../components/ui/card.js';

export function LoadingCard(): JSX.Element {
  return (
    <Card>
      <CardContent className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted" />
      </CardContent>
    </Card>
  );
}

export function ErrorCard({ message }: { message: string }): JSX.Element {
  return (
    <Card>
      <CardContent className="py-4 text-sm text-red-600">{message}</CardContent>
    </Card>
  );
}

export function FieldRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-4">
      <span className="w-28 text-sm text-muted">{label}</span>
      <span className="break-all text-sm font-medium">{value}</span>
    </div>
  );
}

export function WorkspaceMetricCard(props: {
  label: string;
  value: string;
  detail: string;
}): JSX.Element {
  return (
    <div className="h-full rounded-xl border border-border/70 bg-background/70 p-3">
      <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">
        {props.label}
      </div>
      <div className="mt-1 text-sm font-semibold text-foreground">{props.value}</div>
      <p className="mt-1 text-sm leading-6 text-muted">{props.detail}</p>
    </div>
  );
}
