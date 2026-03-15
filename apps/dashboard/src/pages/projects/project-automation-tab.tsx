import type { DashboardProjectRecord } from '../../lib/api.js';
import { ScheduledTriggersCard } from './project-scheduled-triggers-card.js';
import { WebhookTriggersCard } from './project-webhook-triggers-card.js';

export function ProjectAutomationTab({ project }: { project: DashboardProjectRecord }): JSX.Element {
  return (
    <div className="space-y-3">
      <section className="scroll-mt-24">
        <ScheduledTriggersCard project={project} />
      </section>
      <section className="scroll-mt-24">
        <WebhookTriggersCard project={project} />
      </section>
    </div>
  );
}
