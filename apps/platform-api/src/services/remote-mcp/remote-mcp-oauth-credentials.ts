import type { DatabaseQueryable } from '../../db/database.js';
import { ValidationError } from '../../errors/domain-errors.js';
import type {
  RemoteMcpOAuthConfigRecord,
  RemoteMcpOAuthCredentialsRecord,
} from '../remote-mcp-model.js';
import { refreshRemoteMcpAccessToken } from '../remote-mcp-oauth-http.js';
import {
  decryptRemoteMcpSecret,
  encryptRemoteMcpSecret,
} from '../remote-mcp-secret-crypto.js';
import { isExpired } from './remote-mcp-oauth-helpers.js';

export type AuthorizationSecretInput = {
  id: string;
  oauthConfig: RemoteMcpOAuthConfigRecord | null;
  oauthCredentials: RemoteMcpOAuthCredentialsRecord | null;
};

export async function resolveStoredAuthorizationSecret(
  pool: DatabaseQueryable,
  server: AuthorizationSecretInput,
): Promise<string> {
  const authorizationValue = await resolveVerificationAuthorizationValue(pool, server);
  return encryptRemoteMcpSecret(authorizationValue);
}

export async function resolveVerificationAuthorizationValue(
  pool: DatabaseQueryable,
  server: AuthorizationSecretInput,
): Promise<string> {
  if (!server.oauthConfig || !server.oauthCredentials) {
    throw new ValidationError('Remote MCP OAuth server is missing a stored OAuth connection');
  }
  if (server.oauthCredentials.needsReauth) {
    throw new ValidationError('Remote MCP OAuth server requires reconnection');
  }
  const credentials = await ensureValidOauthCredentials(
    pool,
    server.id,
    server.oauthConfig,
    server.oauthCredentials,
  );
  const tokenType = credentials.tokenType?.trim() || 'Bearer';
  const accessToken = decryptRemoteMcpSecret(credentials.accessToken);
  return `${tokenType} ${accessToken}`;
}

async function ensureValidOauthCredentials(
  pool: DatabaseQueryable,
  serverId: string,
  oauthConfig: RemoteMcpOAuthConfigRecord,
  oauthCredentials: RemoteMcpOAuthCredentialsRecord,
): Promise<RemoteMcpOAuthCredentialsRecord> {
  if (!isExpired(oauthCredentials.expiresAt ?? null)) {
    return oauthCredentials;
  }
  if (!oauthCredentials.refreshToken) {
    const disconnected = { ...oauthCredentials, needsReauth: true };
    await persistOauthCredentials(pool, serverId, disconnected);
    throw new ValidationError('Remote MCP OAuth connection expired and must be reconnected');
  }
  const refreshed = await refreshRemoteMcpAccessToken(oauthConfig, oauthCredentials.refreshToken);
  const next = {
    accessToken: encryptRemoteMcpSecret(refreshed.access_token.trim()),
    refreshToken: refreshed.refresh_token?.trim()
      ? encryptRemoteMcpSecret(refreshed.refresh_token.trim())
      : oauthCredentials.refreshToken,
    expiresAt: typeof refreshed.expires_in === 'number' && Number.isFinite(refreshed.expires_in)
      ? Date.now() + (refreshed.expires_in * 1000)
      : oauthCredentials.expiresAt,
    tokenType: refreshed.token_type?.trim() || oauthCredentials.tokenType || 'Bearer',
    scope: refreshed.scope?.trim() || oauthCredentials.scope,
    authorizedAt: new Date().toISOString(),
    authorizedByUserId: oauthCredentials.authorizedByUserId,
    needsReauth: false,
  };
  await persistOauthCredentials(pool, serverId, next);
  return next;
}

async function persistOauthCredentials(
  pool: DatabaseQueryable,
  serverId: string,
  oauthCredentials: RemoteMcpOAuthCredentialsRecord,
): Promise<void> {
  await pool.query(
    `UPDATE remote_mcp_servers
        SET oauth_credentials = $2::jsonb,
            updated_at = now()
      WHERE id = $1`,
    [serverId, JSON.stringify(oauthCredentials)],
  );
}
