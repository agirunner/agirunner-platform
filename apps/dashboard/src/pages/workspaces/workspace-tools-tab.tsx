import { useQuery } from '@tanstack/react-query';

import { dashboardApi } from '../../lib/api.js';
import type { DashboardWorkspaceToolCatalog } from '../../lib/api.js';
import { Badge } from '../../components/ui/badge.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Switch } from '../../components/ui/switch.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table.js';
import { ErrorCard, LoadingCard, WorkspaceMetricCard } from './workspace-detail/workspace-detail-shared.js';

interface ToolEntry {
  name: string;
  isBlocked: boolean;
  data: unknown;
}

export function WorkspaceToolsTab({ workspaceId }: { workspaceId: string }): JSX.Element {
  const { data, isLoading, error } = useQuery({
    queryKey: ['workspace-tools', workspaceId],
    queryFn: () => dashboardApi.listWorkspaceTools(workspaceId),
  });

  if (isLoading) return <LoadingCard />;
  if (error) return <ErrorCard message="Failed to load tools." />;

  const catalog = (data?.data ?? {}) as DashboardWorkspaceToolCatalog;
  const availableTools = Array.isArray(catalog.available) ? catalog.available : [];
  const blockedTools = Array.isArray(catalog.blocked) ? catalog.blocked : [];

  const tools: ToolEntry[] = [
    ...availableTools.map((entry) => ({
      name: typeof entry === 'object' && entry !== null && 'name' in entry ? String((entry as { name: string }).name) : String(entry),
      isBlocked: false,
      data: entry,
    })),
    ...blockedTools.map((entry) => ({
      name: typeof entry === 'object' && entry !== null && 'name' in entry ? String((entry as { name: string }).name) : String(entry),
      isBlocked: true,
      data: entry,
    })),
  ];

  if (tools.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted">
          No tools configured for this workspace.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-border/70 shadow-none">
        <CardHeader className="space-y-2">
          <CardTitle className="text-base">Tool posture</CardTitle>
          <CardDescription>
            Check what the workspace can use right now and which tools remain blocked before an
            operator launches or edits work.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <WorkspaceMetricCard
            label="Available"
            value={`${tools.filter((tool) => !tool.isBlocked).length}`}
            detail="Workspace tools currently enabled for use."
          />
          <WorkspaceMetricCard
            label="Blocked"
            value={`${tools.filter((tool) => tool.isBlocked).length}`}
            detail="Tools explicitly blocked by workspace policy."
          />
          <WorkspaceMetricCard
            label="Catalog size"
            value={`${tools.length}`}
            detail="Combined available and blocked tool records."
          />
        </CardContent>
      </Card>

      <div className="grid gap-3 md:hidden">
        {tools.map((tool) => (
          <Card key={tool.name} className="border-border/70 shadow-none">
            <CardContent className="flex items-start justify-between gap-4 p-4">
              <div className="space-y-2">
                <div className="text-sm font-semibold text-foreground">{tool.name}</div>
                <p className="text-sm text-muted">
                  {tool.isBlocked
                    ? 'Blocked at the workspace layer.'
                    : 'Available to workspace-scoped automation and operator work.'}
                </p>
                <Badge variant={tool.isBlocked ? 'destructive' : 'success'}>
                  {tool.isBlocked ? 'Blocked' : 'Available'}
                </Badge>
              </div>
              <Switch checked={!tool.isBlocked} disabled />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="hidden border-border/70 shadow-none md:block">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tool</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Toggle</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tools.map((tool) => (
                <TableRow key={tool.name}>
                  <TableCell className="font-medium">{tool.name}</TableCell>
                  <TableCell>
                    <Badge variant={tool.isBlocked ? 'destructive' : 'success'}>
                      {tool.isBlocked ? 'Blocked' : 'Available'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Switch checked={!tool.isBlocked} disabled />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
