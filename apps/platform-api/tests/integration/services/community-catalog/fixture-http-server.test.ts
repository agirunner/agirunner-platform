import { afterEach, describe, expect, it } from 'vitest';

import {
  startCommunityCatalogFixtureServer,
  type CommunityCatalogFixtureServer,
} from './fixture-http-server.js';

let fixtureServer: CommunityCatalogFixtureServer | undefined;

afterEach(async () => {
  await fixtureServer?.stop();
  fixtureServer = undefined;
});

describe('startCommunityCatalogFixtureServer', () => {
  it('serves a self-contained catalog fixture without an external playbooks checkout', async () => {
    fixtureServer = await startCommunityCatalogFixtureServer();

    const response = await fetch(
      `${fixtureServer.baseUrl}/${fixtureServer.repository}/${fixtureServer.ref}/catalog/playbooks.yaml`,
    );

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('id: fixture-bug-fix');
    expect(body).toContain('id: fixture-follow-up');
    expect(body).toContain('id: fixture-regression-sweep');
  });
});
