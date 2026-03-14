import type { ReactNode } from 'react';

import type { DashboardProjectRecord } from '../../lib/api.js';
import { Badge } from '../../components/ui/badge.js';
import type { ProjectWorkspaceOverview } from './project-detail-support.js';

interface ProjectSettingsShellProps {
  project: DashboardProjectRecord;
  overview: ProjectWorkspaceOverview;
  children: ReactNode;
}

export function ProjectSettingsShell(props: ProjectSettingsShellProps): JSX.Element {
  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-foreground">Settings control plane</h2>
          <p className="max-w-3xl text-sm leading-6 text-muted">{props.overview.summary}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={props.project.is_active ? 'success' : 'secondary'}>
            {props.project.is_active ? 'Live project' : 'Inactive project'}
          </Badge>
          {props.project.git_webhook_secret_configured ? (
            <Badge variant="outline">Repository trust configured</Badge>
          ) : null}
        </div>
      </div>
      {props.children}
    </section>
  );
}
