import type { ReactNode } from 'react';
import { History, Users } from 'lucide-react';

import { StructuredRecordView } from '../../components/structured-data.js';
import { Badge } from '../../components/ui/badge.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';

export function HistoryFilter(props: {
  label: string;
  value: string;
  onValueChange(value: string): void;
  placeholder: string;
  includeAllOption?: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <label className="grid gap-1">
      <span className="text-xs font-medium uppercase tracking-[0.18em] text-muted">
        {props.label}
      </span>
      <Select
        value={props.value || (props.includeAllOption ? '__all__' : undefined)}
        onValueChange={(value) =>
          props.onValueChange(props.includeAllOption && value === '__all__' ? '' : value)
        }
      >
        <SelectTrigger>
          <SelectValue placeholder={props.placeholder} />
        </SelectTrigger>
        <SelectContent>
          {props.includeAllOption ? <SelectItem value="__all__">{props.placeholder}</SelectItem> : null}
          {props.children}
        </SelectContent>
      </Select>
    </label>
  );
}

export function HistoryFocusPacket(props: {
  label: string;
  value: string;
  helper: string;
  icon: 'history' | 'users';
}): JSX.Element {
  const Icon = props.icon === 'users' ? Users : History;

  return (
    <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted">
        <Icon className="h-4 w-4" />
        {props.label}
      </div>
      <p className="mt-3 text-sm font-semibold">{props.value}</p>
      <p className="mt-1 text-xs leading-5 text-muted">{props.helper}</p>
    </div>
  );
}

export function PayloadCard(props: {
  title: string;
  value: unknown;
  helper: string;
}): JSX.Element {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
      <div>
        <p className="text-sm font-medium">{props.title}</p>
        <p className="text-xs text-muted">{props.helper}</p>
      </div>
      <div className="mt-3">
        {props.value === undefined ? (
          <p className="text-sm text-muted">No version available.</p>
        ) : (
          <StructuredRecordView
            data={props.value}
            emptyMessage="No value recorded."
          />
        )}
      </div>
    </div>
  );
}

export function EmptyHistoryState(props: {
  title: string;
  body: string;
}): JSX.Element {
  return (
    <div className="flex flex-col items-center py-12 text-center text-muted">
      <History className="mb-3 h-10 w-10" />
      <p className="font-medium">{props.title}</p>
      <p className="mt-1 max-w-md text-sm">{props.body}</p>
    </div>
  );
}

export function RevisionEventBadge(props: {
  eventType: string;
}): JSX.Element {
  return (
    <Badge variant={props.eventType === 'deleted' ? 'secondary' : 'outline'}>
      {props.eventType === 'deleted' ? 'Deleted' : 'Updated'}
    </Badge>
  );
}
