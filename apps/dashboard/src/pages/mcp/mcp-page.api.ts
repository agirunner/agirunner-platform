import { dashboardApi } from '../../lib/api.js';
import type {
  DashboardRemoteMcpAuthorizeResult,
  DashboardRemoteMcpOAuthClientProfileCreateInput,
  DashboardRemoteMcpOAuthClientProfileRecord,
  DashboardRemoteMcpOAuthClientProfileUpdateInput,
  DashboardRemoteMcpServerCreateInput,
  DashboardRemoteMcpServerRecord,
  DashboardRemoteMcpServerUpdateInput,
} from '../../lib/api.js';

export const fetchRemoteMcpOAuthClientProfiles = (): Promise<
  DashboardRemoteMcpOAuthClientProfileRecord[]
> => dashboardApi.listRemoteMcpOAuthClientProfiles();

export const createRemoteMcpOAuthClientProfile = (
  payload: DashboardRemoteMcpOAuthClientProfileCreateInput,
): Promise<DashboardRemoteMcpOAuthClientProfileRecord> =>
  dashboardApi.createRemoteMcpOAuthClientProfile(payload);

export const updateRemoteMcpOAuthClientProfile = (
  profileId: string,
  payload: DashboardRemoteMcpOAuthClientProfileUpdateInput,
): Promise<DashboardRemoteMcpOAuthClientProfileRecord> =>
  dashboardApi.updateRemoteMcpOAuthClientProfile(profileId, payload);

export const deleteRemoteMcpOAuthClientProfile = (profileId: string): Promise<void> =>
  dashboardApi.deleteRemoteMcpOAuthClientProfile(profileId);

export const fetchRemoteMcpServers = (): Promise<DashboardRemoteMcpServerRecord[]> =>
  dashboardApi.listRemoteMcpServers();

export const createRemoteMcpServer = (
  payload: DashboardRemoteMcpServerCreateInput,
): Promise<DashboardRemoteMcpServerRecord> => dashboardApi.createRemoteMcpServer(payload);

export const updateRemoteMcpServer = (
  serverId: string,
  payload: DashboardRemoteMcpServerUpdateInput,
): Promise<DashboardRemoteMcpServerRecord> =>
  dashboardApi.updateRemoteMcpServer(serverId, payload);

export const initiateRemoteMcpOAuthAuthorization = (
  payload: DashboardRemoteMcpServerCreateInput,
): Promise<DashboardRemoteMcpAuthorizeResult> =>
  dashboardApi.initiateRemoteMcpOAuthAuthorization(payload);

export const reconnectRemoteMcpOAuth = (
  serverId: string,
): Promise<DashboardRemoteMcpAuthorizeResult> =>
  dashboardApi.reconnectRemoteMcpOAuth(serverId);

export const pollRemoteMcpOAuthDeviceAuthorization = (
  deviceFlowId: string,
): Promise<DashboardRemoteMcpAuthorizeResult> =>
  dashboardApi.pollRemoteMcpOAuthDeviceAuthorization(deviceFlowId);

export const disconnectRemoteMcpOAuth = (serverId: string): Promise<void> =>
  dashboardApi.disconnectRemoteMcpOAuth(serverId);

export const reverifyRemoteMcpServer = (
  serverId: string,
): Promise<DashboardRemoteMcpServerRecord> =>
  dashboardApi.reverifyRemoteMcpServer(serverId);

export const deleteRemoteMcpServer = (serverId: string): Promise<void> =>
  dashboardApi.deleteRemoteMcpServer(serverId);
