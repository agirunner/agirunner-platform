import type { ReactNode } from 'react';

import { Badge } from '../../components/ui/badge.js';
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
}): JSX.Element {
  return (
    <div className="grid gap-3">
      <SnapshotList
        title="Board Columns"
        values={props.launchDefinition.boardColumns.map((column) => column.label)}
        emptyMessage="No board columns defined."
      />
      <SnapshotList
        title="Live Stages"
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
