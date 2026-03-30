import { StructuredRecordView } from '../../components/structured-data/structured-data.js';
import { readCanonicalFinalDeliverables } from './task-detail-support.js';

export function OutputSection({ output }: { output: unknown }): JSX.Element {
  if (output === undefined || output === null) {
    return <p className="text-sm text-muted">No output available.</p>;
  }

  const canonicalFinalDeliverables = readCanonicalFinalDeliverables(output);

  return (
    <div className="space-y-4">
      {canonicalFinalDeliverables ? (
        <section className="rounded-xl border border-border/70 bg-surface p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">
            Canonical final deliverables
          </p>
          {canonicalFinalDeliverables.summary ? (
            <p className="mt-2 text-sm leading-6 text-muted">
              {canonicalFinalDeliverables.summary}
            </p>
          ) : null}
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-foreground">
            {canonicalFinalDeliverables.deliverables.map((deliverable) => (
              <li key={deliverable}>{deliverable}</li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="rounded-xl bg-border/10 p-4">{renderOutputPreview(output)}</div>
      <details className="rounded-xl border border-border/70 bg-surface p-4">
        <summary className="cursor-pointer text-sm font-medium">Raw payload</summary>
        <pre className="mt-3 overflow-x-auto rounded-md bg-border/10 p-4 text-xs">
          <code>{typeof output === 'string' ? output : JSON.stringify(output, null, 2)}</code>
        </pre>
      </details>
    </div>
  );
}

function renderOutputPreview(output: unknown): JSX.Element {
  if (typeof output === 'string') {
    return <p className="whitespace-pre-wrap text-sm leading-6">{output}</p>;
  }
  if (typeof output === 'number' || typeof output === 'boolean') {
    return <p className="text-sm font-medium">{String(output)}</p>;
  }
  if (Array.isArray(output)) {
    if (output.length === 0) {
      return <p className="text-sm text-muted">Output array is empty.</p>;
    }
    const primitiveItems = output.every(
      (item) => item === null || ['string', 'number', 'boolean'].includes(typeof item),
    );
    if (primitiveItems) {
      return (
        <ul className="list-disc space-y-2 pl-5 text-sm">
          {output.map((item, index) => (
            <li key={`${String(item)}-${index}`}>{String(item)}</li>
          ))}
        </ul>
      );
    }
    return (
      <div className="space-y-3">
        {output.map((item, index) => (
          <div key={index} className="rounded-lg bg-surface p-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
              Item {index + 1}
            </p>
            <StructuredRecordView data={item} emptyMessage="No output payload." />
          </div>
        ))}
      </div>
    );
  }
  return <StructuredRecordView data={output} emptyMessage="No structured output available." />;
}
