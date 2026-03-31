import { lazy } from 'react';
import type { ComponentType } from 'react';

export function lazyWithRetry<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
): React.LazyExoticComponent<T> {
  return lazy(() =>
    factory().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!isChunkLoadError(message)) throw error;

      const reloadKey = 'chunk_reload_ts';
      const lastReload = Number(sessionStorage.getItem(reloadKey) ?? '0');
      if (Date.now() - lastReload < 10_000) throw error;

      sessionStorage.setItem(reloadKey, String(Date.now()));
      window.location.reload();
      return new Promise<never>(() => {});
    }),
  );
}

export function isChunkLoadError(message: string): boolean {
  return (
    message.includes('Failed to fetch dynamically imported module') ||
    message.includes('Loading chunk') ||
    message.includes('Loading CSS chunk') ||
    message.includes('error loading dynamically imported module')
  );
}

export function PageFallback(): JSX.Element {
  return <div className="flex items-center justify-center p-12 text-muted">Loading...</div>;
}

export const LoginPage = lazyWithRetry(() =>
  import('../pages/login/login-page.js').then((m) => ({ default: m.LoginPage })),
);

export const WorkflowsPage = lazyWithRetry(() =>
  import('../pages/workflows/workflows-page.js').then((m) => ({
    default: m.WorkflowsPage,
  })),
);

export const TaskDetailPage = lazyWithRetry(() =>
  import('../pages/task-detail/task-detail-page.js').then((m) => ({ default: m.TaskDetailPage })),
);

export const ArtifactPreviewPage = lazyWithRetry(() =>
  import('../pages/artifact-preview/artifact-preview-page.js').then((m) => ({
    default: m.ArtifactPreviewPage,
  })),
);

export const WorkspaceListPage = lazyWithRetry(() =>
  import('../pages/workspace-list/workspace-list-page.js').then((m) => ({
    default: m.WorkspaceListPage,
  })),
);

export const WorkspaceDetailPage = lazyWithRetry(() =>
  import('../pages/workspace-detail/workspace-detail-page.js').then((m) => ({
    default: m.WorkspaceDetailPage,
  })),
);

export const SpecialistsPage = lazyWithRetry(() =>
  import('../pages/specialists/specialists-page.js').then((m) => ({
    default: m.SpecialistsPage,
  })),
);

export const SkillsPage = lazyWithRetry(() =>
  import('../pages/specialists/skills/skills-page.js').then((m) => ({ default: m.SkillsPage })),
);

export const OrchestratorPage = lazyWithRetry(() =>
  import('../pages/orchestrator/orchestrator-page.js').then((m) => ({
    default: m.OrchestratorPage,
  })),
);

export const ModelsPage = lazyWithRetry(() =>
  import('../pages/models/models-page.js').then((m) => ({
    default: m.ModelsPage,
  })),
);

export const AgenticSettingsPage = lazyWithRetry(() =>
  import('../pages/agentic-settings/agentic-settings-page.js').then((m) => ({
    default: m.AgenticSettingsPage,
  })),
);

export const EnvironmentsPage = lazyWithRetry(() =>
  import('../pages/environments/environments-page.js').then((m) => ({
    default: m.EnvironmentsPage,
  })),
);

export const PlatformSettingsPage = lazyWithRetry(() =>
  import('../pages/platform-settings/platform-settings-page.js').then((m) => ({
    default: m.PlatformSettingsPage,
  })),
);

export const PlatformInstructionsPage = lazyWithRetry(() =>
  import('../pages/platform-instructions/platform-instructions-page.js').then((m) => ({
    default: m.PlatformInstructionsPage,
  })),
);

export const PlaybookListPage = lazyWithRetry(() =>
  import('../pages/playbook-list/playbook-list-page.js').then((m) => ({
    default: m.PlaybookListPage,
  })),
);

export const PlaybookDetailPage = lazyWithRetry(() =>
  import('../pages/playbook-detail/playbook-detail-page.js').then((m) => ({
    default: m.PlaybookDetailPage,
  })),
);

export const ToolsPage = lazyWithRetry(() =>
  import('../pages/tools/tools-page.js').then((m) => ({ default: m.ToolsPage })),
);

export const WebhooksPage = lazyWithRetry(() =>
  import('../pages/webhooks/webhooks-page.js').then((m) => ({ default: m.WebhooksPage })),
);

export const TriggersPage = lazyWithRetry(() =>
  import('../pages/triggers/triggers-page.js').then((m) => ({
    default: m.TriggersPage,
  })),
);

export const McpServersPage = lazyWithRetry(() =>
  import('../pages/mcp-servers/mcp-servers-page.js').then((m) => ({
    default: m.McpServersPage,
  })),
);

export const LiveContainersPage = lazyWithRetry(() =>
  import('../pages/live-containers/live-containers-page.js').then((m) => ({
    default: m.LiveContainersPage,
  })),
);

export const ApiKeysPage = lazyWithRetry(() =>
  import('../pages/api-keys/api-keys-page.js').then((m) => ({
    default: m.ApiKeysPage,
  })),
);

export const GeneralSettingsPage = lazyWithRetry(() =>
  import('../pages/general-settings/general-settings-page.js').then((m) => ({
    default: m.GeneralSettingsPage,
  })),
);

export const LiveLogsPage = lazyWithRetry(() =>
  import('../pages/live-logs/live-logs-page.js').then((m) => ({
    default: m.LiveLogsPage,
  })),
);
