import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

function readSource(relativePath: string): string {
  return readFileSync(resolve(import.meta.dirname, relativePath), 'utf8');
}

describe('dashboard page header consistency', () => {
  it('renders nav-backed page headers with monochrome icons', () => {
    const source = readSource('./dashboard-page-header.tsx');
    expect(source).toContain('findNavigationItemByHref');
    expect(source).toContain('text-muted-foreground');
    expect(source).toContain('navItem.label');
  });

  it('uses the shared nav-backed header for top-level dashboard pages', () => {
    const expectations: Array<[string, string]> = [
      ['../../pages/workflow-list/workflow-list-page.tsx', 'navHref="/mission-control/workflows"'],
      ['../../pages/task-list/task-list-page.tsx', 'navHref="/mission-control/tasks"'],
      ['../../pages/live-board/live-board-page.tsx', 'navHref="/mission-control"'],
      ['../../pages/alerts-approvals/alerts-approvals-page.tsx', 'navHref="/mission-control/action-queue"'],
      ['../../pages/workspace-list/workspace-list-page.tsx', 'navHref="/design/workspaces"'],
      ['../../pages/playbook-list/playbook-list-page.tsx', 'navHref="/design/playbooks"'],
      ['../../pages/role-definitions/role-definitions-page.tsx', 'navHref="/design/specialists"'],
      ['../../pages/llm-providers/llm-providers-page.tsx', 'navHref="/platform/routing"'],
      ['../../pages/platform-instructions/platform-instructions-page.tsx', 'navHref="/platform/instructions"'],
      ['../../pages/orchestrator/orchestrator-page.tsx', 'navHref="/platform/orchestrator"'],
      ['../../pages/execution-environments/execution-environments-page.tsx', 'navHref="/platform/environments"'],
      ['../../pages/tools/tools-page.tsx', 'navHref="/platform/tools"'],
      ['../../pages/containers/containers-page.tsx', 'navHref="/diagnostics/live-containers"'],
      ['../../pages/settings/settings-page.tsx', 'navHref="/admin/general-settings"'],
      ['../../pages/runtimes/runtime-defaults-editor-page.tsx', 'navHref={props.navHref}'],
      ['../../pages/api-key/api-key-page.sections.tsx', 'navHref="/admin/api-keys"'],
      ['../../pages/config-placeholder/config-placeholder-page.tsx', 'navHref={props.navHref}'],
    ];

    for (const [relativePath, expectedNavHref] of expectations) {
      const source = readSource(relativePath);
      expect(source).toContain('DashboardPageHeader');
      expect(source).toContain(expectedNavHref);
    }
  });

  it('does not leave mission-control page titles drifting away from the nav label', () => {
    const liveBoardSource = readSource('../../pages/live-board/live-board-page.tsx');
    const actionQueueSource = readSource('../../pages/alerts-approvals/alerts-approvals-page.tsx');

    expect(liveBoardSource).toContain('DashboardPageHeader');
    expect(liveBoardSource).toContain('navHref="/mission-control"');
    expect(actionQueueSource).toContain('DashboardPageHeader');
    expect(actionQueueSource).toContain('navHref="/mission-control/action-queue"');
  });
});
