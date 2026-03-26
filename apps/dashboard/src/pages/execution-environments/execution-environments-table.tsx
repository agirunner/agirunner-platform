import { Archive, CheckCircle2, Pencil, RotateCcw, SearchCheck, Star } from 'lucide-react';

import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
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
import type { DashboardExecutionEnvironmentRecord } from '../../lib/api.js';

export function ExecutionEnvironmentTable(props: {
  environments: DashboardExecutionEnvironmentRecord[];
  busyEnvironmentId: string | null;
  onEdit: (environment: DashboardExecutionEnvironmentRecord) => void;
  onVerify: (environment: DashboardExecutionEnvironmentRecord) => void;
  onSetDefault: (environment: DashboardExecutionEnvironmentRecord) => void;
  onArchive: (environment: DashboardExecutionEnvironmentRecord) => void;
  onRestore: (environment: DashboardExecutionEnvironmentRecord) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Tenant environments</CardTitle>
        <CardDescription>
          Manage the execution environments available to Specialist roles in this tenant.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Environment</TableHead>
              <TableHead>Image</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Resources</TableHead>
              <TableHead className="w-[220px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {props.environments.map((environment) => (
              <TableRow key={environment.id}>
                <TableCell>
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{environment.name}</span>
                      {environment.is_default ? <Badge variant="success">Default</Badge> : null}
                      <Badge variant="secondary">{environment.source_kind}</Badge>
                    </div>
                    <div className="text-xs text-muted">
                      {environment.description ?? 'No description provided.'}
                    </div>
                    <div className="text-xs text-muted">
                      {buildEnvironmentMeta(environment)}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs">{environment.image}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-2">
                    <Badge
                      variant={
                        environment.compatibility_status === 'compatible'
                          ? 'success'
                          : environment.compatibility_status === 'incompatible'
                            ? 'destructive'
                            : 'warning'
                      }
                    >
                      {environment.compatibility_status}
                    </Badge>
                    <Badge variant={environment.is_claimable ? 'outline' : 'warning'}>
                      {environment.is_claimable ? 'claimable' : 'not claimable'}
                    </Badge>
                    {environment.is_archived ? <Badge variant="secondary">Archived</Badge> : null}
                    {environment.support_status ? (
                      <Badge variant={environment.support_status === 'active' ? 'outline' : 'warning'}>
                        {environment.support_status}
                      </Badge>
                    ) : null}
                  </div>
                  {environment.compatibility_errors.length > 0 ? (
                    <div className="mt-2 text-xs text-red-600 dark:text-red-400">
                      {environment.compatibility_errors.join(' ')}
                    </div>
                  ) : null}
                </TableCell>
                <TableCell>
                  <div className="text-sm text-foreground">{`CPU ${environment.cpu} | Memory ${environment.memory}`}</div>
                  <div className="text-xs text-muted">{`Pull ${environment.pull_policy} | Used by ${environment.usage_count} role${environment.usage_count === 1 ? '' : 's'}`}</div>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => props.onEdit(environment)}
                    >
                      <Pencil className="h-4 w-4" />
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={props.busyEnvironmentId === environment.id}
                      onClick={() => props.onVerify(environment)}
                    >
                      <SearchCheck className="h-4 w-4" />
                      Verify
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={environment.is_default || !environment.is_claimable || props.busyEnvironmentId === environment.id}
                      onClick={() => props.onSetDefault(environment)}
                    >
                      <Star className="h-4 w-4" />
                      Default
                    </Button>
                    {environment.is_archived ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={props.busyEnvironmentId === environment.id}
                        onClick={() => props.onRestore(environment)}
                      >
                        <RotateCcw className="h-4 w-4" />
                        Restore
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={environment.is_default || props.busyEnvironmentId === environment.id}
                        onClick={() => props.onArchive(environment)}
                      >
                        <Archive className="h-4 w-4" />
                        Archive
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function buildEnvironmentMeta(environment: DashboardExecutionEnvironmentRecord): string {
  const distro = readString(environment.verified_metadata, 'distro');
  const packageManager = readString(environment.verified_metadata, 'package_manager');
  const commands = readStringArray(environment.tool_capabilities, 'verified_baseline_commands');

  const parts = [
    distro ? `OS ${distro}` : null,
    packageManager ? `Pkg ${packageManager}` : null,
    commands.length > 0 ? `Verified ${commands.slice(0, 4).join(', ')}` : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(' | ') : 'Awaiting verification metadata';
}

function readString(value: Record<string, unknown>, key: string): string | null {
  const entry = value[key];
  return typeof entry === 'string' && entry.trim().length > 0 ? entry.trim() : null;
}

function readStringArray(value: Record<string, unknown>, key: string): string[] {
  const entry = value[key];
  if (!Array.isArray(entry)) {
    return [];
  }
  return entry.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}
