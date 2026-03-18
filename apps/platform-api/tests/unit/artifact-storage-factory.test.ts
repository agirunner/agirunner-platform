import { describe, expect, it } from 'vitest';

import { createArtifactStorage } from '../../src/content/storage-factory.js';
import { AzureArtifactStorage } from '../../src/content/azure-artifact-storage.js';
import { GcsArtifactStorage } from '../../src/content/gcs-artifact-storage.js';
import { LocalArtifactStorage } from '../../src/content/local-artifact-storage.js';
import { S3ArtifactStorage } from '../../src/content/s3-artifact-storage.js';

describe('artifact storage factory', () => {
  it('creates the local backend by default', () => {
    const storage = createArtifactStorage({
      backend: 'local',
      localRoot: '/tmp/test-artifacts',
    });

    expect(storage).toBeInstanceOf(LocalArtifactStorage);
  });

  it('creates the S3 backend when configured', () => {
    const storage = createArtifactStorage({
      backend: 's3',
      localRoot: '/tmp/ignored',
      s3: {
        bucket: 'artifacts',
        region: 'us-east-1',
        accessKeyId: 'key',
        secretAccessKey: 'secret',
      },
    });

    expect(storage).toBeInstanceOf(S3ArtifactStorage);
  });

  it('creates the GCS backend when configured', () => {
    const storage = createArtifactStorage({
      backend: 'gcs',
      localRoot: '/tmp/ignored',
      gcs: {
        bucket: 'artifacts',
        workspaceId: 'proj',
      },
    });

    expect(storage).toBeInstanceOf(GcsArtifactStorage);
    expect(storage.backend).toBe('gcs');
  });

  it('creates the Azure backend when configured', () => {
    const storage = createArtifactStorage({
      backend: 'azure',
      localRoot: '/tmp/ignored',
      azure: {
        accountName: 'artifacts',
        container: 'runs',
        accountKey: 'secret',
      },
    });

    expect(storage).toBeInstanceOf(AzureArtifactStorage);
  });
});
