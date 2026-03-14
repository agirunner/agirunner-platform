import { BrainCircuit, FolderKanban, PackageSearch, Settings2, Webhook } from 'lucide-react';
import { Link } from 'react-router-dom';

import type { DashboardProjectRecord } from '../../lib/api.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card.js';
import type { ProjectWorkspaceOverview } from './project-detail-support.js';
import { WorkspaceMetricCard } from './project-detail-shared.js';

interface ProjectOverviewShellProps {
  project: DashboardProjectRecord;
  overview: ProjectWorkspaceOverview;
}

const WORKSPACE_ACTIONS = [
  {
    label: 'Settings',
    description: 'Repository link, credentials posture, and project overrides.',
    tab: 'settings',
    icon: Settings2,
  },
  {
    label: 'Knowledge base',
    description: 'Structured spec, memory, and artifacts in one place.',
    tab: 'knowledge',
    icon: BrainCircuit,
  },
  {
    label: 'Automation',
    description: 'Schedules, inbound hooks, and repository trust.',
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

export function ProjectOverviewShell(props: ProjectOverviewShellProps): JSX.Element {
  const projectLinkState = { projectLabel: props.project.name };

  return (
    <div className="space-y-4">
      <Card className="border-border/70 shadow-none">
        <CardHeader className="space-y-2">
          <CardTitle className="text-base">Project snapshot</CardTitle>
          <CardDescription>{props.overview.summary}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {props.overview.packets.map((packet) => (
            <WorkspaceMetricCard key={packet.label} label={packet.label} value={packet.value} detail={packet.detail} />
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.9fr)]">
        <Card className="border-border/70 shadow-none">
          <CardHeader className="space-y-2">
            <CardTitle className="text-base">Where to work next</CardTitle>
            <CardDescription>
              Use the main workspaces below instead of scanning duplicate summaries.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 lg:grid-cols-2">
            {WORKSPACE_ACTIONS.map((action) => {
              const Icon = action.icon;
              return (
                <Link
                  key={action.tab}
                  to={`/projects/${props.project.id}?tab=${action.tab}`}
                  state={projectLinkState}
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
          </CardContent>
        </Card>

        <Card className="border-border/70 shadow-none">
          <CardHeader className="space-y-2">
            <CardTitle className="text-base">Focused explorers</CardTitle>
            <CardDescription>
              Use these only when the Knowledge base is too high-level and you need raw evidence.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              <Link
                to={`/projects/${props.project.id}/memory`}
                state={projectLinkState}
                className="inline-flex items-center gap-2 rounded-sm font-medium text-foreground underline-offset-4 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <BrainCircuit className="h-4 w-4 text-muted" />
                Memory explorer
              </Link>
              <Link
                to={`/projects/${props.project.id}/artifacts`}
                state={projectLinkState}
                className="inline-flex items-center gap-2 rounded-sm font-medium text-foreground underline-offset-4 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <PackageSearch className="h-4 w-4 text-muted" />
                Artifact explorer
              </Link>
            </div>
            {props.project.repository_url ? (
              <p className="leading-6 text-muted">
                Delivery can trace back to the linked repository when a run or artifact needs
                source-level follow-up.
              </p>
            ) : (
              <p className="leading-6 text-muted">
                Add a repository in Settings before you expect delivery or automation to map back
                to source control.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
