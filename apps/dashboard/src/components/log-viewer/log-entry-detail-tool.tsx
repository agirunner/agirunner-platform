import { useState, Fragment } from 'react';
import { Copy } from 'lucide-react';
import { Button } from '../ui/button.js';

function field(payload: Record<string, unknown>, key: string): string {
  const val = payload[key];
  if (val === undefined || val === null) return '\u2014';
  return String(val);
}

const META_FIELDS: readonly { label: string; key: string }[] = [
  { label: 'Stage', key: 'stage_name' },
  { label: 'Work Item ID', key: 'work_item_id' },
  { label: 'Activation ID', key: 'activation_id' },
  { label: 'Iteration', key: 'iteration' },
  { label: 'Step', key: 'step_index' },
  { label: 'Exit Code', key: 'exit_code' },
  { label: 'Error', key: 'error' },
  { label: 'Execution handle', key: 'container_id' },
];

function buildFullInvocation(payload: Record<string, unknown>): string | null {
  const name = payload.tool_name;
  if (typeof name !== 'string') return null;

  const input = payload.input;
  if (input == null || typeof input !== 'object') return `${name}()`;

  const inp = input as Record<string, unknown>;
  const parts: string[] = [];

  for (const [k, v] of Object.entries(inp)) {
    if (v == null) continue;
    if (typeof v === 'string') {
      parts.push(`${k}: "${v}"`);
    } else {
      parts.push(`${k}: ${JSON.stringify(v)}`);
    }
  }

  return parts.length > 0 ? `${name}(${parts.join(', ')})` : `${name}()`;
}

function resolveOutput(payload: Record<string, unknown>): string | null {
  const preview = payload.output_preview ?? payload.stdout_preview;
  if (preview == null) return null;
  return String(preview);
}

export function LogEntryDetailTool({ payload }: { payload: Record<string, unknown> }): JSX.Element {
  const [isCopied, setIsCopied] = useState(false);
  const invocation = buildFullInvocation(payload);
  const output = resolveOutput(payload);
  const stderrPreview =
    typeof payload.stderr_preview === 'string' && payload.stderr_preview.length > 0
      ? payload.stderr_preview
      : null;
  const isTimedOut = payload.timed_out === true;

  function handleCopyOutput(): void {
    if (!output) return;
    void navigator.clipboard.writeText(output).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 1500);
    });
  }

  return (
    <div className="rounded-md border border-border p-4">
      <div className="mb-3 flex items-center gap-2">
        <h4 className="text-sm font-semibold">Tool Execution</h4>
        {isTimedOut && (
          <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
            Timed Out
          </span>
        )}
      </div>

      {invocation && (
        <pre className="mb-3 overflow-x-auto whitespace-pre-wrap break-all rounded bg-card p-2.5 text-xs font-mono border border-border/50">
          {invocation}
        </pre>
      )}

      <div className="grid max-w-lg grid-cols-[auto_1fr] gap-x-6 gap-y-0 text-sm">
        {META_FIELDS.filter(({ key }) => payload[key] != null).map(({ label, key }) => (
          <Fragment key={key}>
            <div className="text-muted-foreground whitespace-nowrap py-0.5">{label}</div>
            <div className="font-mono text-xs py-0.5">{field(payload, key)}</div>
          </Fragment>
        ))}
      </div>

      {output !== null && (
        <div className="mt-3 space-y-1 text-sm">
          <div className="flex items-center justify-between">
            <h5 className="font-medium text-muted-foreground">Output</h5>
            <Button variant="ghost" size="sm" onClick={handleCopyOutput}>
              <Copy className="mr-1 h-3 w-3" />
              {isCopied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded bg-card p-2 text-xs">
            {output}
          </pre>
        </div>
      )}

      {stderrPreview !== null && (
        <div className="mt-3 space-y-1 text-sm">
          <h5 className="font-medium text-destructive">Stderr</h5>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-red-950/20 border border-red-900/30 p-2 text-xs text-red-300">
            {stderrPreview}
          </pre>
        </div>
      )}
    </div>
  );
}
