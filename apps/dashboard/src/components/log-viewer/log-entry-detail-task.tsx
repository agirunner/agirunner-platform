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
  { label: 'Task Title', key: 'task_title' },
  { label: 'Stage', key: 'stage_name' },
  { label: 'Action', key: 'action' },
  { label: 'Entity', key: 'entity_name' },
  { label: 'Role', key: 'role' },
  { label: 'Model', key: 'model' },
  { label: 'Image', key: 'image' },
  { label: 'Status', key: 'task_status' },
  { label: 'From State', key: 'from_state' },
  { label: 'To State', key: 'to_state' },
  { label: 'Reuse', key: 'reuse_decision' },
  { label: 'Task Count', key: 'task_count' },
  { label: 'Failed Tasks', key: 'failed_task_count' },
  { label: 'Workflow', key: 'workflow_name' },
  { label: 'Work Item ID', key: 'work_item_id', format: shortId },
  { label: 'Activation ID', key: 'activation_id', format: shortId },
  {
    label: 'Parameters',
    key: 'parameters',
    format: (v) => {
      if (typeof v === 'object' && v !== null && Object.keys(v).length === 0) return '';
      return JSON.stringify(v);
    },
  },
  { label: 'Method', key: 'method' },
  { label: 'Workflow ID', key: 'workflow_id', format: shortId },
  { label: 'Runtime ID', key: 'runtime_id', format: shortId },
  { label: 'Container ID', key: 'container_id', format: shortId },
];

export function LogEntryDetailTask({ payload }: { payload: Record<string, unknown> }): JSX.Element {
  const visible = FIELDS.filter(({ key }) => payload[key] != null && String(payload[key]) !== '');

  return (
    <div className="rounded-md border border-border p-4">
      <h4 className="mb-3 text-sm font-semibold">Task Lifecycle</h4>
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
