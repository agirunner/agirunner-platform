import { execFileSync } from 'node:child_process';

import {
  POSTGRES_CONTAINER_NAME,
  POSTGRES_DB,
  POSTGRES_USER,
} from '../platform-env.js';
import { prunePlatformWorkflowArtifactDirectories } from '../platform-artifacts.js';
import { sqlText, sqlUuid } from '../workflows-common.js';

const NON_LIVE_RUNTIME_CONTAINERS = [
  'orchestrator-primary-0',
  'orchestrator-primary-1',
  'agirunner-platform-container-manager-1',
] as const;

export function ensureNonLiveRuntimeQuiesced(): void {
  const runningContainers = execFileSync(
    'docker',
    ['ps', '--format', '{{.Names}}'],
    { encoding: 'utf8' },
  )
    .split('\n')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const containersToStop = NON_LIVE_RUNTIME_CONTAINERS.filter((name) =>
    runningContainers.includes(name),
  );
  if (containersToStop.length === 0) {
    return;
  }
  execFileSync('docker', ['stop', ...containersToStop], { stdio: 'pipe' });
}

export function pruneOrphanedWorkflowArtifactDirectories(tenantId: string, keepIds: string[]): void {
  prunePlatformWorkflowArtifactDirectories(tenantId, keepIds);
}

export function queryScalarValues(sql: string): string[] {
  return queryRows(sql).map(([value]) => value);
}

export function queryRows(sql: string): string[][] {
  const output = runPsql(sql).trim();
  if (!output) {
    return [];
  }
  return output
    .split('\n')
    .map((line) => line.split('|').map((value) => value.trim()))
    .filter((row) => row.some((value) => value.length > 0));
}

export function runPsql(sql: string): string {
  return execFileSync(
    'docker',
    [
      'exec',
      '-i',
      POSTGRES_CONTAINER_NAME,
      'psql',
      '-v',
      'ON_ERROR_STOP=1',
      '-t',
      '-A',
      '-F',
      '|',
      '-U',
      POSTGRES_USER,
      '-d',
      POSTGRES_DB,
      '-c',
      sql,
    ],
    { encoding: 'utf8' },
  );
}
