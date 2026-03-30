import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(fileName: string) {
  return readFileSync(resolve(import.meta.dirname, fileName), 'utf8');
}

function readCombinedSource() {
  return [
    '../../lib/api.ts',
    '../../lib/dashboard-api/contracts.ts',
    './mcp-page.tsx',
    './mcp-page.controller.ts',
    './mcp-page.errors.ts',
    './mcp-page.api.ts',
    './mcp-page.device-authorization-dialog.tsx',
    './mcp-page.support.ts',
    './mcp-page.oauth-flow.ts',
    './mcp-page.table.tsx',
    './mcp-page.dialog.tsx',
    './mcp-page.oauth-fields.tsx',
    './mcp-page.oauth-client-profile-form.ts',
    './mcp-page.oauth-client-profile-dialog.tsx',
    './mcp-page.oauth-client-profiles-section.tsx',
    './mcp-page.oauth-settings.tsx',
    './mcp-page.oauth-settings.advanced.tsx',
    './mcp-page.parameters-section.tsx',
    './mcp-page.tools-sheet.tsx',
  ]
    .map(readSource)
    .join('\n');
}

function readApiSource() {
  return [
    readSource('../../lib/api.ts'),
    readSource('../../lib/dashboard-api/contracts.ts'),
    readSource('../../lib/dashboard-api/create-dashboard-api.ts'),
  ].join('\n');
}

