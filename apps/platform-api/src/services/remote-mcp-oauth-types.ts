import { z } from 'zod';

import {
  remoteMcpOauthConfigSchema,
  type RemoteMcpOAuthConfigRecord,
} from './remote-mcp-model.js';

export interface ResourceMetadata {
  resource: string;
  authorizationServers: string[];
}

export interface PreparedOAuthFlow {
  authorizeUrl: string;
  resourceMetadata: ResourceMetadata;
  oauthConfig: RemoteMcpOAuthConfigRecord;
  codeVerifier: string;
  state: string;
  discoveryStrategy: string;
  oauthStrategy: string;
}

export interface DeviceAuthorizationFlow {
  resourceMetadata: ResourceMetadata;
  oauthConfig: RemoteMcpOAuthConfigRecord;
  state: string;
  deviceCode: string;
  userCode: string;
  verificationURI: string;
  verificationURIComplete: string | null;
  expiresInSeconds: number;
  intervalSeconds: number;
  discoveryStrategy: string;
  oauthStrategy: string;
}

export interface RemoteMcpOAuthStatePayload {
  mode: 'draft' | 'reconnect';
  draft_id?: string;
  server_id?: string;
  discovery_strategy: string;
  oauth_strategy: string;
  resource_metadata: {
    resource: string;
  };
  oauth_config: RemoteMcpOAuthConfigRecord;
  device_authorization?: {
    device_code: string;
    user_code: string;
    verification_uri: string;
    verification_uri_complete: string | null;
    expires_in_seconds: number;
    interval_seconds: number;
    requested_at: number;
  };
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

export interface DeviceAuthorizationResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval?: number;
}

export type DeviceAuthorizationPollResult =
  | {
      kind: 'pending';
      intervalSeconds: number;
    }
  | {
      kind: 'completed';
      token: TokenResponse;
    };

export type RemoteMcpOAuthStartResult =
  | {
      kind: 'browser';
      draftId: string;
      authorizeUrl: string;
    }
  | {
      kind: 'device';
      draftId: string;
      deviceFlowId: string;
      userCode: string;
      verificationUri: string;
      verificationUriComplete: string | null;
      expiresInSeconds: number;
      intervalSeconds: number;
    }
  | {
      kind: 'completed';
      serverId: string;
      serverName: string;
    };

export const remoteMcpOAuthStatePayloadSchema = z.object({
  mode: z.enum(['draft', 'reconnect']),
  draft_id: z.string().min(1).optional(),
  server_id: z.string().min(1).optional(),
  discovery_strategy: z.string().min(1),
  oauth_strategy: z.string().min(1),
  resource_metadata: z.object({
    resource: z.string().min(1),
  }).strict(),
  oauth_config: remoteMcpOauthConfigSchema,
  device_authorization: z.object({
    device_code: z.string().min(1),
    user_code: z.string().min(1),
    verification_uri: z.string().url(),
    verification_uri_complete: z.string().url().nullable(),
    expires_in_seconds: z.number().int().positive(),
    interval_seconds: z.number().int().positive(),
    requested_at: z.number().int().nonnegative(),
  }).optional(),
}).strict();
