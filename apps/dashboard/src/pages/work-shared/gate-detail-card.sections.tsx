import { Link } from 'react-router-dom';
import { FileText } from 'lucide-react';

import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog.js';
import { Textarea } from '../../components/ui/textarea.js';
import type { DashboardGateDetailRecord } from './gate-api.js';
import { buildTaskDetailHref } from './work-href-support.js';

function readArtifactLabel(artifact: Record<string, unknown>, index: number): string {
  const label = artifact.label ?? artifact.path ?? artifact.name ?? artifact.id;
  if (typeof label === 'string' && label.trim().length > 0) {
    return label;
  }
  return `Artifact ${index + 1}`;
}

function readArtifactMeta(artifact: Record<string, unknown>): string[] {
  const details: string[] = [];
  if (typeof artifact.kind === 'string' && artifact.kind.trim().length > 0) {
    details.push(artifact.kind);
  }
  if (typeof artifact.stage_name === 'string' && artifact.stage_name.trim().length > 0) {
    details.push(`stage ${artifact.stage_name}`);
  }
  if (typeof artifact.task_role === 'string' && artifact.task_role.trim().length > 0) {
    details.push(artifact.task_role);
  }
  return details;
}

export function readDecisionLabel(action: string | null | undefined): string {
  if (!action) {
    return 'Pending decision';
  }
  return action.replaceAll('_', ' ');
}

export function computeWaitingTime(createdAt: string): string {
  const diffMs = Date.now() - new Date(createdAt).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ${minutes % 60}m`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export function GatePanel(props: {
  eyebrow: string;
  title: string;
  tone?: 'secondary' | 'warning' | 'destructive' | 'success';
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className={readGatePanelClassName(props.tone)}>
      <div className="space-y-1">
        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
          {props.eyebrow}
        </div>
        <h3 className="text-sm font-semibold text-foreground">{props.title}</h3>
      </div>
      <div className="space-y-3">{props.children}</div>
    </section>
  );
}

export function GateSignalCard(props: { label: string; value: string }): JSX.Element {
  return (
    <div className="grid gap-1 rounded-xl border border-border/70 bg-background/80 p-3 shadow-sm">
      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
        {props.label}
      </div>
      <div className="text-sm text-foreground">{props.value}</div>
    </div>
  );
}

export function GateArtifactsPanel(props: { gate: DashboardGateDetailRecord }): JSX.Element | null {
  if (props.gate.key_artifacts.length === 0) {
    return null;
  }

  return (
    <GatePanel eyebrow="Review evidence" title="Key artifacts">
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted">
        <FileText className="h-3.5 w-3.5" />
        Key artifacts
      </div>
      <div className="grid gap-2">
        {props.gate.key_artifacts.map((artifact, index) => {
          const label = readArtifactLabel(artifact, index);
          const taskId = typeof artifact.task_id === 'string' ? artifact.task_id : null;
          const details = readArtifactMeta(artifact);
          return (
            <div
              key={`${label}:${index}`}
              className="rounded-md border border-border/70 bg-background/80 p-3 text-xs"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  {taskId ? (
                    <Link className="font-medium text-accent hover:underline" to={buildTaskDetailHref(taskId)}>
                      {label}
                    </Link>
                  ) : (
                    <div className="font-medium text-foreground">{label}</div>
                  )}
                  {details.length > 0 ? <div className="text-muted">{details.join(' • ')}</div> : null}
                  {typeof artifact.description === 'string' && artifact.description.trim().length > 0 ? (
                    <div className="text-muted">{artifact.description}</div>
                  ) : null}
                </div>
                <Badge variant={taskId ? 'outline' : 'secondary'}>
                  {taskId ? 'Step' : 'Reference'}
                </Badge>
              </div>
            </div>
          );
        })}
      </div>
    </GatePanel>
  );
}

export function GateTimelinePanel(props: {
  timelineRows: Array<{ label: string; value: string }>;
}): JSX.Element {
  return (
    <GatePanel eyebrow="Timeline" title="Lifecycle trail">
      <div className="space-y-2 text-sm text-muted">
        {props.timelineRows.map((row) => (
          <div
            key={row.label}
            className="flex items-start justify-between gap-3 rounded-md bg-background/70 px-3 py-2"
          >
            <span className="font-medium text-foreground">{row.label}</span>
            <span className="text-right">{row.value}</span>
          </div>
        ))}
      </div>
    </GatePanel>
  );
}

export function GateRequestSourcePanel(props: {
  gate: DashboardGateDetailRecord;
  requestSourceSummary: string[];
}): JSX.Element {
  return (
    <GatePanel eyebrow="Request trace" title="Request source">
      <p className="text-sm leading-6 text-muted">
        Keep the decision on the gate or work-item flow first. Use step diagnostics only when you
        need the source execution evidence behind this decision packet.
      </p>
      {props.requestSourceSummary.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {props.requestSourceSummary.map((item) => (
            <Badge key={`request:${item}`} variant="outline">
              {item}
            </Badge>
          ))}
        </div>
      ) : (
        <p className="text-sm leading-6 text-muted">
          This gate already carries the relevant operator context.
        </p>
      )}
      {props.gate.requested_by_task ? (
        <div className="space-y-1 text-sm text-muted">
          {props.gate.requested_by_task.work_item_title ? (
            <div>Work item: {props.gate.requested_by_task.work_item_title}</div>
          ) : null}
          <div>
            Source step: {props.gate.requested_by_task.title ?? props.gate.requested_by_task.id}
            {props.gate.requested_by_task.role ? ` • ${props.gate.requested_by_task.role}` : ''}
          </div>
        </div>
      ) : null}
    </GatePanel>
  );
}

export function GateRequestChangesDialog(props: {
  isOpen: boolean;
  workflowLabel: string;
  stageName: string;
  feedback: string;
  isPending: boolean;
  isError: boolean;
  canSubmit: boolean;
  onOpenChange(open: boolean): void;
  onFeedbackChange(value: string): void;
  onSubmit(): void;
}): JSX.Element {
  return (
    <Dialog open={props.isOpen} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Request Gate Changes</DialogTitle>
          <DialogDescription>
            Provide feedback for &ldquo;{props.workflowLabel} / {props.stageName}&rdquo;.
          </DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[75vh] gap-4 overflow-y-auto pr-1">
          <Textarea
            placeholder="Describe the changes needed..."
            rows={4}
            value={props.feedback}
            onChange={(event) => props.onFeedbackChange(event.target.value)}
            className="min-h-[140px]"
          />
          {props.isError ? (
            <p className="text-sm text-red-600">Failed to submit feedback. Please try again.</p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => props.onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={!props.canSubmit || props.isPending} onClick={props.onSubmit}>
              Submit
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function readGatePanelClassName(
  tone: 'secondary' | 'warning' | 'destructive' | 'success' = 'secondary',
): string {
  if (tone === 'warning') {
    return 'space-y-3 rounded-xl border border-yellow-200 bg-yellow-50/80 p-4 shadow-sm';
  }
  if (tone === 'destructive') {
    return 'space-y-3 rounded-xl border border-rose-200 bg-rose-50/80 p-4 shadow-sm';
  }
  if (tone === 'success') {
    return 'space-y-3 rounded-xl border border-green-200 bg-green-50/80 p-4 shadow-sm';
  }
  return 'space-y-3 rounded-xl border border-border/70 bg-border/10 p-4 shadow-sm';
}
