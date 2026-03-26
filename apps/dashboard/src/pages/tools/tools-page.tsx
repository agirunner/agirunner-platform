import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Wrench } from 'lucide-react';

import { DashboardPageHeader } from '../../components/layout/dashboard-page-header.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table.js';
import { dashboardApi } from '../../lib/api.js';
import { DASHBOARD_BADGE_BASE_CLASS_NAME } from '../../lib/dashboard-badge-palette.js';
import { cn } from '../../lib/utils.js';
import {
  describeToolAccessScope,
  describeToolCategory,
  summarizeTools,
} from './tools-page.support.js';

const toolBadgeClassName = DASHBOARD_BADGE_BASE_CLASS_NAME;

export function ToolsPage(): JSX.Element {
  const { data = [], isLoading, error } = useQuery({
    queryKey: ['tools'],
    queryFn: () => dashboardApi.listToolTags(),
  });

  const summaryCards = useMemo(() => summarizeTools(data), [data]);

  if (isLoading) {
    return <div className="flex items-center justify-center p-12"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>;
  }
  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
          Failed to load tools: {String(error)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <DashboardPageHeader
        navHref="/platform/tools"
        description="These tools include specialist tools for performing tasks, and orchestrator-specific tools for playbook management."
      />

      <div className="grid gap-4 md:grid-cols-3">
        {summaryCards.map((summary) => (
          <Card key={summary.label} className="border-border/70 shadow-sm">
            <CardHeader className="space-y-1">
              <p className="text-sm font-medium text-muted">{summary.label}</p>
              <CardTitle className="text-2xl">{summary.value}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted">{summary.detail}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {data.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center text-muted">
            <Wrench className="h-12 w-12" />
            <p className="font-medium text-foreground">No tools registered</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-border/70 shadow-sm">
          <CardHeader>
            <CardTitle>Tool catalog</CardTitle>
            <CardDescription>
              {data.length} built-in tools across {new Set(data.map((t) => t.category).filter(Boolean)).size} categories.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Access</TableHead>
                  <TableHead>Description</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((tool) => {
                  const category = describeToolCategory(tool.category);
                  const accessScope = describeToolAccessScope(tool);
                  return (
                    <TableRow key={tool.id}>
                      <TableCell className="font-mono text-sm">{tool.id}</TableCell>
                      <TableCell className="font-medium">{tool.name}</TableCell>
                      <TableCell>
                        <span className={cn(toolBadgeClassName, category.badgeClassName)}>
                          {category.label}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className={cn(toolBadgeClassName, accessScope.badgeClassName)}>
                          {accessScope.label}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-foreground">
                        {tool.description?.trim() || '—'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
