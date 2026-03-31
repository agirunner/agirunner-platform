import { IntegrationPlaceholder } from '../integrations/integration-placeholder.js';

export function WebhooksPage(): JSX.Element {
  return (
    <IntegrationPlaceholder
      navHref="/integrations/webhooks"
      title="Webhooks"
      description="Configure outbound webhooks for platform event delivery."
    />
  );
}
