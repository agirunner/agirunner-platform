import { ConfigPlaceholderPage } from '../integrations-shared/config-placeholder-page.js';

export function WebhooksPage(): JSX.Element {
  return (
    <ConfigPlaceholderPage
      navHref="/integrations/webhooks"
      title="Webhooks"
      description="Configure outbound webhooks for platform event delivery."
    />
  );
}
