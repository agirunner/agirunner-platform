import { LocalArtifactStorage } from './local-artifact-storage.js';
import type { ArtifactStorageAdapter } from './artifact-storage.js';
import { S3ArtifactStorage } from './s3-artifact-storage.js';

export interface ArtifactStorageConfig {
  backend: 'local' | 's3' | 'gcs' | 'azure';
  localRoot: string;
  s3?: {
    bucket: string;
    region: string;
    endpoint?: string;
    forcePathStyle?: boolean;
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
}

export function createArtifactStorage(config: ArtifactStorageConfig): ArtifactStorageAdapter {
  if (config.backend === 'local') {
    return new LocalArtifactStorage(config.localRoot);
  }

  if (config.backend === 's3') {
    if (!config.s3) {
      throw new Error('S3 artifact storage requires S3 configuration');
    }
    return new S3ArtifactStorage(config.s3);
  }

  throw new Error(`Artifact storage backend "${config.backend}" is not implemented yet.`);
}
