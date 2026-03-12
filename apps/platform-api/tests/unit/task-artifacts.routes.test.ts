import fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { taskArtifactRoutes } from '../../src/api/routes/task-artifacts.routes.js';

describe('task artifact routes', () => {
  let app: ReturnType<typeof fastify> | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('registers preview and permalink endpoints', async () => {
    app = fastify();
    app.decorate('pgPool', {} as never);
    app.decorate('config', {
      ARTIFACT_STORAGE_BACKEND: 'local',
      ARTIFACT_LOCAL_ROOT: '/tmp/artifacts',
      ARTIFACT_ACCESS_URL_TTL_SECONDS: 900,
      ARTIFACT_PREVIEW_MAX_BYTES: 1024,
    } as never);

    await app.register(taskArtifactRoutes);

    const routes = app.printRoutes();
    expect(routes).toContain(':artifactId (GET, HEAD, DELETE)');
    expect(routes).toContain('review (GET, HEAD)');
    expect(routes).toContain('ermalink (GET, HEAD)');
  });
});
