import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import type { LaunchOverviewCard, LaunchSectionLink } from './playbook-launch-support.js';

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
