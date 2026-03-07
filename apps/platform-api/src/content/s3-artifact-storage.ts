import { createHash } from 'node:crypto';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type {
  ArtifactAccessUrl,
  ArtifactDownload,
  ArtifactObject,
  ArtifactStorageAdapter,
  StoredArtifact,
} from './artifact-storage.js';

export interface S3ArtifactStorageConfig {
  bucket: string;
  region: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

interface S3LikeClient {
  send(command: unknown): Promise<unknown>;
}

type PresignFn = (
  client: S3Client,
  command: GetObjectCommand,
  options: { expiresIn: number },
) => Promise<string>;

export class S3ArtifactStorage implements ArtifactStorageAdapter {
  readonly backend = 's3' as const;

  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly presign: PresignFn;

  constructor(
    config: S3ArtifactStorageConfig,
    options: {
      client?: S3LikeClient;
      presign?: PresignFn;
    } = {},
  ) {
    this.bucket = config.bucket;
    const clientConfig: S3ClientConfig = {
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        sessionToken: config.sessionToken,
      },
    };
    this.client = (options.client as S3Client | undefined) ?? new S3Client(clientConfig);
    this.presign = options.presign ?? getSignedUrl;
  }

  async putObject(key: string, data: Buffer, contentType: string): Promise<StoredArtifact> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
      }),
    );

    return {
      backend: this.backend,
      storageKey: key,
      contentType,
      sizeBytes: data.byteLength,
      checksumSha256: createHash('sha256').update(data).digest('hex'),
    };
  }

  async getObject(key: string): Promise<ArtifactDownload> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
    const body = responseBodyAsBuffer(response);
    return {
      contentType:
        typeof response.ContentType === 'string'
          ? response.ContentType
          : 'application/octet-stream',
      data: await body,
    };
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      return true;
    } catch (error) {
      const metadata = error as { $metadata?: { httpStatusCode?: number } };
      if (metadata.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw error;
    }
  }

  async list(prefix: string): Promise<ArtifactObject[]> {
    const response = await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
      }),
    );
    return (response.Contents ?? [])
      .filter((entry): entry is { Key: string; Size?: number } => typeof entry.Key === 'string')
      .map((entry) => ({
        key: entry.Key,
        sizeBytes: entry.Size ?? 0,
      }));
  }

  async createAccessUrl(key: string, ttlSeconds: number): Promise<ArtifactAccessUrl> {
    const url = await this.presign(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
      { expiresIn: ttlSeconds },
    );
    return {
      url,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    };
  }
}

async function responseBodyAsBuffer(response: unknown): Promise<Buffer> {
  const body = (response as { Body?: unknown }).Body;
  if (!body) {
    return Buffer.alloc(0);
  }
  if (Buffer.isBuffer(body)) {
    return body;
  }
  if (typeof body === 'string') {
    return Buffer.from(body);
  }
  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }

  const sdkStream = body as { transformToByteArray?: () => Promise<Uint8Array> };
  if (typeof sdkStream.transformToByteArray === 'function') {
    return Buffer.from(await sdkStream.transformToByteArray());
  }

  throw new Error('Unsupported S3 object body type');
}
