import type { DashboardWorkspaceRecord } from '../../lib/api.js';
import { ScheduledTriggersCard } from './workspace-scheduled-triggers-card.js';
import { WebhookTriggersCard } from './workspace-webhook-triggers-card.js';

export function WorkspaceAutomationTab({ workspace }: { workspace: DashboardWorkspaceRecord }): JSX.Element {
  return (
    <div className="space-y-3">
      <section className="scroll-mt-24">
        <ScheduledTriggersCard workspace={workspace} />
      </section>
      <section className="scroll-mt-24">
        <WebhookTriggersCard workspace={workspace} />
      </section>
    </div>
  );
}
