import { DashboardPageHeader } from '../../components/layout/dashboard-page-header.js';
import { DashboardSectionCard } from '../../components/layout/dashboard-section-card.js';

export function IntegrationPlaceholder(props: {
  navHref: string;
  title?: string;
  description: string;
}): JSX.Element {
  return (
    <div className="space-y-6 p-6">
      <DashboardPageHeader navHref={props.navHref} title={props.title} description={props.description} />
      <DashboardSectionCard
        title="Coming soon"
        bodyClassName="space-y-0"
      >
        <p className="text-sm leading-6 text-muted">Coming in the next iteration, stay tuned.</p>
      </DashboardSectionCard>
    </div>
  );
}
