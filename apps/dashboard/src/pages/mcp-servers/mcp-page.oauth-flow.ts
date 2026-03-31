import type { DashboardRemoteMcpAuthorizeResult } from '../../lib/api.js';

export interface RemoteMcpDeviceAuthorizationState {
  draftId: string;
  deviceFlowId: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string | null;
  expiresInSeconds: number;
  intervalSeconds: number;
}

export function toDeviceAuthorizationState(
  result: DashboardRemoteMcpAuthorizeResult,
): RemoteMcpDeviceAuthorizationState | null {
  if (result.kind !== 'device') {
    return null;
  }
  return {
    draftId: result.draftId,
    deviceFlowId: result.deviceFlowId,
    userCode: result.userCode,
    verificationUri: result.verificationUri,
    verificationUriComplete: result.verificationUriComplete,
    expiresInSeconds: result.expiresInSeconds,
    intervalSeconds: result.intervalSeconds,
  };
}

export function resolveDeviceAuthorizationUrl(
  state: RemoteMcpDeviceAuthorizationState,
): string {
  return state.verificationUriComplete ?? state.verificationUri;
}
