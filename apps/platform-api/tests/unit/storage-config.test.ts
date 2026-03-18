import { describe, expect, it } from 'vitest';

import { buildArtifactStorageConfig } from '../../src/content/storage-config.js';

describe('buildArtifactStorageConfig', () => {
  it('maps the GCS project env var to gcs.projectId', () => {
    const config = buildArtifactStorageConfig({
      ARTIFACT_STORAGE_BACKEND: 'gcs',
      ARTIFACT_GCS_BUCKET: 'artifacts',
      ARTIFACT_GCS_PROJECT_ID: 'gcp-project-1',
      ARTIFACT_GCS_KEY_FILE: '/tmp/gcp.json',
    });

    expect(config.gcs).toEqual(
      expect.objectContaining({
        bucket: 'artifacts',
        projectId: 'gcp-project-1',
        keyFilename: '/tmp/gcp.json',
      }),
    );
    expect(config.gcs).not.toHaveProperty('workspaceId');
  });
});
