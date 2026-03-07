export type ArtifactStorageBackend = 'local' | 's3' | 'gcs' | 'azure';

export interface StoredArtifact {
  backend: ArtifactStorageBackend;
  storageKey: string;
  contentType: string;
  sizeBytes: number;
  checksumSha256: string;
}

export interface ArtifactObject {
  key: string;
  sizeBytes: number;
}

export interface ArtifactDownload {
  contentType: string;
  data: Buffer;
}

export interface ArtifactAccessUrl {
  url: string;
  expiresAt?: Date;
}

export interface ArtifactStorageAdapter {
  readonly backend: ArtifactStorageBackend;
  putObject(key: string, data: Buffer, contentType: string): Promise<StoredArtifact>;
  getObject(key: string): Promise<ArtifactDownload>;
  deleteObject(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  list(prefix: string): Promise<ArtifactObject[]>;
  createAccessUrl(key: string, ttlSeconds: number): Promise<ArtifactAccessUrl>;
}