describe('mcp page source', () => {
  it('replaces the placeholder with a real management surface', () => {
    const source = readCombinedSource();

    expect(source).toContain('DashboardPageHeader');
    expect(source).toContain('navHref="/integrations/mcp-servers"');
    expect(source).toContain('Register remote MCP servers, verify connectivity, and inspect discovered tools.');
    expect(source).toContain('Create Remote MCP Server');
    expect(source).toContain('OAuth client profiles');
    expect(source).toContain('Create OAuth Client Profile');
    expect(source).toContain('variant="outline"');
    expect(source).toContain("queryKey: ['remote-mcp-servers']");
    expect(source).toContain("queryKey: ['remote-mcp-oauth-client-profiles']");
    expect(source).toContain('fetchRemoteMcpServers');
    expect(source).toContain('fetchRemoteMcpOAuthClientProfiles');
    expect(source).not.toContain('ConfigPlaceholderPage');
  });

  it('handles oauth callback success and failure on the integrations mcp route', () => {
    const source = readCombinedSource();

    expect(source).toContain("const oauthSuccess = searchParams.get('oauth_success');");
    expect(source).toContain("const oauthError = searchParams.get('oauth_error');");
    expect(source).toContain("const remoteMcpServerName = searchParams.get('remote_mcp_server_name');");
    expect(source).toContain('OAuth connected successfully');
    expect(source).toContain("toast.error(normalizeMcpErrorText(oauthError, 'OAuth authorization failed.'))");
    expect(source).toContain("queryClient.invalidateQueries({ queryKey: ['remote-mcp-servers'] })");
  });

  it('keeps page state, mutations, and oauth transitions in a dedicated controller module', () => {
    const source = readSource('./mcp-page.controller.ts');

    expect(source).toContain('export function useMcpPageController()');
    expect(source).toContain('const saveMutation = useMutation({');
    expect(source).toContain('const connectOauthMutation = useMutation({');
    expect(source).toContain('const pollDeviceAuthorizationMutation = useMutation({');
    expect(source).toContain('async function handleRemoteMcpOauthStartResult(');
    expect(source).toContain('async function refreshRemoteMcpQueries(');
    expect(source).toContain('toast.success(`OAuth connected successfully for ${result.serverName}.`)');
  });

  it('includes operator actions for tools, verification, oauth connection, and archive state', () => {
    const source = readCombinedSource();

    expect(source).toContain('View capabilities');
    expect(source).toContain('Reverify');
    expect(source).toContain('Connect OAuth');
    expect(source).toContain('Reconnect OAuth');
    expect(source).toContain('Disconnect OAuth');
    expect(source).toContain('Delete');
    expect(source).not.toContain('Archive');
    expect(source).not.toContain('Restore');
    expect(source).toContain('handleRemoteMcpOauthStartResult(');
    expect(source).toContain('pollRemoteMcpOAuthDeviceAuthorization');
    expect(source).toContain('deviceFlowId');
    expect(source).toContain('verificationUri');
    expect(source).toContain('window.location.assign(authorizeUrl)');
  });

  it('shows only configured and oauth-connected cards, with transport separated from status', () => {
    const source = readCombinedSource();

    expect(source).toContain('Configured servers');
    expect(source).toContain('OAuth connected');
    expect(source).not.toContain('MetricCard label="Verified"');
    expect(source).toContain('<div className="overflow-x-auto border-y border-border/70">');
    expect(source).toContain('<TableHead className="w-[190px]">Transport</TableHead>');
    expect(source).toContain('<TableHead className="w-[96px] text-center">Specialists</TableHead>');
    expect(source).toContain('Connection parameters');
    expect(source).toContain('No additional auth');
  });

  it('renders a first-run empty state for remote MCP servers with an icon and create action', () => {
    const source = readSource('./mcp-page.tsx');

    expect(source).toContain('No remote MCP servers yet');
    expect(source).toContain('Create first remote MCP server');
    expect(source).toContain(
      'Create the first remote MCP server, then verify connectivity, inspect',
    );
    expect(source).toContain('discovered tools, and make it available to specialists from one place.');
    expect(source).toContain('make it available to specialists from one place.');
    expect(source).toContain('<Plug className="h-12 w-12 text-muted" />');
    expect(source).toContain('servers.length === 0 ? (');
  });

  it('renders discovered capabilities behind a chevron-driven spanning detail row', () => {
    const source = readSource('./mcp-page.table.tsx');

    expect(source).toContain('useState(false)');
    expect(source).toContain('ChevronDown');
    expect(source).toContain('ChevronRight');
    expect(source).toContain('onClick={() => setIsExpanded((value) => !value)}');
    expect(source).toContain('<TableCell colSpan={6} className="bg-border/10">');
    expect(source).toContain('Capabilities summary');
    expect(source).toContain('grid gap-3 md:grid-cols-2');
    expect(source).toContain('Capability counts');
    expect(source).toContain('Discovered tools');
    expect(source).toContain('rounded-lg border border-border/70 bg-background/80 p-3');
    expect(source).toContain('text-sm text-foreground');
    expect(source).toContain('No discovered tools snapshot.');
  });

  it('centers the primary registered-server row content vertically and constrains the specialists count column', () => {
    const source = readSource('./mcp-page.table.tsx');

    expect(source).toContain('TableCell className="align-middle"');
    expect(source).not.toContain('TableCell className="align-top"');
    expect(source).toContain('TableCell className="w-[96px] align-middle text-center text-sm text-foreground"');
  });

  it('authors endpoint, auth, defaults, and parameter rows in the dialog', () => {
    const source = readCombinedSource();
    const dialogSource = readSource('./mcp-page.dialog.tsx');

    expect(source).toContain('max-w-[92rem]');
    expect(source).not.toContain('top-[5vh]');
    expect(source).not.toContain('translate-y-0');
    expect(source).toContain('Endpoint URL');
    expect(source).toContain('Authentication');
    expect(source).toContain('Transport preference');
    expect(dialogSource).toContain('xl:grid-cols-4');
    expect(dialogSource).not.toContain('xl:grid-cols-[minmax(0,1fr)_14rem_14rem]');
    expect(dialogSource).toContain('<label className="grid gap-2 text-sm xl:col-span-2">');
    expect(dialogSource).toContain('<label className="grid gap-2 text-sm xl:col-span-4">');
    expect(source).toContain('lg:grid-cols-2');
    expect(source).not.toContain('xl:grid-cols-[minmax(0,1fr)_24rem]');
    expect(source).not.toContain('<aside className="space-y-5">');
    expect(source).toContain('<span className="font-medium">Name</span>');
    expect(source).toContain('<span className="font-medium">Authentication</span>');
    expect(source).toContain('<span className="font-medium">Transport preference</span>');
    expect(source).toContain('Enabled by default for new specialists');
    expect(source).toContain('Grant to all existing specialists');
    expect(source).toContain('Call timeout (seconds)');
    expect(source).toContain('Connection parameters');
    expect(source).toContain('Additional connection parameters');
    expect(source).toContain('OAuth setup');
    expect(source).toContain('OAuth client profile');
    expect(source).toContain('Use automatic discovery only');
    expect(source).toContain('Advanced OAuth settings');
    expect(source).toContain('Cookie');
    expect(source).toContain('Authorize request query');
    expect(source).toContain('Device request query');
    expect(source).toContain('Device request header');
    expect(source).toContain('Device request body (form)');
    expect(source).toContain('Device request body (JSON)');
    expect(source).toContain('Token request query');
    expect(source).toContain('Token request header');
    expect(source).toContain('Token request body (form)');
    expect(source).toContain('Token request body (JSON)');
    expect(source).toContain('Initialize parameter');
    expect(source).not.toContain('Stored secret configured');
    expect(source).toContain('Add parameter');
    expect(source).toContain("authMode !== 'none'");
    expect(source).toContain('normalizeParametersForAuthMode');
  });

  it('formats MCP dashboard errors without raw HTTP prefixes', () => {
    const source = readCombinedSource();

    expect(source).toContain('formatMcpErrorMessage');
    expect(source).toContain('normalizeMcpErrorText');
    expect(source).toContain("trimmed.match(/^HTTP\\s+\\d+\\s*:\\s*(.+)$/i)");
    expect(source).toContain("toast.error(formatMcpErrorMessage(error, 'Failed to save remote MCP server.'))");
    expect(source).toContain("toast.error(normalizeMcpErrorText(oauthError, 'OAuth authorization failed.'))");
    expect(source).not.toContain("toast.error(error instanceof Error ? error.message : 'Failed to save remote MCP server.')");
  });

  it('keeps the connection summary driven by the current form auth mode', () => {
    const source = readSource('./mcp-page.dialog.tsx');

    expect(source).toContain("props.form.authMode === 'oauth' ? (");
    expect(source).not.toContain("props.form.authMode === 'oauth' && props.server?.auth_mode === 'oauth'");
  });

  it('lets the parameter section render as an explicit empty state when no rows exist', () => {
    const source = readSource('./mcp-page.parameters-section.tsx');

    expect(source).toContain("props.parameters.length === 0");
    expect(source).toContain('No additional connection parameters are configured.');
    expect(source).toContain('No connection parameters are configured.');
  });

  it('keeps manual client and advanced oauth settings inside one advanced block', () => {
    const settingsSource = readSource('./mcp-page.oauth-settings.tsx');
    const advancedSource = readSource('./mcp-page.oauth-settings.advanced.tsx');

    expect(settingsSource).toContain('Open this section for manual client details');
    expect(settingsSource).toContain('OAuth client profile');
    expect(settingsSource).not.toContain('label="Grant type"');
    expect(settingsSource).not.toContain('label="Setup mode"');
    expect(settingsSource).toContain('border-t border-border/70 px-4 py-4');
    expect(settingsSource).not.toContain('Client ID');
    expect(settingsSource).not.toContain('Client secret');
    expect(settingsSource).not.toContain('Token auth method');
    expect(advancedSource).toContain('Manual client details');
    expect(advancedSource).toContain('label="Grant type"');
    expect(advancedSource).toContain('label="Setup mode"');
    expect(advancedSource).toContain('Client ID');
    expect(advancedSource).toContain('Client secret');
    expect(advancedSource).toContain('Token auth method');
  });

  it('lays out advanced oauth fields in balanced grouped rows', () => {
    const source = readCombinedSource();

    expect(source).toContain('className="grid gap-4 md:grid-cols-3"');
    expect(source).toContain('label="PAR mode"');
    expect(source).toContain('label="JAR mode"');
    expect(source).toContain('label="Callback mode"');
    expect(source).toContain('className="grid gap-4 md:grid-cols-2"');
    expect(source).toContain('label="Private key PEM"');
  });

  it('uses a guided oauth dialog that does not render the full advanced surface by default', () => {
    const source = readCombinedSource();

    expect(source).toContain('OAuth setup');
    expect(source).toContain('OAuth client profile');
    expect(source).toContain('Advanced OAuth settings');
    expect(source).toContain('showAdvanced');
    expect(source).toContain("if (value === 'manual_client')");
    expect(source).toContain('setShowAdvanced(true)');
    expect(source).toContain('Manual client');
    expect(source).toContain('Manual client setup requires the OAuth client and endpoint values supplied by the remote authorization server operator. Those fields live under Advanced OAuth settings.');
  });

  it('adds a shared oauth client profile management section and dialog', () => {
    const source = readCombinedSource();

    expect(source).toContain('Manage shared host-managed OAuth client credentials and endpoint defaults');
    expect(source).toContain('Linked MCP servers');
    expect(source).toContain('whitespace-nowrap');
    expect(source).toContain('Delete OAuth Client Profile');
    expect(source).toContain('Create OAuth Client Profile');
    expect(source).toContain('Edit OAuth Client Profile');
    expect(source).toContain('Define reusable host-managed OAuth client credentials');
    expect(source).not.toContain('No profile description.');
  });

  it('renders a first-run empty state for oauth client profiles with an icon and create action', () => {
    const source = readSource('./mcp-page.oauth-client-profiles-section.tsx');

    expect(source).toContain('No OAuth client profiles yet');
    expect(source).toContain('Create first OAuth client profile');
    expect(source).toContain('<ShieldCheck className="h-12 w-12 text-muted" />');
    expect(source).toContain('onCreate(): void;');
    expect(source).toContain('<Button variant="outline" onClick={props.onCreate} className="w-full sm:w-auto">');
    expect(source).toContain(
      'Create a shared profile only when a remote MCP server requires host-managed OAuth',
    );
    expect(source).not.toContain('No OAuth client profiles defined');
  });

  it('lays out the oauth client profile dialog with balanced half-width identity fields', () => {
    const source = readSource('./mcp-page.oauth-client-profile-dialog.tsx');

    expect(source).toContain('grid gap-4 xl:grid-cols-4');
    expect(source).toContain('label="Client ID"');
    expect(source).toContain('label="Client secret"');
    expect(source).toContain('className="xl:col-span-2"');
    expect(source).toContain('className="xl:col-span-4"');
    expect(source).not.toContain('Client secret" className="lg:col-span-2"');
  });

  it('teaches the dashboard api about remote mcp oauth client profile routes', () => {
    const source = readApiSource();

    expect(source).toContain('DashboardRemoteMcpOAuthClientProfileRecord');
    expect(source).toContain('listRemoteMcpOAuthClientProfiles');
    expect(source).toContain('createRemoteMcpOAuthClientProfile');
    expect(source).toContain('updateRemoteMcpOAuthClientProfile');
    expect(source).toContain('deleteRemoteMcpOAuthClientProfile');
    expect(source).toContain('/api/v1/remote-mcp-oauth-client-profiles');
  });

  it('keeps the mcp action buttons on one row', () => {
    const source = readSource('./mcp-page.table.tsx');

    expect(source).toContain('className="w-[260px] text-right"');
    expect(source).toContain('className="flex flex-nowrap justify-end gap-2 whitespace-nowrap"');
  });

  it('models a discriminated oauth result contract for browser, device, and completed flows', () => {
    const source = readApiSource();

    expect(source).toContain("kind: 'browser'");
    expect(source).toContain("kind: 'device'");
    expect(source).toContain("kind: 'completed'");
    expect(source).toContain('verificationUriComplete');
    expect(source).toContain('pollRemoteMcpOAuthDeviceAuthorization');
  });
});
