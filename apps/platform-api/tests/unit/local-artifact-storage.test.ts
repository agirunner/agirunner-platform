import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalArtifactStorage } from '../../src/content/local-artifact-storage.js';

describe('LocalArtifactStorage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not leave partial files behind when metadata persistence fails', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'local-artifact-storage-'));
    const storage = new LocalArtifactStorage(rootDir);
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('rename failed'));

    await expect(
      storage.putObject(
        'tenants/tenant-1/workflows/workflow-1/input-packets/packet-1/files/file-1/spec.md',
        Buffer.from('# spec'),
        'text/markdown',
      ),
    ).rejects.toThrow('rename failed');

    await expect(
      fs.access(
        path.join(
          rootDir,
          'tenants/tenant-1/workflows/workflow-1/input-packets/packet-1/files/file-1/spec.md',
        ),
      ),
    ).rejects.toThrow();
  });
});
