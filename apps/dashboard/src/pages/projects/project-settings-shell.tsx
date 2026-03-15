import type { ReactNode } from 'react';

import type { DashboardProjectRecord } from '../../lib/api.js';
import type { ProjectWorkspaceOverview } from './project-detail-support.js';

interface ProjectSettingsShellProps {
  project: DashboardProjectRecord;
  overview: ProjectWorkspaceOverview;
  children: ReactNode;
}

export function ProjectSettingsShell(props: ProjectSettingsShellProps): JSX.Element {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Settings Control Plane</h2>
        <p className="sr-only">{props.overview.summary}</p>
      </div>
      {props.children}
    </section>
  );
}
