import { useQuery } from '@tanstack/react-query';

import { dashboardApi } from '../../lib/api.js';
import type { DashboardWorkspaceResourceRecord } from '../../lib/api.js';
import { Badge } from '../../components/ui/badge.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table.js';
import { ErrorCard, LoadingCard, WorkspaceMetricCard } from './workspace-detail/workspace-detail-shared.js';

export function WorkspaceResourcesTab({ workspaceId }: { workspaceId: string }): JSX.Element {
  const { data, isLoading, error } = useQuery({
    queryKey: ['workspace-resources', workspaceId],
    queryFn: () => dashboardApi.listWorkspaceResources(workspaceId),
  });

  if (isLoading) return <LoadingCard />;
  if (error) return <ErrorCard message="Failed to load resources." />;

  const resources = (data?.data ?? []) as DashboardWorkspaceResourceRecord[];

  if (resources.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted">
          No resources defined for this workspace.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-border/70 shadow-none">
        <CardHeader className="space-y-2">
          <CardTitle className="text-base">Resource posture</CardTitle>
          <CardDescription>
            Review workspace-scoped resources and metadata without forcing phone-sized operators into
            a dense desktop table.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <WorkspaceMetricCard label="Resources" value={`${resources.length}`} detail="Configured workspace resource records." />
          <WorkspaceMetricCard
            label="Typed resources"
            value={`${resources.filter((resource) => Boolean(resource.type)).length}`}
            detail="Resources with an explicit type label."
          />
          <WorkspaceMetricCard
            label="Described"
            value={`${resources.filter((resource) => Boolean(resource.description)).length}`}
            detail="Resources that already explain operator intent."
          />
          <WorkspaceMetricCard
            label="Metadata"
            value={`${resources.filter((resource) => countRecordEntries(resource.metadata) > 0).length}`}
            detail="Resources carrying structured metadata for downstream automation."
          />
        </CardContent>
      </Card>

      <div className="grid gap-3 md:hidden">
        {resources.map((resource, index) => (
          <Card key={resource.id ?? index} className="border-border/70 shadow-none">
            <CardContent className="grid gap-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold text-foreground">
                  {resource.name ?? resource.id ?? '-'}
                </div>
                <Badge variant="secondary">{resource.type ?? 'Unlabeled'}</Badge>
              </div>
              <p className="text-sm leading-6 text-muted">
                {resource.description ?? 'No resource description is saved yet.'}
              </p>
              <div className="space-y-2 rounded-xl border border-border/70 bg-background/70 p-3">
                <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">
                  Metadata
                </div>
                {resource.metadata && Object.keys(resource.metadata).length > 0 ? (
                  <pre className="overflow-x-auto whitespace-pre-wrap break-all text-xs text-muted">
                    {JSON.stringify(resource.metadata, null, 2)}
                  </pre>
                ) : (
                  <p className="text-sm text-muted">No metadata.</p>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="hidden border-border/70 shadow-none md:block">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Metadata</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {resources.map((resource, index) => (
                <TableRow key={resource.id ?? index}>
                  <TableCell className="font-medium">{resource.name ?? resource.id ?? '-'}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{resource.type ?? '-'}</Badge>
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-sm">{resource.description ?? '-'}</TableCell>
                  <TableCell>
                    {resource.metadata && Object.keys(resource.metadata).length > 0 ? (
                      <pre className="max-w-xs truncate text-xs">{JSON.stringify(resource.metadata)}</pre>
                    ) : (
                      '-'
                    )}
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

function countRecordEntries(value: Record<string, unknown> | null | undefined): number {
  return Object.keys(value ?? {}).length;
}
