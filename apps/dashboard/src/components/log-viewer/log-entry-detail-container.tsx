import { Fragment } from 'react';

interface FieldDef {
  label: string;
  key: string;
  format?: (v: unknown) => string;
}

function shortId(v: unknown): string {
  const s = String(v);
  return s.length > 12 ? s.slice(0, 12) : s;
}

const FIELDS: readonly FieldDef[] = [
  { label: 'Action', key: 'action' },
  { label: 'Image', key: 'image' },
  { label: 'Playbook', key: 'playbook_name' },
  { label: 'Playbook ID', key: 'playbook_id', format: shortId },
  { label: 'Agent ID', key: 'runtime_id', format: shortId },
  { label: 'Container ID', key: 'container_id', format: shortId },
  { label: 'CPU', key: 'cpu' },
  { label: 'Memory', key: 'memory' },
  { label: 'Reason', key: 'reason' },
  { label: 'Policy', key: 'policy' },
  { label: 'Method', key: 'method' },
  { label: 'Desired', key: 'desired' },
  { label: 'Actual', key: 'actual' },
];

export function LogEntryDetailContainer({
  payload,
}: {
  payload: Record<string, unknown>;
}): JSX.Element {
  const visible = FIELDS.filter(({ key }) => payload[key] != null);

  return (
    <div className="rounded-md border border-border p-4">
      <h4 className="mb-3 text-sm font-semibold">Container / Agent</h4>
      <div className="grid max-w-lg grid-cols-[auto_1fr] gap-x-6 gap-y-0 text-sm">
        {visible.map(({ label, key, format }) => (
          <Fragment key={key}>
            <div className="text-muted-foreground whitespace-nowrap py-0.5">{label}</div>
            <div className="font-mono text-xs py-0.5">
              {format ? format(payload[key]) : String(payload[key])}
            </div>
          </Fragment>
        ))}
      </div>
    </div>
  );
}
