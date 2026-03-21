import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './app.tsx'), 'utf8');
}

describe('app trigger routes source', () => {
  it('registers the trigger overview route and redirects the legacy path', () => {
    const source = readSource();
    expect(source).toContain('path="/config/triggers"');
    expect(source).toContain('path="/config/work-item-triggers"');
    expect(source).toContain('Navigate to="/config/triggers" replace');
  });

  it('keeps the browser auth callback free of token query parsing', () => {
    const source = readSource();
    expect(source).toContain('completeSsoBrowserSession');
    expect(source).toContain('resolveAuthCallbackSession');
    expect(source).toContain('apiBaseUrl: API_BASE_URL');
    expect(source).not.toContain("searchParams.get('access_token')");
    expect(source).not.toContain("searchParams.get('refresh_token')");
    expect(source).not.toContain("searchParams.get('tenant_id')");
    expect(source).not.toContain("localStorage.setItem('refresh_token'");
  });

  it('keeps legacy workspace-scoped explorer routes as redirects back to knowledge and preserves inspector routes', () => {
    const source = readSource();
    expect(source).toContain('path="/workspaces/:id/memory"');
    expect(source).toContain('path="/workspaces/:id/content"');
    expect(source).toContain('path="/workspaces/:id/artifacts"');
    expect(source).toContain('function LegacyWorkspaceKnowledgeRedirect()');
    expect(source).toContain("const panel = location.pathname.endsWith('/memory')");
    expect(source).toContain("? 'memory'");
    expect(source).toContain("location.pathname.endsWith('/artifacts')");
    expect(source).toContain("? 'artifacts'");
    expect(source).toContain('Navigate to={`/workspaces/${id}?tab=knowledge&panel=${panel}`} replace');
    expect(source).toContain('path="/work/boards/:id/inspector"');
    expect(source).toContain('path="/work/workflows/*"');
    expect(source).toContain("replace('/work/workflows', '/work/boards')");
  });

  it('keeps /config/runtimes as the canonical route and redirects the legacy runtime-defaults path', () => {
    const source = readSource();
    expect(source).toContain('path="/config/runtimes"');
    expect(source).toContain('path="/config/runtime-defaults"');
    expect(source).toContain('Navigate to="/config/runtimes" replace');
  });

  it('removes deprecated worker, agent, and docker pages in favor of the containers route', () => {
    const source = readSource();
    expect(source).toContain("../pages/fleet/containers-page.js");
    expect(source).toContain('path="/fleet/containers"');
    expect(source).not.toContain("../pages/fleet/worker-list-page.js");
    expect(source).not.toContain("../pages/fleet/warm-pools-page.js");
    expect(source).not.toContain("../pages/fleet/fleet-status-page.js");
    expect(source).not.toContain("../pages/fleet/agent-list-page.js");
    expect(source).not.toContain("../pages/fleet/docker-page.js");
    expect(source).not.toContain('path="/fleet/workers"');
    expect(source).not.toContain('path="/fleet/warm-pools"');
    expect(source).not.toContain('path="/fleet/status"');
    expect(source).not.toContain('path="/fleet/agents"');
    expect(source).not.toContain('path="/fleet/docker"');
  });

  it('removes the deprecated orchestrator grants dashboard route', () => {
    const source = readSource();
    expect(source).not.toContain("../pages/governance/orchestrator-grants-page.js");
    expect(source).not.toContain('path="/governance/grants"');
  });
});
