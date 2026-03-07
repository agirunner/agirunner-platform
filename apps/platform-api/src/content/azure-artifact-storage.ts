import { createHash } from 'node:crypto';

import {
  BlobSASPermissions,
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
} from '@azure/storage-blob';

import { DEFAULT_ARTIFACT_CONTENT_TYPE } from './storage-config.js';
import type {
  ArtifactAccessUrl,
  ArtifactDownload,
  ArtifactObject,
  ArtifactStorageAdapter,
  StoredArtifact,
} from './artifact-storage.js';

export interface AzureArtifactStorageConfig {
  accountName: string;
  container: string;
  connectionString?: string;
  accountKey?: string;
}

interface AzureLikeBlockBlobClient {
  uploadData(
    data: Buffer,
    options: { blobHTTPHeaders: { blobContentType: string } },
  ): Promise<unknown>;
  download(): Promise<{ readableStreamBody?: NodeJS.ReadableStream; contentType?: string }>;
  deleteIfExists(): Promise<unknown>;
  exists(): Promise<boolean>;
  url: string;
}

interface AzureLikeContainerClient {
  getBlockBlobClient(name: string): AzureLikeBlockBlobClient;
  listBlobsFlat(options: {
    prefix: string;
  }): AsyncIterable<{ name: string; properties?: { contentLength?: number } }>;
}

interface AzureLikeBlobServiceClient {
  getContainerClient(name: string): AzureLikeContainerClient;
}

export class AzureArtifactStorage implements ArtifactStorageAdapter {
  readonly backend = 'azure' as const;

  private readonly container: AzureLikeContainerClient;
  private readonly accountName: string;
  private readonly accountKey?: string;
  private readonly containerName: string;

  constructor(config: AzureArtifactStorageConfig, client?: AzureLikeBlobServiceClient) {
    const serviceClient =
      client ??
      (config.connectionString
        ? BlobServiceClient.fromConnectionString(config.connectionString)
        : new BlobServiceClient(
            `https://${config.accountName}.blob.core.windows.net`,
            new StorageSharedKeyCredential(config.accountName, config.accountKey ?? ''),
          ));
    this.container = serviceClient.getContainerClient(config.container);
    this.accountName = config.accountName;
    this.accountKey = config.accountKey;
    this.containerName = config.container;
  }

  async putObject(key: string, data: Buffer, contentType: string): Promise<StoredArtifact> {
    await this.container.getBlockBlobClient(key).uploadData(data, {
      blobHTTPHeaders: { blobContentType: contentType },
    });
    return {
      backend: this.backend,
      storageKey: key,
      contentType,
      sizeBytes: data.byteLength,
      checksumSha256: createHash('sha256').update(data).digest('hex'),
    };
  }

  async getObject(key: string): Promise<ArtifactDownload> {
    const response = await this.container.getBlockBlobClient(key).download();
    return {
      contentType: response.contentType ?? DEFAULT_ARTIFACT_CONTENT_TYPE,
      data: await streamToBuffer(response.readableStreamBody),
    };
  }

  async deleteObject(key: string): Promise<void> {
    await this.container.getBlockBlobClient(key).deleteIfExists();
  }

  async exists(key: string): Promise<boolean> {
    return this.container.getBlockBlobClient(key).exists();
  }

  async list(prefix: string): Promise<ArtifactObject[]> {
    const items: ArtifactObject[] = [];
    for await (const blob of this.container.listBlobsFlat({ prefix })) {
      items.push({
        key: blob.name,
        sizeBytes: blob.properties?.contentLength ?? 0,
      });
    }
    return items;
  }

  async createAccessUrl(key: string, ttlSeconds: number): Promise<ArtifactAccessUrl> {
    const blobClient = this.container.getBlockBlobClient(key);
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    if (!this.accountKey) {
      return { url: blobClient.url, expiresAt };
    }
    const sas = generateBlobSASQueryParameters(
      {
        containerName: this.containerName,
        blobName: key,
        permissions: BlobSASPermissions.parse('r'),
        expiresOn: expiresAt,
      },
      new StorageSharedKeyCredential(this.accountName, this.accountKey),
    ).toString();
    return { url: `${blobClient.url}?${sas}`, expiresAt };
  }
}

async function streamToBuffer(stream?: NodeJS.ReadableStream): Promise<Buffer> {
  if (!stream) {
    return Buffer.alloc(0);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
