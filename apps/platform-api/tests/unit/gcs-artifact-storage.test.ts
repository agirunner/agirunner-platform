import { describe, expect, it } from 'vitest';

import { GcsArtifactStorage } from '../../src/content/gcs-artifact-storage.js';

class FakeGcsFile {
  saved?: { data: Buffer; contentType: string };
  deleted = false;
  present = true;
  metadata: Record<string, unknown> = {};
  payload = Buffer.alloc(0);
  signedUrl = 'https://storage.example.com/object';

  async save(data: Buffer, options: { resumable: boolean; contentType: string }): Promise<void> {
    this.saved = { data, contentType: options.contentType };
  }

  async download(): Promise<[Buffer]> {
    return [this.payload];
  }

  async delete(): Promise<void> {
    this.deleted = true;
  }

  async exists(): Promise<[boolean]> {
    return [this.present];
  }

  async getSignedUrl(): Promise<[string]> {
    return [this.signedUrl];
  }

  async getMetadata(): Promise<[Record<string, unknown>]> {
    return [this.metadata];
  }
}

class FakeGcsBucket {
  readonly files = new Map<string, FakeGcsFile>();
  listed: Array<{ name: string; metadata?: { size?: string } }> = [];

  file(path: string): FakeGcsFile {
    const file = this.files.get(path);
    if (file) {
      return file;
    }

    const created = new FakeGcsFile();
    this.files.set(path, created);
    return created;
  }

  async getFiles(): Promise<[Array<{ name: string; metadata?: { size?: string } }>]> {
    return [this.listed];
  }
}

class FakeGcsStorage {
  constructor(private readonly bucketInstance: FakeGcsBucket) {}

  bucket(): FakeGcsBucket {
    return this.bucketInstance;
  }
}

describe('GcsArtifactStorage', () => {
  it('stores artifacts and returns metadata', async () => {
    const bucket = new FakeGcsBucket();
    const storage = new GcsArtifactStorage({ bucket: 'artifacts' }, new FakeGcsStorage(bucket));
    const data = Buffer.from('artifact-data');

    const stored = await storage.putObject('runs/task/output.txt', data, 'text/plain');

    expect(bucket.file('runs/task/output.txt').saved).toEqual({
      data,
      contentType: 'text/plain',
    });
    expect(stored.backend).toBe('gcs');
    expect(stored.storageKey).toBe('runs/task/output.txt');
    expect(stored.sizeBytes).toBe(data.byteLength);
  });

  it('downloads artifacts and falls back to the default content type', async () => {
    const bucket = new FakeGcsBucket();
    const file = bucket.file('runs/task/output.txt');
    file.payload = Buffer.from('report');
    const storage = new GcsArtifactStorage({ bucket: 'artifacts' }, new FakeGcsStorage(bucket));

    const artifact = await storage.getObject('runs/task/output.txt');

    expect(artifact).toEqual({
      contentType: 'application/octet-stream',
      data: Buffer.from('report'),
    });
  });

  it('lists, checks existence, deletes, and signs access URLs', async () => {
    const bucket = new FakeGcsBucket();
    bucket.listed = [{ name: 'runs/task/output.txt', metadata: { size: '42' } }];
    const file = bucket.file('runs/task/output.txt');
    file.signedUrl = 'https://signed.example.com/object';
    const storage = new GcsArtifactStorage({ bucket: 'artifacts' }, new FakeGcsStorage(bucket));

    await expect(storage.exists('runs/task/output.txt')).resolves.toBe(true);
    await expect(storage.list('runs/')).resolves.toEqual([
      { key: 'runs/task/output.txt', sizeBytes: 42 },
    ]);
    await expect(storage.createAccessUrl('runs/task/output.txt', 60)).resolves.toMatchObject({
      url: 'https://signed.example.com/object',
    });

    await storage.deleteObject('runs/task/output.txt');

    expect(file.deleted).toBe(true);
  });
});
