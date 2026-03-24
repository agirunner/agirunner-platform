import type { ReactNode } from 'react';
import { Loader2, Rocket } from 'lucide-react';

import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import type { LaunchDefinitionSummary } from './playbook-launch-support.js';

export function StructuredSection(props: {
  id?: string;
  title: string;
  description: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <section
      id={props.id}
      className="scroll-mt-24 space-y-4 rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5"
    >
      <header>
        <div className="font-medium text-foreground">{props.title}</div>
        <p className="mt-1 text-sm text-muted">{props.description}</p>
      </header>
      {props.children}
    </section>
  );
}

export function LaunchDefinitionSnapshot(props: {
  launchDefinition: LaunchDefinitionSummary;
  outcome?: string;
}): JSX.Element {
  return (
    <div className="grid gap-3">
      {props.outcome ? (
        <div className="rounded-md border border-border bg-muted/20 p-3 text-sm">
          <div className="font-medium">Outcome</div>
          <p className="mt-2 text-muted">{props.outcome}</p>
        </div>
      ) : null}
      <SnapshotList
        title="Board Columns"
        values={props.launchDefinition.boardColumns.map((column) => column.label)}
        emptyMessage="No board columns defined."
      />
      <SnapshotList
        title="Workflow stages"
        values={props.launchDefinition.stageNames}
        emptyMessage="No stages defined."
      />
      <SnapshotList
        title="Playbook Roles"
        values={props.launchDefinition.roles}
        emptyMessage="No explicit roles declared."
      />
    </div>
  );
}

function SnapshotList(props: {
  title: string;
  values: string[];
  emptyMessage: string;
}): JSX.Element {
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3 text-sm">
      <div className="font-medium">{props.title}</div>
      <div className="mt-2 flex flex-wrap gap-2">
        {props.values.length > 0 ? (
          props.values.map((value) => (
            <Badge key={value} variant="outline">
              {value}
            </Badge>
          ))
        ) : (
          <span className="text-muted">{props.emptyMessage}</span>
        )}
      </div>
    </div>
  );
}

export function ResolutionOrderPanel(): JSX.Element {
  return (
    <div className="grid gap-3 rounded-2xl border border-border/70 bg-muted/10 p-4">
      <div>
        <div className="font-medium text-foreground">Resolution order</div>
        <p className="mt-1 text-sm text-muted">
          Every launch input resolves in the same order so operators can see what belongs to the
          playbook, what came from the workspace, and what this run overrides.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <ResolutionStep
          step="1"
          title="Playbook default"
          detail="Start from the value declared on the playbook."
        />
        <ResolutionStep
          step="2"
          title="Workspace autofill"
          detail="If the parameter maps to workspace data, that workspace value replaces the default."
        />
        <ResolutionStep
          step="3"
          title="Launch override"
          detail="Anything entered at launch wins for this run only."
        />
      </div>
    </div>
  );
}

export function LaunchActionCard(props: {
  canLaunch: boolean;
  isLaunching: boolean;
  blockingIssueCount: number;
  onLaunch(): void;
}): JSX.Element {
  return (
    <Card className="border-border/70 bg-card/80 shadow-sm">
      <CardHeader className="space-y-2">
        <CardTitle>Launch action</CardTitle>
        <p className="text-sm text-muted">
          Keep the main column focused on the process. Use this rail to confirm readiness and start
          the workflow.
        </p>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="rounded-xl border border-border/70 bg-muted/10 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium text-foreground">
              {props.canLaunch ? 'Ready to launch' : 'Resolve blockers'}
            </div>
            <Badge variant={props.canLaunch ? 'secondary' : 'destructive'}>
              {props.canLaunch ? 'Ready to launch' : `${props.blockingIssueCount} blocker${props.blockingIssueCount === 1 ? '' : 's'}`}
            </Badge>
          </div>
          <p className="mt-2 text-sm text-muted">
            {props.canLaunch
              ? 'All required launch inputs are present. Start the workflow when you are ready.'
              : 'Resolve the highlighted inputs in the main column or advanced section before launch.'}
          </p>
        </div>
        <Button onClick={props.onLaunch} disabled={!props.canLaunch}>
          {props.isLaunching ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Rocket className="h-4 w-4" />
          )}
          Launch Workflow
        </Button>
      </CardContent>
    </Card>
  );
}

function ResolutionStep(props: {
  step: string;
  title: string;
  detail: string;
}): JSX.Element {
  return (
    <div className="rounded-xl border border-border/70 bg-background/70 p-3 text-sm">
      <div className="flex items-center gap-2">
        <Badge variant="outline">{props.step}</Badge>
        <div className="font-medium text-foreground">{props.title}</div>
      </div>
      <p className="mt-2 text-muted">{props.detail}</p>
    </div>
  );
}
