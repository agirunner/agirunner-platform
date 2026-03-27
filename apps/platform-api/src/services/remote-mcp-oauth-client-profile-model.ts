import { z } from 'zod';

const optionalUrl = z.preprocess(
  (value) => (typeof value === 'string' && value.trim().length === 0 ? null : value),
  z.string().url().nullable().optional(),
);

const optionalText = z.preprocess(
  (value) => (typeof value === 'string' && value.trim().length === 0 ? null : value),
  z.string().nullable().optional(),
);

const stringList = z.array(z.string().min(1)).default([]);

export const remoteMcpOAuthClientProfileCallbackModeSchema = z.enum(['loopback', 'hosted_https']);
export const remoteMcpOAuthClientProfileTokenEndpointAuthMethodSchema = z.enum([
  'none',
  'client_secret_post',
  'client_secret_basic',
  'private_key_jwt',
]);

export const remoteMcpOAuthClientProfileCreateSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).default(''),
  issuer: optionalText,
  authorizationEndpoint: optionalUrl,
  tokenEndpoint: z.string().url(),
  registrationEndpoint: optionalUrl,
  deviceAuthorizationEndpoint: optionalUrl,
  callbackMode: remoteMcpOAuthClientProfileCallbackModeSchema.default('loopback'),
  tokenEndpointAuthMethod: remoteMcpOAuthClientProfileTokenEndpointAuthMethodSchema.default('none'),
  clientId: z.string().min(1).max(500),
  clientSecret: optionalText,
  defaultScopes: stringList,
  defaultResourceIndicators: stringList,
  defaultAudiences: stringList,
}).strict();

export const remoteMcpOAuthClientProfileUpdateSchema = remoteMcpOAuthClientProfileCreateSchema.partial().strict();

export type RemoteMcpOAuthClientProfileCreateInput = z.input<typeof remoteMcpOAuthClientProfileCreateSchema>;
export type RemoteMcpOAuthClientProfileUpdateInput = z.input<typeof remoteMcpOAuthClientProfileUpdateSchema>;
