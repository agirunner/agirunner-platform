import { Fragment } from 'react';

function field(payload: Record<string, unknown>, key: string): string {
  const val = payload[key];
  if (val === undefined || val === null) return '\u2014';
  return String(val);
}

function formatCost(value: unknown): string {
  if (value === undefined || value === null) return '\u2014';
  const num = Number(value);
  if (Number.isNaN(num)) return '\u2014';
  return `$${num.toFixed(4)}`;
}

const FIELDS: readonly { label: string; key: string; render?: (v: unknown) => string }[] = [
  { label: 'Provider', key: 'provider' },
  { label: 'Model', key: 'model' },
  { label: 'Endpoint', key: 'endpoint' },
  { label: 'Streaming', key: 'streaming' },
  { label: 'Stage', key: 'stage_name' },
  { label: 'Work Item ID', key: 'work_item_id' },
  { label: 'Activation ID', key: 'activation_id' },
  { label: 'Iteration', key: 'iteration' },
  { label: 'Input Tokens', key: 'input_tokens' },
  { label: 'Output Tokens', key: 'output_tokens' },
  { label: 'Total Tokens', key: 'total_tokens' },
  { label: 'Cost', key: 'cost_usd', render: formatCost },
  { label: 'Stop Reason', key: 'stop_reason' },
  { label: 'Retries', key: 'retries' },
];

export function LogEntryDetailLlm({ payload }: { payload: Record<string, unknown> }): JSX.Element {
  return (
    <div className="rounded-md border border-border p-4">
      <h4 className="mb-3 text-sm font-semibold">LLM Request</h4>
      <div className="grid max-w-lg grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {FIELDS.map(({ label, key, render }) => (
          <Fragment key={key}>
            <div className="text-muted">{label}</div>
            <div>{render ? render(payload[key]) : field(payload, key)}</div>
          </Fragment>
        ))}
      </div>

      {(payload.prompt_summary != null || payload.response_summary != null) && (
        <div className="mt-3 space-y-2 text-sm">
          {payload.prompt_summary != null && (
            <div>
              <div className="text-muted mb-0.5">Prompt</div>
              <pre className="whitespace-pre-wrap break-words rounded bg-card p-2 text-xs">
                {String(payload.prompt_summary)}
              </pre>
            </div>
          )}
          {payload.response_summary != null && (
            <div>
              <div className="text-muted mb-0.5">Response</div>
              <pre className="whitespace-pre-wrap break-words rounded bg-card p-2 text-xs">
                {String(payload.response_summary)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
