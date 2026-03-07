import { Readable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { AzureArtifactStorage } from '../../src/content/azure-artifact-storage.js';

class FakeAzureBlobClient {
  uploaded?: { data: Buffer; contentType: string };
  deleted = false;
  present = true;
  contentType?: string;
  payload = Buffer.alloc(0);

  constructor(readonly url: string) {}

  async uploadData(
    data: Buffer,
    options: { blobHTTPHeaders: { blobContentType: string } },
  ): Promise<void> {
    this.uploaded = { data, contentType: options.blobHTTPHeaders.blobContentType };
  }

  async download(): Promise<{ readableStreamBody?: NodeJS.ReadableStream; contentType?: string }> {
    return {
      readableStreamBody: Readable.from([this.payload]),
      contentType: this.contentType,
    };
  }

  async deleteIfExists(): Promise<void> {
    this.deleted = true;
  }

  async exists(): Promise<boolean> {
    return this.present;
  }
}

class FakeAzureContainerClient {
  readonly blobs = new Map<string, FakeAzureBlobClient>();
  listed: Array<{ name: string; properties?: { contentLength?: number } }> = [];

  getBlockBlobClient(name: string): FakeAzureBlobClient {
    const client = this.blobs.get(name);
    if (client) {
      return client;
    }

    const created = new FakeAzureBlobClient(`https://blob.example.com/${name}`);
    this.blobs.set(name, created);
    return created;
  }

  async *listBlobsFlat(): AsyncIterable<{ name: string; properties?: { contentLength?: number } }> {
    for (const blob of this.listed) {
      yield blob;
    }
  }
}

class FakeAzureBlobServiceClient {
  constructor(private readonly containerClient: FakeAzureContainerClient) {}

  getContainerClient(): FakeAzureContainerClient {
    return this.containerClient;
  }
}

describe('AzureArtifactStorage', () => {
  it('stores artifacts and returns metadata', async () => {
    const container = new FakeAzureContainerClient();
    const storage = new AzureArtifactStorage(
      { accountName: 'acct', container: 'artifacts', accountKey: 'key' },
      new FakeAzureBlobServiceClient(container),
    );
    const data = Buffer.from('artifact-data');

    const stored = await storage.putObject('runs/task/output.txt', data, 'text/plain');

    expect(container.getBlockBlobClient('runs/task/output.txt').uploaded).toEqual({
      data,
      contentType: 'text/plain',
    });
    expect(stored.backend).toBe('azure');
    expect(stored.storageKey).toBe('runs/task/output.txt');
    expect(stored.sizeBytes).toBe(data.byteLength);
  });

  it('downloads artifacts and falls back to the default content type', async () => {
    const container = new FakeAzureContainerClient();
    const blob = container.getBlockBlobClient('runs/task/output.txt');
    blob.payload = Buffer.from('report');
    const storage = new AzureArtifactStorage(
      { accountName: 'acct', container: 'artifacts', accountKey: 'key' },
      new FakeAzureBlobServiceClient(container),
    );

    const artifact = await storage.getObject('runs/task/output.txt');

    expect(artifact).toEqual({
      contentType: 'application/octet-stream',
      data: Buffer.from('report'),
    });
  });

  it('lists, checks existence, deletes, and returns access URLs', async () => {
    const container = new FakeAzureContainerClient();
    container.listed = [{ name: 'runs/task/output.txt', properties: { contentLength: 24 } }];
    const blob = container.getBlockBlobClient('runs/task/output.txt');
    const storage = new AzureArtifactStorage(
      { accountName: 'acct', container: 'artifacts', accountKey: 'key' },
      new FakeAzureBlobServiceClient(container),
    );

    await expect(storage.exists('runs/task/output.txt')).resolves.toBe(true);
    await expect(storage.list('runs/')).resolves.toEqual([
      { key: 'runs/task/output.txt', sizeBytes: 24 },
    ]);
    await expect(storage.createAccessUrl('runs/task/output.txt', 60)).resolves.toMatchObject({
      url: expect.stringContaining('https://blob.example.com/runs/task/output.txt?'),
    });

    await storage.deleteObject('runs/task/output.txt');

    expect(blob.deleted).toBe(true);
  });
});
