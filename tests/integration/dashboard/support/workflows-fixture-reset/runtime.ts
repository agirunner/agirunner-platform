import { execFileSync } from 'node:child_process';

import {
  PLATFORM_API_CONTAINER_NAME,
  POSTGRES_CONTAINER_NAME,
  POSTGRES_DB,
  POSTGRES_USER,
} from '../platform-env.js';
import { shellQuote, sqlText, sqlUuid } from '../workflows-common.js';

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
  const script = `
set -eu
root=${shellQuote(`/artifacts/tenants/${tenantId}/workflows`)}
[ -d "$root" ] || exit 0
keep_ids=${shellQuote(keepIds.join('\n'))}
find "$root" -mindepth 1 -maxdepth 1 -type d | while IFS= read -r workflow_dir; do
  workflow_id="$(basename "$workflow_dir")"
  if ! printf '%s\\n' "$keep_ids" | grep -Fxq "$workflow_id"; then
    rm -rf "$workflow_dir"
  fi
done
`;

  execFileSync(
    'docker',
    ['exec', '-i', PLATFORM_API_CONTAINER_NAME, 'sh', '-lc', script],
    { stdio: 'pipe' },
  );
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
