import type { LogEntry } from '../lib/api.js';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card.js';
import { Badge } from './ui/badge.js';
import { StructuredRecordView } from './structured-data.js';
import {
  describeExecutionHeadline,
  describeExecutionNextAction,
  describeExecutionOperationLabel,
  describeExecutionSummary,
  readExecutionSignals,
  shortId,
  summarizeLogContext,
} from './execution-inspector-support.js';

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
          Select an activity packet to inspect the recorded payload, failure detail, and diagnostic handles behind the operator summary.
        </CardContent>
      </Card>
    );
  }

  const context = summarizeLogContext(props.entry);
  const signals = readExecutionSignals(props.entry);
  const continuityFacts = readContinuityFacts(props.entry);

  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[1.2fr_1fr]">
      <section className="min-w-0 overflow-hidden rounded-3xl border border-border/70 bg-card shadow-sm">
        <Card className="border-0 bg-transparent shadow-none">
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center justify-between gap-3">
              <span className="min-w-0 break-words">{describeExecutionHeadline(props.entry)}</span>
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
              <InspectorMeta label="Recorded activity">
                {describeExecutionOperationLabel(props.entry.operation)}
              </InspectorMeta>
              {props.entry.resource_type || props.entry.resource_id ? (
                <InspectorMeta label="Resource">
                  {props.entry.resource_type ?? 'resource'} {shortId(props.entry.resource_id)}
                </InspectorMeta>
              ) : null}
              <InspectorMeta label="Diagnostic span">
                {shortId(props.entry.span_id)}
              </InspectorMeta>
            </div>

            <div className="space-y-2 rounded-2xl border border-border/70 bg-border/5 p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-muted">
                Operator packet
              </div>
              <div className="space-y-2">
                <p className="text-sm text-foreground">{describeExecutionSummary(props.entry)}</p>
                <p className="text-xs text-muted">{describeExecutionNextAction(props.entry)}</p>
                {signals.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {signals.map((signal) => (
                      <Badge key={signal} variant="outline">
                        {signal}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            {context.length > 0 ? (
              <div className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-wide text-muted">
                  Board context
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

            {continuityFacts.length > 0 ? (
              <div className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-wide text-muted">
                  Continuity facts
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {continuityFacts.map((fact) => (
                    <InspectorMeta key={fact.label} label={fact.label}>
                      {fact.value}
                    </InspectorMeta>
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
                <InspectorMeta label="Activity key">{props.entry.operation}</InspectorMeta>
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

      <section className="min-w-0 overflow-hidden rounded-3xl border border-border/70 bg-card shadow-sm">
        <Card className="border-0 bg-transparent shadow-none">
          <CardHeader>
            <CardTitle>Diagnostic payload</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
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

function readContinuityFacts(entry: LogEntry): Array<{ label: string; value: string }> {
  const payload = asRecord(entry.payload);
  const facts: Array<{ label: string; value: string }> = [];

  pushStringFact(facts, 'Effective context strategy', payload.context_strategy);
  pushStringFact(facts, 'Trigger', payload.trigger);
  pushNumberFact(facts, 'Tokens before', payload.tokens_before);
  pushNumberFact(facts, 'Tokens after', payload.tokens_after);
  pushNumberFact(facts, 'Tokens saved', payload.tokens_saved);
  pushNumberFact(facts, 'Memory writes', payload.memory_writes);
  pushNumberFact(facts, 'Continuity writes', payload.continuity_writes);
  pushNumberFact(facts, 'Checkpoint writes', payload.checkpoint_writes);
  pushStringFact(facts, 'Checkpoint ref', payload.checkpoint_ref);

  const memoryKeys = Array.isArray(payload.memory_keys_written)
    ? payload.memory_keys_written.filter((value): value is string => typeof value === 'string')
    : [];
  if (memoryKeys.length > 0) {
    facts.push({
      label: 'Recent memory writes',
      value: memoryKeys.join(', '),
    });
  }
  return facts.slice(0, 10);
}

function pushStringFact(
  facts: Array<{ label: string; value: string }>,
  label: string,
  value: unknown,
): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return;
  }
  facts.push({ label, value: value.trim() });
}

function pushNumberFact(
  facts: Array<{ label: string; value: string }>,
  label: string,
  value: unknown,
): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return;
  }
  facts.push({ label, value: String(value) });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
