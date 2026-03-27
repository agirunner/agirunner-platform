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
    expect(source).toContain('props.title ?? navItem.label');
  });

  it('allows pages to opt into custom description wrapping classes', () => {
    const source = readSource('./dashboard-page-header.tsx');
    expect(source).toContain('descriptionClassName?: string;');
    expect(source).toContain("props.descriptionClassName");
  });

  it('uses the shared nav-backed header for top-level dashboard pages', () => {
    const expectations: Array<[string, string]> = [
      ['../../pages/mission-control/mission-control-page.tsx', 'navHref="/mission-control"'],
      ['../../pages/task-list/task-list-page.tsx', 'navHref="/mission-control/tasks"'],
      ['../../pages/workspace-list/workspace-list-page.tsx', 'navHref="/design/workspaces"'],
      ['../../pages/playbook-list/playbook-list-page.tsx', 'navHref="/design/playbooks"'],
      ['../../pages/role-definitions/role-definitions-page.tsx', 'navHref="/design/specialists"'],
      ['../../pages/llm-providers/llm-providers-page.tsx', 'navHref="/platform/models"'],
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

  it('allows placeholder pages to override the visible page title without changing nav routing', () => {
    const headerSource = readSource('./dashboard-page-header.tsx');
    const placeholderSource = readSource('../../pages/config-placeholder/config-placeholder-page.tsx');
    const webhooksSource = readSource('../../pages/webhooks/webhooks-page.tsx');
    const triggersSource = readSource('../../pages/work-item-triggers/work-item-triggers-page.tsx');

    expect(headerSource).toContain('title?: string;');
    expect(placeholderSource).toContain('title={props.title}');
    expect(webhooksSource).toContain('title="Webhooks"');
    expect(triggersSource).toContain('title="Triggers"');
  });

  it('does not leave mission-control page titles drifting away from the nav label', () => {
    const missionControlSource = readSource('../../pages/mission-control/mission-control-page.tsx');

    expect(missionControlSource).toContain('DashboardPageHeader');
    expect(missionControlSource).toContain('navHref="/mission-control"');
    expect(missionControlSource).toContain('title="Mission Control"');
  });
});
