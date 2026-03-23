import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card.js';
import { type WorkspaceOverview } from './workspace-detail-support.js';
import { WorkspaceMetricCard } from './workspace-detail-shared.js';

interface WorkspaceOverviewShellProps {
  overview: WorkspaceOverview;
}

export function WorkspaceOverviewShell(props: WorkspaceOverviewShellProps): JSX.Element {
  return (
    <Card className="border-border/70 shadow-none">
      <CardHeader className="space-y-2">
        <CardTitle className="text-base">Workspace Snapshot</CardTitle>
        <CardDescription>{props.overview.summary}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-3">
        {props.overview.packets.map((packet) => (
          <WorkspaceMetricCard key={packet.label} label={packet.label} value={packet.value} detail={packet.detail} />
        ))}
      </CardContent>
    </Card>
  );
}
