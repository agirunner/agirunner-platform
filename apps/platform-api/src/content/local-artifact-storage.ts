import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { DEFAULT_ARTIFACT_CONTENT_TYPE } from './storage-config.js';
import type {
  ArtifactAccessUrl,
  ArtifactDownload,
  ArtifactObject,
  ArtifactStorageAdapter,
  StoredArtifact,
} from './artifact-storage.js';

export class LocalArtifactStorage implements ArtifactStorageAdapter {
  readonly backend = 'local' as const;

  constructor(private readonly rootDir: string) {}

  async putObject(key: string, data: Buffer, contentType: string): Promise<StoredArtifact> {
    const filePath = this.resolvePath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const stagingSuffix = `${randomUUID()}.tmp`;
    const stagedFilePath = `${filePath}.${stagingSuffix}`;
    const stagedContentTypePath = `${filePath}.content-type.${stagingSuffix}`;

    try {
      await fs.writeFile(stagedFilePath, data);
      await fs.writeFile(stagedContentTypePath, contentType);
      await fs.rename(stagedFilePath, filePath);
      await fs.rename(stagedContentTypePath, `${filePath}.content-type`);
    } catch (error) {
      await Promise.allSettled([
        fs.rm(stagedFilePath, { force: true }),
        fs.rm(stagedContentTypePath, { force: true }),
        fs.rm(filePath, { force: true }),
        fs.rm(`${filePath}.content-type`, { force: true }),
      ]);
      throw error;
    }

    return {
      backend: this.backend,
      storageKey: key,
      contentType,
      sizeBytes: data.byteLength,
      checksumSha256: createHash('sha256').update(data).digest('hex'),
    };
  }

  async getObject(key: string): Promise<ArtifactDownload> {
    const filePath = this.resolvePath(key);
    const [data, contentType] = await Promise.all([
      fs.readFile(filePath),
      this.readContentType(filePath),
    ]);
    return { data, contentType };
  }

  async deleteObject(key: string): Promise<void> {
    const filePath = this.resolvePath(key);
    await Promise.all([
      fs.rm(filePath, { force: true }),
      fs.rm(`${filePath}.content-type`, { force: true }),
    ]);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolvePath(key));
      return true;
    } catch {
      return false;
    }
  }

  async list(prefix: string): Promise<ArtifactObject[]> {
    const dirPath = this.resolvePath(prefix);
    const files = await walkFiles(dirPath, prefix);
    return files;
  }

  async createAccessUrl(key: string, ttlSeconds: number): Promise<ArtifactAccessUrl> {
    return {
      url: `local:${key}`,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    };
  }

  private resolvePath(key: string): string {
    const safeKey = key
      .split('/')
      .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
      .join('/');
    return path.join(this.rootDir, safeKey);
  }

  private async readContentType(filePath: string): Promise<string> {
    const contentTypePath = `${filePath}.content-type`;
    try {
      return (await fs.readFile(contentTypePath, 'utf8')).trim() || DEFAULT_ARTIFACT_CONTENT_TYPE;
    } catch {
      return DEFAULT_ARTIFACT_CONTENT_TYPE;
    }
  }
}

async function walkFiles(baseDir: string, prefix: string): Promise<ArtifactObject[]> {
  try {
    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map(async (entry) => {
        const filePath = path.join(baseDir, entry.name);
        const childKey = `${prefix.replace(/\/$/, '')}/${entry.name}`.replace(/^\/+/, '');
        if (entry.isDirectory()) {
          return walkFiles(filePath, childKey);
        }
        if (entry.name.endsWith('.content-type')) {
          return [];
        }
        const stats = await fs.stat(filePath);
        return [{ key: childKey, sizeBytes: stats.size }];
      }),
    );
    return nested.flat();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}
