import { ConfigPlaceholderPage } from '../config-placeholder/config-placeholder-page.js';

export function WebhooksPage(): JSX.Element {
  return (
    <ConfigPlaceholderPage
      title="Webhooks"
      description="Configure outbound webhooks for platform event delivery."
    />
  );
}
