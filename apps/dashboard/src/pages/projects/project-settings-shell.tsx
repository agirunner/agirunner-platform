import type { ReactNode } from 'react';

import type { DashboardProjectRecord } from '../../lib/api.js';
import type { ProjectWorkspaceOverview } from './project-detail-support.js';

interface ProjectSettingsShellProps {
  project: DashboardProjectRecord;
  overview: ProjectWorkspaceOverview;
  headerAction?: ReactNode;
  children: ReactNode;
}

export function ProjectSettingsShell(props: ProjectSettingsShellProps): JSX.Element {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Settings Control Plane</h2>
          <p className="sr-only">{props.overview.summary}</p>
        </div>
        {props.headerAction ? <div className="shrink-0">{props.headerAction}</div> : null}
      </div>
      {props.children}
    </section>
  );
}
