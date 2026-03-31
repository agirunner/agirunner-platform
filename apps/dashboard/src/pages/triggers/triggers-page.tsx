import { ConfigPlaceholderPage } from '../integrations/config-placeholder-page.js';

export function TriggersPage(): JSX.Element {
  return (
    <ConfigPlaceholderPage
      navHref="/integrations/triggers"
      title="Triggers"
      description="Configure triggers that turn events into work."
    />
  );
}
