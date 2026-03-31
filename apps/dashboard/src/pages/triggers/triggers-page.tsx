import { IntegrationPlaceholder } from '../integrations/integration-placeholder.js';

export function TriggersPage(): JSX.Element {
  return (
    <IntegrationPlaceholder
      navHref="/integrations/triggers"
      title="Triggers"
      description="Configure triggers that turn events into work."
    />
  );
}
