import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(fileName: string) {
  return readFileSync(resolve(import.meta.dirname, fileName), 'utf8');
}

function readCombinedSource() {
  return [
    '../../lib/api.ts',
    './mcp-page.tsx',
    './mcp-page.api.ts',
    './mcp-page.device-authorization-dialog.tsx',
    './mcp-page.support.ts',
    './mcp-page.oauth-flow.ts',
    './mcp-page.table.tsx',
    './mcp-page.dialog.tsx',
    './mcp-page.oauth-settings.tsx',
    './mcp-page.parameters-section.tsx',
    './mcp-page.tools-sheet.tsx',
  ]
    .map(readSource)
    .join('\n');
}

describe('mcp page source', () => {
  it('replaces the placeholder with a real management surface', () => {
    const source = readCombinedSource();

    expect(source).toContain('DashboardPageHeader');
    expect(source).toContain('navHref="/integrations/mcp-servers"');
    expect(source).toContain('Register remote MCP servers, verify connectivity, and inspect discovered tools.');
    expect(source).toContain('Create Remote MCP Server');
    expect(source).toContain("queryKey: ['remote-mcp-servers']");
    expect(source).toContain('fetchRemoteMcpServers');
    expect(source).not.toContain('ConfigPlaceholderPage');
  });

  it('handles oauth callback success and failure on the integrations mcp route', () => {
    const source = readSource('./mcp-page.tsx');

    expect(source).toContain("const oauthSuccess = searchParams.get('oauth_success');");
    expect(source).toContain("const oauthError = searchParams.get('oauth_error');");
    expect(source).toContain("const remoteMcpServerName = searchParams.get('remote_mcp_server_name');");
    expect(source).toContain('OAuth connected successfully');
    expect(source).toContain("toast.error(`OAuth failed: ${oauthError}`)");
    expect(source).toContain("queryClient.invalidateQueries({ queryKey: ['remote-mcp-servers'] })");
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
    expect(source).toContain("window.open(authorizeUrl, '_blank', 'noopener,noreferrer')");
  });

  it('shows only configured and oauth-connected cards, with transport separated from status', () => {
    const source = readCombinedSource();

    expect(source).toContain('Configured servers');
    expect(source).toContain('OAuth connected');
    expect(source).not.toContain('MetricCard label="Verified"');
    expect(source).toContain('<TableHead className="w-[190px]">Transport</TableHead>');
    expect(source).toContain('Connection parameters');
    expect(source).toContain('No additional auth');
  });

  it('authors endpoint, auth, defaults, and parameter rows in the dialog', () => {
    const source = readCombinedSource();

    expect(source).toContain('max-w-[92rem]');
    expect(source).not.toContain('top-[5vh]');
    expect(source).not.toContain('translate-y-0');
    expect(source).toContain('Endpoint URL');
    expect(source).toContain('Authentication');
    expect(source).toContain('Transport preference');
    expect(source).toContain('Enabled by default for new specialists');
    expect(source).toContain('Grant to all existing specialists');
    expect(source).toContain('Call timeout (seconds)');
    expect(source).toContain('Connection parameters');
    expect(source).toContain('Additional connection parameters');
    expect(source).toContain('OAuth settings');
    expect(source).toContain('Client strategy');
    expect(source).toContain('Callback mode');
    expect(source).toContain('PAR mode');
    expect(source).toContain('JAR mode');
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

  it('models a discriminated oauth result contract for browser, device, and completed flows', () => {
    const source = readSource('../../lib/api.ts');

    expect(source).toContain("kind: 'browser'");
    expect(source).toContain("kind: 'device'");
    expect(source).toContain("kind: 'completed'");
    expect(source).toContain('verificationUriComplete');
    expect(source).toContain('pollRemoteMcpOAuthDeviceAuthorization');
  });
});
