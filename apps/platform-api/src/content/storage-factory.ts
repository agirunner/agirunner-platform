import { LocalArtifactStorage } from './local-artifact-storage.js';
import type { ArtifactStorageAdapter } from './artifact-storage.js';

export interface ArtifactStorageConfig {
  backend: 'local' | 's3' | 'gcs' | 'azure';
  localRoot: string;
}

export function createArtifactStorage(config: ArtifactStorageConfig): ArtifactStorageAdapter {
  if (config.backend === 'local') {
    return new LocalArtifactStorage(config.localRoot);
  }

  throw new Error(`Artifact storage backend "${config.backend}" is not implemented yet.`);
}
