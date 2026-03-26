import { ConfigPlaceholderPage } from '../config-placeholder/config-placeholder-page.js';

export function McpPage(): JSX.Element {
  return (
    <ConfigPlaceholderPage
      navHref="/integrations/mcp"
      description="Configure Model Context Protocol integrations."
    />
  );
}
