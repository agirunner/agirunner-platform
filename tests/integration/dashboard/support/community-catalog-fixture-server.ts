import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  COMMUNITY_CATALOG_FIXTURE_BASE_URL,
  COMMUNITY_CATALOG_FIXTURE_PORT,
  COMMUNITY_CATALOG_FIXTURE_REF,
  COMMUNITY_CATALOG_FIXTURE_REPOSITORY,
  COMMUNITY_CATALOG_REPO_ROOT,
} from './community-catalog-stack.constants.js';

export interface CommunityCatalogFixtureServer {
  baseUrl: string;
  ref: string;
  repository: string;
  stop(): Promise<void>;
}

export async function startDashboardCommunityCatalogFixtureServer(): Promise<CommunityCatalogFixtureServer> {
  const expectedPrefix = `/${COMMUNITY_CATALOG_FIXTURE_REPOSITORY}/${COMMUNITY_CATALOG_FIXTURE_REF}/`;
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url ?? '/', COMMUNITY_CATALOG_FIXTURE_BASE_URL).pathname;
      if (!pathname.startsWith(expectedPrefix)) {
        response.writeHead(404).end('not found');
        return;
      }

      const relativePath = pathname.slice(expectedPrefix.length);
      const filePath = resolve(COMMUNITY_CATALOG_REPO_ROOT, relativePath);
      if (!filePath.startsWith(COMMUNITY_CATALOG_REPO_ROOT)) {
        response.writeHead(403).end('forbidden');
        return;
      }

      const content = await readFile(filePath);
      response.writeHead(200, { 'content-type': contentTypeFor(relativePath) });
      response.end(content);
    } catch {
      response.writeHead(404).end('not found');
    }
  });

  await new Promise<void>((resolveStart) => {
    server.listen(COMMUNITY_CATALOG_FIXTURE_PORT, '127.0.0.1', () => resolveStart());
  });

  return {
    baseUrl: COMMUNITY_CATALOG_FIXTURE_BASE_URL,
    repository: COMMUNITY_CATALOG_FIXTURE_REPOSITORY,
    ref: COMMUNITY_CATALOG_FIXTURE_REF,
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
