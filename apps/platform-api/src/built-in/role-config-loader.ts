import http from 'node:http';
import https from 'node:https';

import {
  loadBuiltInRolesConfig,
  resolveProvider,
  resolveProviderApiKey,
  type BuiltInRolesConfig,
  type LlmProvider,
  type RoleDefinition,
  type RoleName,
} from './role-config.js';

interface DbRoleRow {
  name: string;
  description: string | null;
  system_prompt: string | null;
  allowed_tools: string[];
  model_preference: string | null;
  verification_strategy: string | null;
  capabilities: string[];
}

interface RoleConfigResolution {
  rolesConfig: BuiltInRolesConfig;
  source: 'database' | 'file';
}

/**
 * Loads role config from the platform API (DB-backed), falling back to
 * the local JSON file if the API is unreachable or returns no roles.
 */
export async function loadRoleConfig(
  apiBaseUrl: string,
  apiKey: string,
): Promise<RoleConfigResolution> {
  try {
    const dbRoles = await fetchRolesFromApi(apiBaseUrl, apiKey);
    if (dbRoles.length > 0) {
      const fileConfig = loadBuiltInRolesConfig();
      const roles = buildRolesFromDb(dbRoles, fileConfig);
      return {
        rolesConfig: { ...fileConfig, roles },
        source: 'database',
      };
    }
  } catch {
    // API not available — fall back to file
  }

  return {
    rolesConfig: loadBuiltInRolesConfig(),
    source: 'file',
  };
}

async function fetchRolesFromApi(apiBaseUrl: string, apiKey: string): Promise<DbRoleRow[]> {
  return new Promise((resolve, reject) => {
    const url = new URL('/api/v1/config/roles?activeOnly=true', apiBaseUrl);
    const isHttps = url.protocol === 'https:';
    const requestModule = isHttps ? https : http;

    const req = requestModule.get(
      {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 5000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => {
          if ((res.statusCode ?? 500) >= 400) {
            reject(new Error(`API returned ${res.statusCode}`));
            return;
          }
          try {
            const parsed = JSON.parse(data) as { data?: DbRoleRow[] };
            resolve(parsed.data ?? []);
          } catch (e) {
            reject(e);
          }
        });
      },
    );

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

function buildRolesFromDb(
  dbRows: DbRoleRow[],
  fileConfig: BuiltInRolesConfig,
): Record<RoleName, RoleDefinition> {
  const roles = { ...fileConfig.roles };

  for (const row of dbRows) {
    const roleName = row.name as RoleName;
    roles[roleName] = {
      description: row.description ?? '',
      systemPrompt: row.system_prompt ?? '',
      allowedTools: row.allowed_tools,
      modelPreference: row.model_preference ?? fileConfig.providers[fileConfig.defaultProvider].defaultModel,
      verificationStrategy: row.verification_strategy ?? 'structured_review',
      capabilities: row.capabilities,
    };
  }

  return roles;
}

export { resolveProvider, resolveProviderApiKey };
export type { BuiltInRolesConfig, LlmProvider };
