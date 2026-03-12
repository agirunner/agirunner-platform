import fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { taskPlatformRoutes } from '../../src/api/routes/task-platform.routes.js';

describe('task platform routes', () => {
  let app: ReturnType<typeof fastify> | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('registers artifact catalog preview and permalink endpoints', async () => {
    app = fastify();
    app.decorate('pgPool', {} as never);
    app.decorate('projectService', {} as never);
    app.decorate('config', {
      ARTIFACT_STORAGE_BACKEND: 'local',
      ARTIFACT_LOCAL_ROOT: '/tmp/artifacts',
      ARTIFACT_ACCESS_URL_TTL_SECONDS: 900,
      ARTIFACT_PREVIEW_MAX_BYTES: 1024,
    } as never);

    await app.register(taskPlatformRoutes);

    const routes = app.printRoutes();
    expect(routes).toContain('artifact-catalog (GET, HEAD)');
    expect(routes).toContain('review (GET, HEAD)');
    expect(routes).toContain('ermalink (GET, HEAD)');
  });
});
