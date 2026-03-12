import type { LogEntry } from '../lib/api.js';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card.js';
import { Badge } from './ui/badge.js';
import { StructuredRecordView } from './structured-data.js';
import { shortId, summarizeLogContext } from './execution-inspector-support.js';

interface ExecutionInspectorDebugViewProps {
  entry: LogEntry | null;
}

export function ExecutionInspectorDebugView(
  props: ExecutionInspectorDebugViewProps,
): JSX.Element {
  if (!props.entry) {
    return (
      <Card>
        <CardContent className="p-5 text-sm text-muted">
          Select an execution entry to inspect the recorded payload, failure detail, and diagnostic handles behind the operator summary.
        </CardContent>
      </Card>
    );
  }

  const context = summarizeLogContext(props.entry);

  return (
    <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
      <section className="rounded-3xl border border-border/70 bg-card shadow-sm">
        <Card className="border-0 bg-transparent shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-3">
              <span>{props.entry.operation}</span>
              <Badge variant="secondary">{props.entry.status}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <InspectorMeta label="Recorded">
                {new Date(props.entry.created_at).toLocaleString()}
              </InspectorMeta>
              <InspectorMeta label="Origin">
                {props.entry.source} / {props.entry.category}
              </InspectorMeta>
              {props.entry.resource_type || props.entry.resource_id ? (
                <InspectorMeta label="Resource">
                  {props.entry.resource_type ?? 'resource'} {shortId(props.entry.resource_id)}
                </InspectorMeta>
              ) : null}
              <InspectorMeta label="Activity span">
                {shortId(props.entry.span_id)}
              </InspectorMeta>
            </div>

            {context.length > 0 ? (
              <div className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-wide text-muted">
                  Execution context
                </div>
                <div className="flex flex-wrap gap-2">
                  {context.map((item) => (
                    <Badge key={item} variant="outline">
                      {item}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-wide text-muted">
                Diagnostic handles
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <InspectorMeta label="Trace handle">{props.entry.trace_id}</InspectorMeta>
                <InspectorMeta label="Span handle">{props.entry.span_id}</InspectorMeta>
                {props.entry.parent_span_id ? (
                  <InspectorMeta label="Parent span handle">
                    {props.entry.parent_span_id}
                  </InspectorMeta>
                ) : null}
              </div>
            </div>

            {props.entry.error ? (
              <div className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-wide text-muted">
                  Error
                </div>
                <StructuredRecordView
                  data={props.entry.error}
                  emptyMessage="No error detail recorded."
                />
              </div>
            ) : null}
          </CardContent>
        </Card>
      </section>

      <section className="rounded-3xl border border-border/70 bg-card shadow-sm">
        <Card className="border-0 bg-transparent shadow-none">
          <CardHeader>
            <CardTitle>Recorded detail</CardTitle>
          </CardHeader>
          <CardContent>
            <StructuredRecordView
              data={props.entry.payload ?? {}}
              emptyMessage="No structured detail was recorded for this execution entry."
            />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function InspectorMeta(props: {
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="rounded-md border bg-border/10 p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">
        {props.label}
      </div>
      <div className="mt-1 break-all text-sm">{props.children}</div>
    </div>
  );
}
