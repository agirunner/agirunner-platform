import { describe, expect, it, vi } from 'vitest';
import { GetObjectCommand } from '@aws-sdk/client-s3';

import { S3ArtifactStorage } from '../../src/content/s3-artifact-storage.js';

describe('S3ArtifactStorage', () => {
  it('stores objects and returns deterministic metadata', async () => {
    const send = vi.fn(async () => ({}));
    const storage = new S3ArtifactStorage(
      {
        bucket: 'artifacts',
        region: 'us-east-1',
        accessKeyId: 'key',
        secretAccessKey: 'secret',
      },
      { client: { send } },
    );

    const stored = await storage.putObject(
      'tenant/workflow/file.txt',
      Buffer.from('hello'),
      'text/plain',
    );

    expect(send).toHaveBeenCalledTimes(1);
    expect(stored).toMatchObject({
      backend: 's3',
      storageKey: 'tenant/workflow/file.txt',
      contentType: 'text/plain',
      sizeBytes: 5,
    });
    expect(stored.checksumSha256).toHaveLength(64);
  });

  it('downloads objects and preserves content type', async () => {
    const send = vi.fn(async () => ({
      ContentType: 'application/json',
      Body: {
        transformToByteArray: async () => Uint8Array.from(Buffer.from('{"ok":true}', 'utf8')),
      },
    }));
    const storage = new S3ArtifactStorage(
      {
        bucket: 'artifacts',
        region: 'us-east-1',
        accessKeyId: 'key',
        secretAccessKey: 'secret',
      },
      { client: { send } },
    );

    const artifact = await storage.getObject('tenant/workflow/out.json');

    expect(artifact.contentType).toBe('application/json');
    expect(artifact.data.toString('utf8')).toBe('{"ok":true}');
  });

  it('creates signed access URLs', async () => {
    const presign = vi.fn(async (_client, command: GetObjectCommand) => {
      const input = command.input as { Bucket?: string; Key?: string };
      return `https://example.test/${input.Bucket}/${input.Key}`;
    });
    const storage = new S3ArtifactStorage(
      {
        bucket: 'artifacts',
        region: 'us-east-1',
        accessKeyId: 'key',
        secretAccessKey: 'secret',
      },
      { client: { send: vi.fn() }, presign },
    );

    const access = await storage.createAccessUrl('tenant/workflow/out.json', 900);

    expect(presign).toHaveBeenCalledTimes(1);
    expect(access.url).toBe('https://example.test/artifacts/tenant/workflow/out.json');
    expect(access.expiresAt).toBeInstanceOf(Date);
  });
});
