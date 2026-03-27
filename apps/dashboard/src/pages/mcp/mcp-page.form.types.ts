import type {
  DashboardRemoteMcpOauthCallbackMode,
  DashboardRemoteMcpOauthClientStrategy,
  DashboardRemoteMcpOauthGrantType,
  DashboardRemoteMcpOauthJarMode,
  DashboardRemoteMcpOauthParMode,
  DashboardRemoteMcpOauthTokenEndpointAuthMethod,
  DashboardRemoteMcpServerParameterInput,
  DashboardRemoteMcpServerCreateInput,
  DashboardRemoteMcpTransportPreference,
} from '../../lib/api.js';

export const REMOTE_MCP_STORED_SECRET_VALUE = 'redacted://remote-mcp-secret';
export const DEFAULT_REMOTE_MCP_CALL_TIMEOUT_SECONDS = 300;

export interface RemoteMcpParameterFormState {
  id: string;
  placement: DashboardRemoteMcpServerParameterInput['placement'];
  key: string;
  valueKind: DashboardRemoteMcpServerParameterInput['valueKind'];
  value: string;
  hasStoredSecret: boolean;
}

export interface RemoteMcpOauthFormState {
  grantType: DashboardRemoteMcpOauthGrantType;
  clientStrategy: DashboardRemoteMcpOauthClientStrategy;
  callbackMode: DashboardRemoteMcpOauthCallbackMode;
  clientId: string;
  clientSecret: string;
  hasStoredClientSecret: boolean;
  tokenEndpointAuthMethod: DashboardRemoteMcpOauthTokenEndpointAuthMethod;
  authorizationEndpointOverride: string;
  tokenEndpointOverride: string;
  registrationEndpointOverride: string;
  deviceAuthorizationEndpointOverride: string;
  protectedResourceMetadataUrlOverride: string;
  authorizationServerMetadataUrlOverride: string;
  scopesText: string;
  resourceIndicatorsText: string;
  audiencesText: string;
  enterpriseProfileText: string;
  parMode: DashboardRemoteMcpOauthParMode;
  jarMode: DashboardRemoteMcpOauthJarMode;
  privateKeyPem: string;
  hasStoredPrivateKeyPem: boolean;
}

export interface RemoteMcpServerFormState {
  name: string;
  description: string;
  endpointUrl: string;
  transportPreference: DashboardRemoteMcpTransportPreference;
  callTimeoutSeconds: string;
  authMode: DashboardRemoteMcpServerCreateInput['authMode'];
  enabledByDefaultForNewSpecialists: boolean;
  grantToAllExistingSpecialists: boolean;
  oauthClientProfileId: string;
  oauth: RemoteMcpOauthFormState;
  parameters: RemoteMcpParameterFormState[];
}
