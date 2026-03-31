import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import {
  prunePlatformWorkflowArtifactDirectories,
  resolvePlatformArtifactFilePath,
  writePlatformArtifactObject,
} from './platform-artifacts.js';

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
});

describe('platform artifact support', () => {
  it('writes seeded artifacts to the host when the platform container is unavailable', () => {
    const artifactRoot = createTempArtifactRoot();
    const payload = Buffer.from('hello from host fallback', 'utf8');

    writePlatformArtifactObject(
      'tenants/tenant-a/workflows/workflow-a/input-packets/packet-a/files/file-a/brief.md',
      payload,
      'text/markdown',
      {
        artifactLocalRoot: artifactRoot,
        mode: 'host',
      },
    );

    const filePath = resolvePlatformArtifactFilePath(
      'tenants/tenant-a/workflows/workflow-a/input-packets/packet-a/files/file-a/brief.md',
      artifactRoot,
    );
    expect(readFileSync(filePath, 'utf8')).toBe('hello from host fallback');
    expect(readFileSync(`${filePath}.content-type`, 'utf8')).toBe('text/markdown');
  });

  it('prunes only orphaned workflow directories on the host', () => {
    const artifactRoot = createTempArtifactRoot();
    const workflowsRoot = join(artifactRoot, 'tenants', 'tenant-a', 'workflows');
    mkdirSync(join(workflowsRoot, 'workflow-keep'), { recursive: true });
    mkdirSync(join(workflowsRoot, 'workflow-drop'), { recursive: true });

    prunePlatformWorkflowArtifactDirectories('tenant-a', ['workflow-keep'], {
      artifactLocalRoot: artifactRoot,
      mode: 'host',
    });

    expect(existsSync(join(workflowsRoot, 'workflow-keep'))).toBe(true);
    expect(existsSync(join(workflowsRoot, 'workflow-drop'))).toBe(false);
  });
});

function createTempArtifactRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'platform-artifacts-test-'));
  tempRoots.push(root);
  return root;
}
