import type { ReactNode } from 'react';

import { Badge } from '../../components/ui/badge.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import type {
  LaunchDefinitionSummary,
  LaunchOverviewCard,
  LaunchSectionLink,
} from './playbook-launch-support.js';

export function LaunchOverviewCards(props: {
  cards: LaunchOverviewCard[];
}): JSX.Element {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Launch overview</h2>
        <p className="text-sm text-muted">
          Keep the run identity, launch-input posture, and workflow policy visible before diving
          into the full form.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {props.cards.map((card) => (
          <Card key={card.label} className="border-border/70 shadow-sm">
            <CardHeader className="space-y-1">
              <p className="text-sm font-medium text-muted">{card.label}</p>
              <CardTitle className="text-xl">{card.value}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-6 text-muted">{card.detail}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

export function LaunchOutlineCard(props: {
  sections: LaunchSectionLink[];
}): JSX.Element {
  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader className="space-y-1">
        <CardTitle className="text-base">Jump to section</CardTitle>
        <p className="text-sm text-muted">
          Long launch forms stay navigable with direct links to the next decision point.
        </p>
      </CardHeader>
      <CardContent className="grid gap-3">
        {props.sections.map((section) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            className="rounded-xl border border-border/70 bg-muted/10 px-3 py-3 transition-colors hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="text-sm font-medium text-foreground">{section.label}</div>
            <p className="mt-1 text-sm text-muted">{section.detail}</p>
          </a>
        ))}
      </CardContent>
    </Card>
  );
}

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
