import { z } from 'zod';

const optionalUrl = z.preprocess(
  (value) => (typeof value === 'string' && value.trim().length === 0 ? null : value),
  z.string().url().nullable().optional(),
);

export const remoteMcpTransportPreferenceSchema = z
  .enum(['auto', 'streamable_http', 'http_sse_compat'])
  .default('auto');

export const remoteMcpParameterPlacementSchema = z.enum([
  'path',
  'query',
  'header',
  'cookie',
  'initialize_param',
  'authorize_request_query',
  'token_request_header',
  'token_request_body_form',
  'token_request_body_json',
]);

export const remoteMcpParameterSchema = z.object({
  placement: remoteMcpParameterPlacementSchema,
  key: z.string().min(1).max(200),
  valueKind: z.enum(['static', 'secret']),
  value: z.string(),
}).strict();

export const remoteMcpOauthGrantTypeSchema = z.enum([
  'authorization_code',
  'device_authorization',
  'client_credentials',
  'enterprise_managed_authorization',
]);

export const remoteMcpOauthClientStrategySchema = z.enum([
  'auto',
  'dynamic_registration',
  'client_metadata_document',
  'manual_client',
]);

export const remoteMcpOauthCallbackModeSchema = z.enum([
  'loopback',
  'hosted_https',
]);

export const remoteMcpOauthTokenEndpointAuthMethodSchema = z.enum([
  'none',
  'client_secret_post',
  'client_secret_basic',
  'private_key_jwt',
]);

export const remoteMcpOauthParModeSchema = z.enum([
  'disabled',
  'enabled',
  'required',
]);

export const remoteMcpOauthJarModeSchema = z.enum([
  'disabled',
  'request_parameter',
  'request_uri',
]);

export const remoteMcpOauthDefinitionSchema = z.object({
  grantType: remoteMcpOauthGrantTypeSchema.default('authorization_code'),
  clientStrategy: remoteMcpOauthClientStrategySchema.default('auto'),
  callbackMode: remoteMcpOauthCallbackModeSchema.default('loopback'),
  clientId: z.string().min(1).nullable().optional(),
  clientSecret: z.string().min(1).nullable().optional(),
  tokenEndpointAuthMethod: remoteMcpOauthTokenEndpointAuthMethodSchema.default('none'),
  authorizationEndpointOverride: optionalUrl,
  tokenEndpointOverride: optionalUrl,
  registrationEndpointOverride: optionalUrl,
  deviceAuthorizationEndpointOverride: optionalUrl,
  protectedResourceMetadataUrlOverride: optionalUrl,
  authorizationServerMetadataUrlOverride: optionalUrl,
  scopes: z.array(z.string().min(1)).default([]),
  resourceIndicators: z.array(z.string().min(1)).default([]),
  audiences: z.array(z.string().min(1)).default([]),
  enterpriseProfile: z.record(z.unknown()).nullable().optional(),
  parMode: remoteMcpOauthParModeSchema.default('disabled'),
  jarMode: remoteMcpOauthJarModeSchema.default('disabled'),
  privateKeyPem: z.string().min(1).nullable().optional(),
}).strict();

export const remoteMcpOauthConfigSchema = z.object({
  issuer: z.string().min(1).nullable().optional(),
  authorizationEndpoint: z.string().min(1),
  tokenEndpoint: z.string().min(1),
  registrationEndpoint: z.string().min(1).nullable().optional(),
  deviceAuthorizationEndpoint: z.string().min(1).nullable().optional(),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1).nullable().optional(),
  tokenEndpointAuthMethod: remoteMcpOauthTokenEndpointAuthMethodSchema,
  clientIdMetadataDocumentUrl: z.string().min(1).nullable().optional(),
  redirectUri: z.string().min(1),
  scopes: z.array(z.string().min(1)).default([]),
  resource: z.string().min(1),
  resourceIndicators: z.array(z.string().min(1)).default([]),
  audiences: z.array(z.string().min(1)).default([]),
}).strict();

export const remoteMcpOauthCredentialsSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1).nullable().optional(),
  expiresAt: z.number().int().nullable().optional(),
  tokenType: z.string().min(1).nullable().optional(),
  scope: z.string().min(1).nullable().optional(),
  authorizedAt: z.string().min(1),
  authorizedByUserId: z.string().min(1),
  needsReauth: z.boolean().default(false),
}).strict();

export type RemoteMcpTransportPreference = z.infer<typeof remoteMcpTransportPreferenceSchema>;
export type RemoteMcpParameterInput = z.input<typeof remoteMcpParameterSchema>;
export type RemoteMcpOauthDefinition = {
  grantType?: z.infer<typeof remoteMcpOauthGrantTypeSchema>;
  clientStrategy?: z.infer<typeof remoteMcpOauthClientStrategySchema>;
  callbackMode?: z.infer<typeof remoteMcpOauthCallbackModeSchema>;
  clientId?: string | null;
  clientSecret?: string | null;
  tokenEndpointAuthMethod?: z.infer<typeof remoteMcpOauthTokenEndpointAuthMethodSchema>;
  authorizationEndpointOverride?: string | null;
  tokenEndpointOverride?: string | null;
  registrationEndpointOverride?: string | null;
  deviceAuthorizationEndpointOverride?: string | null;
  protectedResourceMetadataUrlOverride?: string | null;
  authorizationServerMetadataUrlOverride?: string | null;
  scopes?: string[];
  resourceIndicators?: string[];
  audiences?: string[];
  enterpriseProfile?: Record<string, unknown> | null;
  parMode?: z.infer<typeof remoteMcpOauthParModeSchema>;
  jarMode?: z.infer<typeof remoteMcpOauthJarModeSchema>;
  privateKeyPem?: string | null;
};
export type RemoteMcpOAuthConfigRecord = z.infer<typeof remoteMcpOauthConfigSchema>;
export type RemoteMcpOAuthCredentialsRecord = z.infer<typeof remoteMcpOauthCredentialsSchema>;
