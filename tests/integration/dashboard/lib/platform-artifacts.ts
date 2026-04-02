import { execFileSync as execFileSyncDefault } from 'node:child_process';
import {
  existsSync as existsSyncDefault,
  mkdirSync as mkdirSyncDefault,
  readdirSync as readdirSyncDefault,
  rmSync as rmSyncDefault,
  writeFileSync as writeFileSyncDefault,
} from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  PLATFORM_API_CONTAINER_NAME,
  PLATFORM_ARTIFACT_LOCAL_ROOT,
} from './platform-env.js';
import { shellQuote } from './workflows-common.js';

type ExecFileSync = typeof execFileSyncDefault;

interface HostArtifactFs {
  existsSync: typeof existsSyncDefault;
  mkdirSync: typeof mkdirSyncDefault;
  readdirSync: typeof readdirSyncDefault;
  rmSync: typeof rmSyncDefault;
  writeFileSync: typeof writeFileSyncDefault;
}

interface PlatformArtifactOptions {
  artifactLocalRoot?: string;
  containerName?: string;
  execFileSync?: ExecFileSync;
  fs?: HostArtifactFs;
  mode?: 'auto' | 'container' | 'host';
}

const DEFAULT_FS: HostArtifactFs = {
  existsSync: existsSyncDefault,
  mkdirSync: mkdirSyncDefault,
  readdirSync: readdirSyncDefault,
  rmSync: rmSyncDefault,
  writeFileSync: writeFileSyncDefault,
};

export function writePlatformArtifactObject(
  storageKey: string,
  payload: Buffer,
  contentType: string,
  options: PlatformArtifactOptions = {},
): void {
  if (shouldUseContainerArtifacts(options)) {
    writeContainerArtifactObject(storageKey, payload, contentType, options);
    return;
  }

  writeHostArtifactObject(storageKey, payload, contentType, options);
}

export function prunePlatformWorkflowArtifactDirectories(
  tenantId: string,
  keepIds: string[],
  options: PlatformArtifactOptions = {},
): void {
  if (shouldUseContainerArtifacts(options)) {
    pruneContainerWorkflowArtifactDirectories(tenantId, keepIds, options);
    return;
  }

  pruneHostWorkflowArtifactDirectories(tenantId, keepIds, options);
}

export function resolvePlatformArtifactFilePath(
  storageKey: string,
  artifactLocalRoot = PLATFORM_ARTIFACT_LOCAL_ROOT,
): string {
  return resolve(artifactLocalRoot, storageKey);
}

function writeContainerArtifactObject(
  storageKey: string,
  payload: Buffer,
  contentType: string,
  options: PlatformArtifactOptions,
): void {
  const containerPath = `/artifacts/${storageKey}`;
  getExecFileSync(options)(
    'docker',
    [
      'exec',
      '-i',
      options.containerName ?? PLATFORM_API_CONTAINER_NAME,
      'sh',
      '-lc',
      [
        'set -e',
        `mkdir -p ${shellQuote(dirname(containerPath))}`,
        `cat > ${shellQuote(containerPath)}`,
        `printf %s ${shellQuote(contentType)} > ${shellQuote(`${containerPath}.content-type`)}`,
      ].join(' && '),
    ],
    { input: payload },
  );
}

function writeHostArtifactObject(
  storageKey: string,
  payload: Buffer,
  contentType: string,
  options: PlatformArtifactOptions,
): void {
  const fs = options.fs ?? DEFAULT_FS;
  const filePath = resolvePlatformArtifactFilePath(
    storageKey,
    options.artifactLocalRoot ?? PLATFORM_ARTIFACT_LOCAL_ROOT,
  );
  fs.mkdirSync(dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, payload);
  fs.writeFileSync(`${filePath}.content-type`, contentType, 'utf8');
}

function pruneContainerWorkflowArtifactDirectories(
  tenantId: string,
  keepIds: string[],
  options: PlatformArtifactOptions,
): void {
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

  getExecFileSync(options)(
    'docker',
    [
      'exec',
      '-i',
      options.containerName ?? PLATFORM_API_CONTAINER_NAME,
      'sh',
      '-lc',
      script,
    ],
    { stdio: 'pipe' },
  );
}

function pruneHostWorkflowArtifactDirectories(
  tenantId: string,
  keepIds: string[],
  options: PlatformArtifactOptions,
): void {
  const fs = options.fs ?? DEFAULT_FS;
  const root = resolveWorkflowArtifactTenantRoot(
    tenantId,
    options.artifactLocalRoot ?? PLATFORM_ARTIFACT_LOCAL_ROOT,
  );
  if (!fs.existsSync(root)) {
    return;
  }

  const keepSet = new Set(keepIds);
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || keepSet.has(entry.name)) {
      continue;
    }
    fs.rmSync(resolve(root, entry.name), { recursive: true, force: true });
  }
}

function resolveWorkflowArtifactTenantRoot(
  tenantId: string,
  artifactLocalRoot: string,
): string {
  return resolve(artifactLocalRoot, 'tenants', tenantId, 'workflows');
}

function shouldUseContainerArtifacts(options: PlatformArtifactOptions): boolean {
  if (options.mode === 'container') {
    return true;
  }
  if (options.mode === 'host') {
    return false;
  }

  try {
    return getExecFileSync(options)(
      'docker',
      [
        'inspect',
        '-f',
        '{{.State.Running}}',
        options.containerName ?? PLATFORM_API_CONTAINER_NAME,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    )
      .trim()
      .toLowerCase() === 'true';
  } catch {
    return false;
  }
}

function getExecFileSync(options: PlatformArtifactOptions): ExecFileSync {
  return options.execFileSync ?? execFileSyncDefault;
}
