import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = resolve(CURRENT_DIR, '../../../../../../..');
const PLAYBOOKS_REPO_ROOT_CANDIDATES = [
  resolve(WORKSPACE_ROOT, '../agirunner/agirunner-playbooks'),
  resolve(WORKSPACE_ROOT, 'agirunner-playbooks'),
];
const PLAYBOOKS_REPO_ROOT = PLAYBOOKS_REPO_ROOT_CANDIDATES.find((path) => existsSync(path))
  ?? PLAYBOOKS_REPO_ROOT_CANDIDATES[0];

export interface CommunityCatalogFixtureServer {
  baseUrl: string;
  repository: string;
  ref: string;
  stop(): Promise<void>;
}

export async function startCommunityCatalogFixtureServer(input?: {
  repository?: string;
  ref?: string;
}): Promise<CommunityCatalogFixtureServer> {
  const repository = input?.repository ?? 'fixtures/agirunner-playbooks';
  const ref = input?.ref ?? 'main';
  const expectedPrefix = `/${repository}/${ref}/`;

  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
      if (!pathname.startsWith(expectedPrefix)) {
        response.writeHead(404).end('not found');
        return;
      }

      const relativePath = pathname.slice(expectedPrefix.length);
      const filePath = resolve(PLAYBOOKS_REPO_ROOT, relativePath);
      if (!filePath.startsWith(PLAYBOOKS_REPO_ROOT)) {
        response.writeHead(403).end('forbidden');
        return;
      }

      const content = await readFile(filePath);
      response.writeHead(200, {
        'content-type': contentTypeFor(relativePath),
      });
      response.end(content);
    } catch {
      response.writeHead(404).end('not found');
    }
  });

  await new Promise<void>((resolveStart) => {
    server.listen(0, '127.0.0.1', () => resolveStart());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    await closeServer(server);
    throw new Error('Failed to start community catalog fixture server');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    repository,
    ref,
    stop: () => closeServer(server),
  };
}

function contentTypeFor(pathname: string): string {
  if (pathname.endsWith('.yaml') || pathname.endsWith('.yml')) {
    return 'application/yaml; charset=utf-8';
  }
  if (pathname.endsWith('.md')) {
    return 'text/markdown; charset=utf-8';
  }
  return 'text/plain; charset=utf-8';
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error) {
        rejectClose(error);
        return;
      }
      resolveClose();
    });
  });
}
