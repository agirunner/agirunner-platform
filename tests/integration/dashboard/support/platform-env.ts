import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(CURRENT_DIR, '../../../..');
const ENV_PATH = resolve(REPO_ROOT, '.env');

const envEntries = parseDotEnv(readFileSync(ENV_PATH, 'utf8'));

export const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';
export const DASHBOARD_BASE_URL = `http://localhost:${readPlatformEnv('DASHBOARD_PORT', '3000')}`;
export const PLATFORM_API_URL = `http://localhost:${readPlatformEnv('PLATFORM_API_PORT', '8080')}`;
export const PLATFORM_API_CONTAINER_NAME = 'agirunner-platform-platform-api-1';
export const PLATFORM_ARTIFACT_LOCAL_ROOT = readPlatformEnv(
  'ARTIFACT_LOCAL_ROOT',
  resolve(REPO_ROOT, 'tmp/integration-artifacts'),
);
export const POSTGRES_CONTAINER_NAME = 'agirunner-platform-postgres-1';
export const POSTGRES_DB = readPlatformEnv('POSTGRES_DB', 'agirunner');
export const POSTGRES_USER = readPlatformEnv('POSTGRES_USER', 'agirunner');
export const ADMIN_API_KEY = readPlatformEnv('DEFAULT_ADMIN_API_KEY');

export function readPlatformEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? envEntries[name];
  if (value && value.length > 0) {
    return value;
  }
  if (fallback !== undefined) {
    return fallback;
  }
  throw new Error(`Missing ${name} in ${ENV_PATH}`);
}

function parseDotEnv(source: string): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const rawLine of source.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    entries[key] = value;
  }
  return entries;
}
