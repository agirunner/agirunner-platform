import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  COMMUNITY_CATALOG_ADMIN_API_KEY,
  COMMUNITY_CATALOG_ARTIFACT_LOCAL_ROOT,
  COMMUNITY_CATALOG_DASHBOARD_PORT,
  COMMUNITY_CATALOG_PLATFORM_PORT,
  COMMUNITY_CATALOG_POSTGRES_CONTAINER_NAME,
} from './community-catalog-stack.constants.js';

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(CURRENT_DIR, '../../../..');
const ENV_PATH = resolveEnvPath();
const envEntries = ENV_PATH ? parseEnvSource(readFileSync(ENV_PATH, 'utf8')) : {};
const IS_LOCAL_PLAYWRIGHT_STACK = process.env.PLAYWRIGHT_SKIP_WEBSERVER === '0';
const LOCAL_PLAYWRIGHT_PLATFORM_API_TARGET =
  'agirunner-platform-community-catalog-e2e-platform-api';

export const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';
export const PLATFORM_API_CONTAINER_NAME = readPlatformTargetName(
  'PLATFORM_API_CONTAINER_NAME',
  'agirunner-platform-platform-api-1',
  LOCAL_PLAYWRIGHT_PLATFORM_API_TARGET,
);
const platformContainerEnvEntries = loadPlatformContainerEnvEntries(PLATFORM_API_CONTAINER_NAME);
export const DASHBOARD_BASE_URL = `http://localhost:${readPlatformEnv('DASHBOARD_PORT', String(COMMUNITY_CATALOG_DASHBOARD_PORT))}`;
export const PLATFORM_API_URL = `http://localhost:${readPlatformEnv('PLATFORM_API_PORT', String(COMMUNITY_CATALOG_PLATFORM_PORT))}`;
export const PLATFORM_ARTIFACT_LOCAL_ROOT = readPlatformEnv(
  'ARTIFACT_LOCAL_ROOT',
  resolve(REPO_ROOT, 'tmp/integration-artifacts'),
);
export const POSTGRES_CONTAINER_NAME = readPlatformTargetName(
  'POSTGRES_CONTAINER_NAME',
  'agirunner-platform-postgres-1',
  COMMUNITY_CATALOG_POSTGRES_CONTAINER_NAME,
);
export const POSTGRES_DB = readPlatformEnv('POSTGRES_DB', 'agirunner');
export const POSTGRES_USER = readPlatformEnv('POSTGRES_USER', 'agirunner');
export const ADMIN_API_KEY = readPlatformEnv('DEFAULT_ADMIN_API_KEY');

export function readPlatformEnv(name: string, fallback?: string): string {
  const processValue = process.env[name];
  if (processValue && processValue.length > 0) {
    return processValue;
  }
  const stackFallback = fallbackForLocalPlaywrightStack(name);
  if (stackFallback !== undefined) {
    return stackFallback;
  }
  const containerValue = platformContainerEnvEntries[name];
  if (containerValue && containerValue.length > 0) {
    return containerValue;
  }
  const envValue = envEntries[name];
  if (envValue && envValue.length > 0) {
    return envValue;
  }
  if (fallback !== undefined) {
    return fallback;
  }
  throw new Error(`Missing ${name} in ${ENV_PATH ?? 'process environment'}`);
}

function readPlatformTargetName(
  name: string,
  defaultValue: string,
  localPlaywrightValue: string,
): string {
  const processValue = process.env[name];
  if (processValue && processValue.length > 0) {
    return processValue;
  }
  if (IS_LOCAL_PLAYWRIGHT_STACK) {
    return localPlaywrightValue;
  }
  return defaultValue;
}

function parseEnvSource(source: string): Record<string, string> {
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

function loadPlatformContainerEnvEntries(containerName: string): Record<string, string> {
  if (IS_LOCAL_PLAYWRIGHT_STACK || containerName.length === 0) {
    return {};
  }

  try {
    const source = execFileSync(
      'docker',
      ['inspect', '-f', '{{range .Config.Env}}{{println .}}{{end}}', containerName],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return parseEnvSource(source);
  } catch {
    return {};
  }
}

function resolveEnvPath(): string | null {
  const primary = resolve(REPO_ROOT, '.env');
  if (existsSync(primary)) {
    return primary;
  }
  const example = resolve(REPO_ROOT, '.env.example');
  if (existsSync(example)) {
    return example;
  }
  return null;
}

function fallbackForLocalPlaywrightStack(name: string): string | undefined {
  if (!IS_LOCAL_PLAYWRIGHT_STACK) {
    return undefined;
  }
  if (name === 'DEFAULT_ADMIN_API_KEY') {
    return COMMUNITY_CATALOG_ADMIN_API_KEY;
  }
  if (name === 'DASHBOARD_PORT') {
    return String(COMMUNITY_CATALOG_DASHBOARD_PORT);
  }
  if (name === 'PLATFORM_API_PORT') {
    return String(COMMUNITY_CATALOG_PLATFORM_PORT);
  }
  if (name === 'ARTIFACT_LOCAL_ROOT') {
    return COMMUNITY_CATALOG_ARTIFACT_LOCAL_ROOT;
  }
  return undefined;
}
