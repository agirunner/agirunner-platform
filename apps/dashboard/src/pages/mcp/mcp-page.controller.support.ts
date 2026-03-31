import type { QueryClient } from '@tanstack/react-query';

import { toast } from '../../lib/toast.js';
import type { DashboardRemoteMcpAuthorizeResult } from '../../lib/api.js';
import {
  resolveDeviceAuthorizationUrl,
  toDeviceAuthorizationState,
  type RemoteMcpDeviceAuthorizationState,
} from './mcp-page.oauth-flow.js';
import type { RemoteMcpServerFormState } from './mcp-page.support.js';

export function buildSubmitLabel(
  mode: 'create' | 'edit',
  authMode: RemoteMcpServerFormState['authMode'],
  grantType?: RemoteMcpServerFormState['oauth']['grantType'],
): string {
  if (mode === 'create' && authMode === 'oauth') {
    if (grantType === 'device_authorization') {
      return 'Start device authorization';
    }
    if (grantType === 'client_credentials') {
      return 'Verify and Save';
    }
    return 'Authorize and Save';
  }
  if (mode === 'edit') {
    return 'Save Changes';
  }
  return 'Save and Verify';
}

export async function refreshRemoteMcpQueries(queryClient: QueryClient) {
  await queryClient.invalidateQueries({ queryKey: ['remote-mcp-servers'] });
  await queryClient.invalidateQueries({ queryKey: ['remote-mcp-oauth-client-profiles'] });
}

export async function handleRemoteMcpOauthStartResult(
  result: DashboardRemoteMcpAuthorizeResult,
  options: {
    queryClient: QueryClient;
    setDeviceAuthorization(next: RemoteMcpDeviceAuthorizationState | null): void;
  },
) {
  if (result.kind === 'browser') {
    openAuthorizeUrl(result.authorizeUrl);
    return;
  }
  if (result.kind === 'device') {
    options.setDeviceAuthorization(toDeviceAuthorizationState(result));
    toast.success(
      'Device authorization started. Complete it in the verification page, then check the status here.',
    );
    return;
  }
  options.setDeviceAuthorization(null);
  await refreshRemoteMcpQueries(options.queryClient);
  toast.success(`OAuth connected successfully for ${result.serverName}.`);
}

function openAuthorizeUrl(authorizeUrl: string) {
  if (typeof window !== 'undefined') {
    window.location.assign(authorizeUrl);
  }
}

export { resolveDeviceAuthorizationUrl };
