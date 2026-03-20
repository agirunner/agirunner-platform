import { BrainCircuit, FolderKanban, Settings2, Webhook } from 'lucide-react';
import { Link } from 'react-router-dom';

import type { DashboardWorkspaceRecord } from '../../lib/api.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card.js';
import {
  readWorkspaceStorageLabel,
  type WorkspaceOverview,
} from './workspace-detail-support.js';
import { WorkspaceMetricCard } from './workspace-detail-shared.js';

interface WorkspaceOverviewShellProps {
  workspace: DashboardWorkspaceRecord;
  overview: WorkspaceOverview;
}

const WORKSPACE_ACTIONS = [
  {
    label: 'Settings',
    description: 'Workspace basics, storage configuration, and lifecycle posture.',
    tab: 'settings',
    icon: Settings2,
  },
  {
    label: 'Knowledge',
    description: 'Workspace context, curated knowledge, memory, and run content in one place.',
    tab: 'knowledge',
    icon: BrainCircuit,
  },
  {
    label: 'Automation',
    description: 'Scheduled workflow triggers that stay on the workspace surface.',
    tab: 'automation',
    icon: Webhook,
  },
  {
    label: 'Delivery',
    description: 'Workflow history, current activity, and hand-offs.',
    tab: 'delivery',
    icon: FolderKanban,
  },
] as const;

export function WorkspaceOverviewShell(props: WorkspaceOverviewShellProps): JSX.Element {
  const workspaceLinkState = { workspaceLabel: props.workspace.name };
  const storageLabel = readWorkspaceStorageLabel(props.workspace);

  return (
    <div className="space-y-4">
      <Card className="border-border/70 shadow-none">
        <CardHeader className="space-y-2">
          <CardTitle className="text-base">Workspace Snapshot</CardTitle>
          <CardDescription>{props.overview.summary}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {props.overview.packets.map((packet) => (
            <WorkspaceMetricCard key={packet.label} label={packet.label} value={packet.value} detail={packet.detail} />
          ))}
        </CardContent>
      </Card>

      <Card className="border-border/70 shadow-none">
        <CardHeader className="space-y-2">
          <CardTitle className="text-base">Where To Work Next</CardTitle>
          <CardDescription>
            Start in the main workspaces first, then drop into the explorers only when you need
            raw evidence.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {WORKSPACE_ACTIONS.map((action) => {
              const Icon = action.icon;
              return (
                <Link
                  key={action.tab}
                  to={`/workspaces/${props.workspace.id}?tab=${action.tab}`}
                  state={workspaceLinkState}
                  className="rounded-xl border border-border/70 bg-background/70 p-4 transition-colors hover:border-foreground/20 hover:bg-background"
                >
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <Icon className="h-4 w-4 text-muted" />
                      {action.label}
                    </div>
                    <p className="text-sm leading-6 text-muted">{action.description}</p>
                  </div>
                </Link>
              );
            })}
          </div>
          <p className="text-sm leading-6 text-muted">
            {describeDeliveryFollowUp(storageLabel)}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function describeDeliveryFollowUp(storageLabel: string): string {
  switch (storageLabel) {
    case 'Git Remote':
      return 'Delivery can trace back to the configured Git Remote when a run needs source-level follow-up.';
    case 'Host Directory':
      return 'Delivery follows the configured Host Directory and saved outputs when a run needs filesystem-level follow-up.';
    default:
      return 'Delivery follows saved outputs and workspace artifacts when a run needs follow-up.';
  }
}
