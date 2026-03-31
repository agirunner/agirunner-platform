import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';

import { PLATFORM_API_CONTAINER_NAME } from './platform-env.js';
import { buildContainerDirectoryPath, buildContainerFilePath, shellQuote } from './workflows-common.js';

export function writeSeededArtifactObject(storageKey: string, payload: Buffer, contentType: string): void {
  const containerPath = buildContainerFilePath(storageKey);
  execFileSync(
    'docker',
    [
      'exec',
      '-i',
      PLATFORM_API_CONTAINER_NAME,
      'sh',
      '-lc',
      [
        'set -e',
        `mkdir -p ${shellQuote(buildContainerDirectoryPath(storageKey))}`,
        `cat > ${shellQuote(containerPath)}`,
        `printf %s ${shellQuote(contentType)} > ${shellQuote(`${containerPath}.content-type`)}`,
      ].join(' && '),
    ],
    { input: payload },
  );
}
