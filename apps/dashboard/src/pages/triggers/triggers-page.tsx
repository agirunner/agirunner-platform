import { ConfigPlaceholderPage } from '../config-placeholder/config-placeholder-page.js';

export function WorkItemTriggersPage(): JSX.Element {
  return (
    <ConfigPlaceholderPage
      navHref="/integrations/triggers"
      title="Triggers"
      description="Configure triggers that turn events into work."
    />
  );
}
