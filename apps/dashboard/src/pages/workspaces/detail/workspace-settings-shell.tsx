import type { ReactNode } from 'react';

import type { DashboardWorkspaceRecord } from '../../lib/api.js';
import type { WorkspaceOverview } from './workspace-detail-support.js';

interface WorkspaceSettingsShellProps {
  workspace: DashboardWorkspaceRecord;
  overview: WorkspaceOverview;
  headerAction?: ReactNode;
  headerFeedback?: ReactNode;
  children: ReactNode;
}

export function WorkspaceSettingsShell(props: WorkspaceSettingsShellProps): JSX.Element {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Settings</h2>
          <p className="sr-only">{props.overview.summary}</p>
        </div>
        {props.headerAction ? <div className="shrink-0">{props.headerAction}</div> : null}
      </div>
      {props.headerFeedback}
      {props.children}
    </section>
  );
}
