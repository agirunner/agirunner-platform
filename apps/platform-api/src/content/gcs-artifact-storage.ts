import { createHash } from 'node:crypto';

import { DEFAULT_ARTIFACT_CONTENT_TYPE } from './storage-config.js';
import type {
  ArtifactAccessUrl,
  ArtifactDownload,
  ArtifactObject,
  ArtifactStorageAdapter,
  StoredArtifact,
} from './artifact-storage.js';

export interface GcsArtifactStorageConfig {
  bucket: string;
  projectId?: string;
  keyFilename?: string;
  credentialsJson?: string;
}

interface GcsLikeFile {
  save(data: Buffer, options: { resumable: boolean; contentType: string }): Promise<unknown>;
  download(): Promise<[Buffer]>;
  delete(options?: { ignoreNotFound?: boolean }): Promise<unknown>;
  exists(): Promise<[boolean]>;
  getSignedUrl(options: { version: 'v4'; action: 'read'; expires: number }): Promise<[string]>;
  getMetadata(): Promise<[Record<string, unknown>, unknown?]>;
}

interface GcsLikeBucket {
  file(path: string): GcsLikeFile;
  getFiles(options: {
    prefix: string;
  }): Promise<[Array<{ name: string; metadata?: { size?: string | number } }>, unknown?, unknown?]>;
}

interface GcsLikeStorage {
  bucket(name: string): GcsLikeBucket;
}

export class GcsArtifactStorage implements ArtifactStorageAdapter {
  readonly backend = 'gcs' as const;

  private readonly config: GcsArtifactStorageConfig;
  private bucketInstance: GcsLikeBucket | null = null;

  constructor(config: GcsArtifactStorageConfig, storage?: GcsLikeStorage) {
    this.config = config;
    if (storage) {
      this.bucketInstance = storage.bucket(config.bucket);
    }
  }

  private async getBucket(): Promise<GcsLikeBucket> {
    if (this.bucketInstance) return this.bucketInstance;
    // Dynamic path variable prevents Vite from statically resolving this optional dependency.
    const gcsModule = '@google-cloud/storage';
    const { Storage } = await import(/* @vite-ignore */ gcsModule);
    const client = new Storage(buildStorageOptions(this.config));
    const bucket = client.bucket(this.config.bucket) as GcsLikeBucket;
    this.bucketInstance = bucket;
    return bucket;
  }

  async putObject(key: string, data: Buffer, contentType: string): Promise<StoredArtifact> {
    const bucket = await this.getBucket();
    await bucket.file(key).save(data, { resumable: false, contentType });
    return {
      backend: this.backend,
      storageKey: key,
      contentType,
      sizeBytes: data.byteLength,
      checksumSha256: createHash('sha256').update(data).digest('hex'),
    };
  }

  async getObject(key: string): Promise<ArtifactDownload> {
    const bucket = await this.getBucket();
    const file = bucket.file(key);
    const [[metadata], [data]] = await Promise.all([file.getMetadata(), file.download()]);
    return {
      contentType: stringValue(metadata.contentType) ?? DEFAULT_ARTIFACT_CONTENT_TYPE,
      data,
    };
  }

  async deleteObject(key: string): Promise<void> {
    const bucket = await this.getBucket();
    await bucket.file(key).delete({ ignoreNotFound: true });
  }

  async exists(key: string): Promise<boolean> {
    const bucket = await this.getBucket();
    const [exists] = await bucket.file(key).exists();
    return exists;
  }

  async list(prefix: string): Promise<ArtifactObject[]> {
    const bucket = await this.getBucket();
    const [files] = await bucket.getFiles({ prefix });
    return files.map((file) => ({
      key: file.name,
      sizeBytes: Number(file.metadata?.size ?? 0),
    }));
  }

  async createAccessUrl(key: string, ttlSeconds: number): Promise<ArtifactAccessUrl> {
    const bucket = await this.getBucket();
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const [url] = await bucket.file(key).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: expiresAt.getTime(),
    });
    return { url, expiresAt };
  }
}

function buildStorageOptions(config: GcsArtifactStorageConfig): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  if (config.projectId) {
    options.projectId = config.projectId;
  }
  if (config.keyFilename) {
    options.keyFilename = config.keyFilename;
  }
  if (config.credentialsJson) {
    options.credentials = JSON.parse(config.credentialsJson);
  }
  return options;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
