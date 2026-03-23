import { ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';

import { DiffViewer } from '../../components/diff-viewer/diff-viewer.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent } from '../../components/ui/card.js';
import { Skeleton } from '../../components/ui/skeleton.js';
import type { WorkflowInspectorTelemetryModel } from './workflow-inspector-telemetry.js';

interface WorkflowInspectorTelemetryPanelProps {
  telemetry: WorkflowInspectorTelemetryModel;
  isMemoryLoading: boolean;
}

export function WorkflowInspectorTelemetryPanel(
  props: WorkflowInspectorTelemetryPanelProps,
): JSX.Element {
  const focusPacket = buildTelemetryFocusPacket(props.telemetry, props.isMemoryLoading);

  return (
    <>
      <Card className="border-border/70 bg-card/70 shadow-none">
        <CardContent className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="grid gap-1">
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
              Operator focus
            </div>
            <div className="text-lg font-semibold text-foreground">{focusPacket.value}</div>
            <p className="text-sm leading-6 text-muted">{focusPacket.detail}</p>
          </div>
          {focusPacket.href ? (
            <Button asChild className="w-full justify-between lg:w-auto">
              <Link to={focusPacket.href}>
                {focusPacket.actionLabel}
                <ExternalLink className="h-4 w-4" />
              </Link>
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <section className="grid gap-3">
        <SectionHeading
          title="Execution summary"
          description="Confirm what each inspector lane currently explains before drilling into a specific spend hotspot or trace chain."
        />
        <div className="grid gap-3 xl:grid-cols-2">
          {props.telemetry.executionSummaryPackets.map((packet) => (
            <Card key={packet.label} className="border-border/70 bg-card/70 shadow-none">
              <CardContent className="grid gap-3 p-4">
                <div className="grid gap-1">
                  <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
                    {packet.label}
                  </div>
                  <div className="text-lg font-semibold text-foreground">{packet.value}</div>
                  <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted">
                    {packet.sourceLabel}
                  </div>
                </div>
                <p className="text-sm leading-6 text-muted">{packet.detail}</p>
                {packet.href ? (
                  <Button asChild variant="outline" className="justify-between">
                    <Link to={packet.href}>
                      Open execution slice
                      <ExternalLink className="h-4 w-4" />
                    </Link>
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
      <section className="grid gap-3">
        <SectionHeading
          title="Spend posture"
          description="Compare the current highest-cost slices first, then step into detailed spend traces if something looks off."
        />
        <div className="grid gap-3 xl:grid-cols-3">
        {props.telemetry.spendPackets.map((packet) => (
          <Card key={packet.label} className="border-border/70 bg-card/70 shadow-none">
            <CardContent className="grid gap-3 p-4">
              <div className="grid gap-1">
                <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
                  {packet.label}
                </div>
                <div className="text-lg font-semibold text-foreground">{packet.value}</div>
              </div>
              <p className="text-sm leading-6 text-muted">{packet.detail}</p>
              {packet.href ? (
                <Button asChild variant="outline" className="justify-between">
                  <Link to={packet.href}>
                    Open spend slice
                    <ExternalLink className="h-4 w-4" />
                  </Link>
                </Button>
              ) : null}
            </CardContent>
          </Card>
        ))}
        </div>
      </section>
      <section className="grid gap-3">
        <SectionHeading
          title="Telemetry breakdowns"
          description="Use the richest slice in each lane to understand which stage, step, activation, or work item needs follow-up."
        />
        <div className="grid gap-3 xl:grid-cols-2">
        {props.telemetry.spendBreakdowns.map((section) => (
          <Card key={section.title} className="border-border/70 bg-card/70 shadow-none">
            <CardContent className="grid gap-4 p-4">
              <div className="grid gap-1">
                <div className="text-sm font-medium text-foreground">{section.title}</div>
                <p className="text-sm leading-6 text-muted">{section.description}</p>
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted">
                  {section.coverageLabel}
                </div>
                <p className="text-xs leading-5 text-muted">{section.coverageDetail}</p>
              </div>
              {section.entries.length > 0 ? (
                <div className="grid gap-3">
                  {section.entries.map((entry) => (
                    <div
                      key={`${section.title}:${entry.label}`}
                      className="rounded-xl border border-border/70 bg-background/80 p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-foreground">{entry.label}</div>
                          <p className="mt-1 text-xs leading-5 text-muted">{entry.detail}</p>
                        </div>
                        <div className="shrink-0 text-sm font-semibold text-foreground">
                          {entry.value}
                        </div>
                      </div>
                      {entry.href ? (
                        <Button asChild variant="ghost" className="mt-2 h-auto justify-start px-0 text-sm">
                          <Link to={entry.href}>
                            Open breakdown slice
                            <ExternalLink className="h-4 w-4" />
                          </Link>
                        </Button>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-border/70 bg-background/70 p-4 text-sm text-muted">
                  No deeper breakdown is available in this slice yet. Use the spend posture packet
                  above if you need the top trace to inspect first.
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        </div>
      </section>
      <Card className="border-border/70 bg-card/70 shadow-none">
        <CardContent className="grid gap-4 p-4">
          <div className="grid gap-1">
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
              Memory evolution review
            </div>
            <div className="text-sm font-medium text-foreground">
              {props.telemetry.memoryPacket.title}
            </div>
            <p className="text-sm leading-6 text-muted">
              {props.telemetry.memoryPacket.detail}
            </p>
          </div>
          {props.isMemoryLoading ? (
            <div className="grid gap-3 md:grid-cols-2">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : props.telemetry.memoryPacket.changes.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2">
              {props.telemetry.memoryPacket.changes.map((change) => (
                <div
                  key={`${change.key}:${change.occurredAtTitle}`}
                  className="rounded-xl border border-border/70 bg-background/80 p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-medium text-foreground">{change.key}</div>
                    <Badge variant="outline">{change.status}</Badge>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-foreground">{change.summary}</p>
                  <p className="mt-2 text-xs leading-5 text-muted">{change.detail}</p>
                  {change.changedFields.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {change.changedFields.map((field) => (
                        <Badge key={field} variant="secondary">
                          {field}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                  <p
                    className="mt-3 text-xs font-medium text-muted"
                    title={change.occurredAtTitle}
                  >
                    {change.occurredAtLabel}
                  </p>
                  {change.canRenderDiff ? (
                    <details className="mt-3 rounded-xl border border-border/70 bg-card/60 p-3">
                      <summary className="cursor-pointer text-sm font-medium text-foreground">
                        Open field diff
                      </summary>
                      <div className="mt-3">
                        <DiffViewer
                          oldLabel={change.status === 'Created' ? 'No previous value' : 'Previous value'}
                          newLabel={change.status === 'Deleted' ? 'Deleted value' : 'Current value'}
                          oldText={change.previousText}
                          newText={change.currentText}
                        />
                      </div>
                    </details>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border/70 bg-background/70 p-4 text-sm text-muted">
              {props.telemetry.memoryPacket.emptyMessage}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function buildTelemetryFocusPacket(
  telemetry: WorkflowInspectorTelemetryModel,
  isMemoryLoading: boolean,
): {
  value: string;
  detail: string;
  href: string | null;
  actionLabel: string;
} {
  if (isMemoryLoading) {
    return {
      value: 'Memory telemetry is still loading',
      detail: 'Wait for the memory packet to finish loading before deciding whether recent handoff changes need follow-up.',
      href: null,
      actionLabel: 'Open slice',
    };
  }

  const latestMemoryChange = telemetry.memoryPacket.changes[0];
  if (latestMemoryChange) {
    return {
      value: `${latestMemoryChange.status} · ${latestMemoryChange.key}`,
      detail: `${latestMemoryChange.summary} ${latestMemoryChange.detail}`,
      href: null,
      actionLabel: 'Open slice',
    };
  }

  const primarySpendPacket = telemetry.spendPackets.find((packet) => packet.href);
  if (primarySpendPacket) {
    return {
      value: primarySpendPacket.label,
      detail: primarySpendPacket.detail,
      href: primarySpendPacket.href,
      actionLabel: 'Open highest-impact slice',
    };
  }

  return {
    value: 'No active hotspot',
    detail: 'No spend or memory hotspot needs operator follow-up right now.',
    href: null,
    actionLabel: 'Open slice',
  };
}

function SectionHeading(props: {
  title: string;
  description: string;
}): JSX.Element {
  return (
    <div className="grid gap-1">
      <div className="text-sm font-medium text-foreground">{props.title}</div>
      <p className="text-sm leading-6 text-muted">{props.description}</p>
    </div>
  );
}
