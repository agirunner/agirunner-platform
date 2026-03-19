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

  it('keeps legacy workspace-scoped explorer routes as redirects back to knowledge and deprecated work routes as redirects to execution', () => {
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
    // Work routes are now deprecated — they redirect to the execution canvas
    expect(source).toContain('path="/work/boards/:id/inspector"');
    expect(source).toContain('path="/work/workflows/*"');
    expect(source).toContain('path="/work/boards"');
    expect(source).toContain('path="/work/tasks"');
    expect(source).toContain('path="/work/approvals"');
  });

  it('registers execution canvas routes and redirects deprecated screens to /execution', () => {
    const source = readSource();
    expect(source).toContain('path="/execution"');
    expect(source).toContain('path="/execution/launch"');
    expect(source).toContain('initialAction="launch"');
    expect(source).toContain('Navigate to="/execution" replace');
    expect(source).toContain('path="/mission-control"');
  });

  it('keeps /config/runtimes as the canonical route and redirects the legacy runtime-defaults path', () => {
    const source = readSource();
    expect(source).toContain('path="/config/runtimes"');
    expect(source).toContain('path="/config/runtime-defaults"');
    expect(source).toContain('Navigate to="/config/runtimes" replace');
  });
});
