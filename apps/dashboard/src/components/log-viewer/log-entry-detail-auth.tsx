import { Fragment } from 'react';
import { Badge } from '../ui/badge.js';

function field(payload: Record<string, unknown>, key: string): string {
  const val = payload[key];
  if (val === undefined || val === null) return '\u2014';
  return String(val);
}

function resultVariant(result: unknown): 'success' | 'destructive' | 'secondary' {
  const str = String(result).toLowerCase();
  if (str === 'success') return 'success';
  if (str === 'failure' || str === 'denied') return 'destructive';
  return 'secondary';
}

const META_FIELDS: readonly { label: string; key: string }[] = [
  { label: 'Auth Type', key: 'auth_type' },
  { label: 'Method', key: 'method' },
  { label: 'Email', key: 'email' },
  { label: 'IP Address', key: 'ip' },
];

export function LogEntryDetailAuth({ payload }: { payload: Record<string, unknown> }): JSX.Element {
  return (
    <div className="rounded-md border border-border p-4">
      <div className="mb-3 flex items-center gap-2">
        <h4 className="text-sm font-semibold">Auth Event</h4>
        {payload.result != null && (
          <Badge variant={resultVariant(payload.result)}>
            {String(payload.result)}
          </Badge>
        )}
      </div>

      <div className="grid max-w-lg grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {META_FIELDS.map(({ label, key }) => (
          <Fragment key={key}>
            <div className="text-muted">{label}</div>
            <div>{field(payload, key)}</div>
          </Fragment>
        ))}
      </div>
    </div>
  );
}
