import { Fragment } from 'react';
import { Badge } from '../ui/badge.js';

function field(payload: Record<string, unknown>, key: string): string {
  const val = payload[key];
  if (val === undefined || val === null) return '\u2014';
  return String(val);
}

const META_FIELDS: readonly { label: string; key: string }[] = [
  { label: 'Entity Type', key: 'entity_type' },
  { label: 'Entity Name', key: 'entity_name' },
  { label: 'Actor', key: 'actor' },
];

function actionVariant(action: unknown): 'default' | 'success' | 'destructive' | 'warning' {
  const str = String(action).toLowerCase();
  if (str === 'create') return 'success';
  if (str === 'delete') return 'destructive';
  if (str === 'update') return 'warning';
  return 'default';
}

interface Change {
  field: string;
  before: unknown;
  after: unknown;
}

function extractChanges(payload: Record<string, unknown>): Change[] {
  const raw = payload.changes;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (c): c is Change =>
      typeof c === 'object' && c !== null && 'field' in c,
  );
}

export function LogEntryDetailConfig({ payload }: { payload: Record<string, unknown> }): JSX.Element {
  const changes = extractChanges(payload);

  return (
    <div className="rounded-md border border-border p-4">
      <div className="mb-3 flex items-center gap-2">
        <h4 className="text-sm font-semibold">Config Change</h4>
        {payload.action != null && (
          <Badge variant={actionVariant(payload.action)}>
            {String(payload.action)}
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

      {changes.length > 0 && (
        <div className="mt-3 space-y-1">
          <h5 className="text-sm font-medium text-muted">Changes</h5>
          <div className="space-y-1 text-xs">
            {changes.map((change) => (
              <div key={change.field} className="flex items-baseline gap-2 font-mono">
                <span className="font-semibold">{change.field}:</span>
                <span className="text-red-400 line-through">
                  {change.before != null ? String(change.before) : '\u2014'}
                </span>
                <span className="text-muted">{'\u2192'}</span>
                <span className="text-green-400">
                  {change.after != null ? String(change.after) : '\u2014'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
