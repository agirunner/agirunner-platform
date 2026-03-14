import { BrainCircuit, FolderKanban, Settings2, Webhook } from 'lucide-react';
import { Link } from 'react-router-dom';

import type { DashboardProjectRecord } from '../../lib/api.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Badge } from '../../components/ui/badge.js';
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
    label: 'Knowledge',
    description: 'Structured spec, memory, and run content in one place.',
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

const CALM_ATTENTION_BADGE_CLASS_NAME =
  'border-amber-300/60 bg-amber-50/70 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100';
const CALM_ATTENTION_PANEL_CLASS_NAME =
  'rounded-xl border border-amber-300/60 bg-amber-50/70 p-3 text-sm leading-6 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100';

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

      <Card className="border-border/70 shadow-none">
        <CardHeader className="space-y-2">
          <CardTitle className="text-base">Where to work next</CardTitle>
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
          </div>
          {props.project.repository_url ? (
            <p className="text-sm leading-6 text-muted">
              Delivery can trace back to the linked repository when a run or artifact needs
              source-level follow-up.
            </p>
          ) : (
            <div className={CALM_ATTENTION_PANEL_CLASS_NAME}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={CALM_ATTENTION_BADGE_CLASS_NAME}>
                  Needs attention
                </Badge>
              </div>
              <p className="mt-2">
                Add a repository in Settings before you expect delivery or automation to map back
                to source control.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
