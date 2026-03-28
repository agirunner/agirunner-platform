import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './app.tsx'), 'utf8');
}

describe('app trigger routes source', () => {
  it('registers the trigger overview route and redirects the legacy path', () => {
    const source = readSource();
    expect(source).toContain('path="/integrations/triggers"');
    expect(source).toContain('path="/config/triggers"');
    expect(source).toContain('path="/config/work-item-triggers"');
    expect(source).toContain('Navigate to="/integrations/triggers" replace');
  });

  it('keeps MCP as the only shipped integration management route and redirects the legacy agent protocols path', () => {
    const source = readSource();
    expect(source).toContain('path="/integrations/mcp-servers"');
    expect(source).toContain('path="/integrations/mcp"');
    expect(source).toContain('path="/integrations/agent-protocols"');
    expect(source).toContain('path="/config/agent-protocols"');
    expect(source).toContain('Navigate to="/integrations/mcp-servers" replace');
    expect(source).not.toContain('path="/integrations/acp"');
    expect(source).not.toContain('AgentProtocolsPage');
    expect(source).not.toContain('AcpPage');
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
    expect(source).toContain('path="/design/workspaces/:id/memory"');
    expect(source).toContain('path="/design/workspaces/:id/content"');
    expect(source).toContain('path="/design/workspaces/:id/artifacts"');
    expect(source).toContain('function LegacyWorkspaceKnowledgeRedirect()');
    expect(source).toContain("const panel = location.pathname.endsWith('/memory')");
    expect(source).toContain("? 'memory'");
    expect(source).toContain("location.pathname.endsWith('/artifacts')");
    expect(source).toContain("? 'artifacts'");
    expect(source).toContain('Navigate to={`/design/workspaces/${id}?tab=knowledge&panel=${panel}`} replace');
    expect(source).toContain('path="/work/workflows/*"');
    expect(source).toContain("const routePrefix = location.pathname.startsWith('/work/workflows')");
    expect(source).toContain("if (segments[1] === 'inspector')");
  });

  it('uses admin-owned general, agentic, and platform settings routes and redirects the legacy platform paths', () => {
    const source = readSource();
    expect(source).toContain("../pages/platform-settings/platform-settings-page.js");
    expect(source).not.toContain("../pages/operations/operations-page.js");
    expect(source).toContain('path="/admin/agentic-settings"');
    expect(source).toContain('path="/admin/platform-settings"');
    expect(source).toContain('path="/admin/general-settings"');
    expect(source).toContain('path="/admin/settings"');
    expect(source).toContain('path="/admin/agent-settings"');
    expect(source).toContain('path="/config/runtimes"');
    expect(source).toContain('path="/config/runtime-defaults"');
    expect(source).toContain('path="/platform/runtimes"');
    expect(source).toContain('path="/platform/operations"');
    expect(source).toContain('Navigate to="/admin/agentic-settings" replace');
    expect(source).toContain('Navigate to="/admin/platform-settings" replace');
    expect(source).toContain('Navigate to="/admin/general-settings" replace');
  });

  it('uses /platform/models as the canonical models route without keeping /platform/routing', () => {
    const source = readSource();
    expect(source).toContain('path="/platform/models"');
    expect(source).toContain('path="/config/llm"');
    expect(source).toContain('Navigate to="/platform/models" replace');
    expect(source).not.toContain('path="/platform/routing"');
  });

  it('uses specialists and live diagnostics as the canonical work-design and diagnostics routes', () => {
    const source = readSource();
    expect(source).toContain('path="/design/specialists"');
    expect(source).toContain('path="/design/roles"');
    expect(source).toContain('function LegacySpecialistsRouteRedirect()');
    expect(source).toContain("location.pathname.replace('/design/roles', '/design/specialists')");
    expect(source).toContain('path="/diagnostics/live-logs"');
    expect(source).toContain('path="/diagnostics/live-containers"');
    expect(source).toContain('path="/diagnostics/logs"');
    expect(source).toContain('path="/diagnostics/containers"');
    expect(source).toContain('path="/logs"');
    expect(source).toContain('path="/fleet/containers"');
    expect(source).toContain('function LegacyLiveLogsRedirect()');
    expect(source).toContain('function LegacyLiveContainersRedirect()');
    expect(source).toContain('/diagnostics/live-logs${location.search}${location.hash}');
    expect(source).toContain('/diagnostics/live-containers${location.search}${location.hash}');
  });

  it('removes deprecated worker, agent, and docker pages in favor of the containers route', () => {
    const source = readSource();
    expect(source).toContain("../pages/containers/containers-page.js");
    expect(source).toContain('path="/diagnostics/containers"');
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

  it('uses only canonical workflows routes for the shipped workflows shell', () => {
    const source = readSource();
    expect(source).toContain("../pages/workflows/workflows-page.js");
    expect(source).toContain('path="/" element={<Navigate to="/workflows" replace />}');
    expect(source).toContain('path="/workflows" element={<WorkflowsPage />}');
    expect(source).toContain('path="/workflows/:workflowId" element={<WorkflowsPage />}');
    expect(source).not.toContain('path="/mission-control"');
    expect(source).not.toContain('LegacyMissionControl');
    expect(source).not.toContain('/mission-control/workflows');
    expect(source).not.toContain('/mission-control/action-queue');
    expect(source).not.toContain('/mission-control/tasks');
    expect(source).not.toContain('/mission-control/costs');
  });

  it('keeps only legacy work board redirects into the workflows shell instead of shipping old mission-control detail routes', () => {
    const source = readSource();
    expect(source).toContain('const target = buildWorkflowDetailPermalink(workflowId, {');
    expect(source).toContain('path="/work/boards/*"');
    expect(source).toContain('path="/work/workflows/*"');
    expect(source).not.toContain('/mission-control/workflows/:id');
    expect(source).not.toContain('/mission-control/workflows/:id/inspector');
  });
});
