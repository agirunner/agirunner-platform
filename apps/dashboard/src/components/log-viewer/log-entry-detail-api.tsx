import { Fragment } from 'react';
import { Badge } from '../ui/badge.js';

function field(payload: Record<string, unknown>, key: string): string {
  const val = payload[key];
  if (val === undefined || val === null) return '\u2014';
  return String(val);
}

function statusVariant(code: unknown): 'success' | 'warning' | 'destructive' | 'secondary' {
  const num = Number(code);
  if (Number.isNaN(num)) return 'secondary';
  if (num < 300) return 'success';
  if (num < 400) return 'warning';
  return 'destructive';
}

const META_FIELDS: readonly { label: string; key: string }[] = [
  { label: 'Method', key: 'method' },
  { label: 'Path', key: 'path' },
  { label: 'Latency', key: 'latency_ms' },
  { label: 'Actor', key: 'actor' },
  { label: 'Request ID', key: 'request_id' },
];

export function LogEntryDetailApi({ payload }: { payload: Record<string, unknown> }): JSX.Element {
  return (
    <div className="rounded-md border border-border p-4">
      <div className="mb-3 flex items-center gap-2">
        <h4 className="text-sm font-semibold">API Request</h4>
        {payload.status_code != null && (
          <Badge variant={statusVariant(payload.status_code)}>
            {String(payload.status_code)}
          </Badge>
        )}
      </div>

      <div className="grid max-w-lg grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {META_FIELDS.map(({ label, key }) => (
          <Fragment key={key}>
            <div className="text-muted">{label}</div>
            <div className="font-mono text-xs">{field(payload, key)}</div>
          </Fragment>
        ))}
      </div>
    </div>
  );
}
