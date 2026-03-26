import { dashboardApi } from '../../lib/api.js';
import type {
  DashboardRemoteMcpAuthorizeResult,
  DashboardRemoteMcpServerCreateInput,
  DashboardRemoteMcpServerRecord,
  DashboardRemoteMcpServerUpdateInput,
} from '../../lib/api.js';

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

export const disconnectRemoteMcpOAuth = (serverId: string): Promise<void> =>
  dashboardApi.disconnectRemoteMcpOAuth(serverId);

export const reverifyRemoteMcpServer = (
  serverId: string,
): Promise<DashboardRemoteMcpServerRecord> =>
  dashboardApi.reverifyRemoteMcpServer(serverId);

export const archiveRemoteMcpServer = (
  serverId: string,
): Promise<DashboardRemoteMcpServerRecord> =>
  dashboardApi.archiveRemoteMcpServer(serverId);

export const unarchiveRemoteMcpServer = (
  serverId: string,
): Promise<DashboardRemoteMcpServerRecord> =>
  dashboardApi.unarchiveRemoteMcpServer(serverId);
