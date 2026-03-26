import { ConfigPlaceholderPage } from '../config-placeholder/config-placeholder-page.js';

export function AcpPage(): JSX.Element {
  return (
    <ConfigPlaceholderPage
      navHref="/integrations/acp"
      description="Configure Agent Communication Protocol integrations."
    />
  );
}
