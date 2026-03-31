import { Archive, Copy, Pencil, RotateCcw, SearchCheck, Star } from 'lucide-react';

import { Badge } from '../../components/ui/badge.js';
import { IconActionButton } from '../../components/ui/icon-action-button.js';
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
  onCopy: (environment: DashboardExecutionEnvironmentRecord) => void;
  onEdit: (environment: DashboardExecutionEnvironmentRecord) => void;
  onVerify: (environment: DashboardExecutionEnvironmentRecord) => void;
  onSetDefault: (environment: DashboardExecutionEnvironmentRecord) => void;
  onArchive: (environment: DashboardExecutionEnvironmentRecord) => void;
  onRestore: (environment: DashboardExecutionEnvironmentRecord) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Environment</TableHead>
          <TableHead>Image</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Resources</TableHead>
          <TableHead className="w-[360px] text-right">Actions</TableHead>
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
                  <Badge variant={environment.source_kind === 'catalog' ? 'info' : 'secondary'}>
                    {environment.source_kind === 'catalog' ? 'Catalog' : 'Custom'}
                  </Badge>
                </div>
                <div className="text-xs text-foreground">
                  {environment.description ?? 'No description provided.'}
                </div>
                <div className="text-xs text-foreground">{buildEnvironmentMeta(environment)}</div>
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
                  {renderCompatibilityStatus(environment.compatibility_status)}
                </Badge>
                <Badge variant={environment.is_archived ? 'secondary' : 'outline'}>
                  {environment.is_archived ? 'Archived' : 'Active'}
                </Badge>
                {environment.support_status && environment.support_status !== 'active' ? (
                  <Badge
                    variant={environment.support_status === 'blocked' ? 'destructive' : 'warning'}
                  >
                    {renderSupportStatus(environment.support_status)}
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
              <div className="text-xs text-foreground">{`Pull ${environment.pull_policy} | Used by ${environment.usage_count} role${environment.usage_count === 1 ? '' : 's'}`}</div>
            </TableCell>
            <TableCell className="text-right">
              <div className="flex flex-nowrap justify-end gap-2 whitespace-nowrap">
                <IconActionButton label="Copy environment" onClick={() => props.onCopy(environment)}>
                  <Copy className="h-4 w-4" />
                </IconActionButton>
                <IconActionButton label="Edit environment" onClick={() => props.onEdit(environment)}>
                  <Pencil className="h-4 w-4" />
                </IconActionButton>
                <IconActionButton
                  label="Verify environment"
                  disabled={props.busyEnvironmentId === environment.id}
                  onClick={() => props.onVerify(environment)}
                >
                  <SearchCheck className="h-4 w-4" />
                </IconActionButton>
                <IconActionButton
                  label="Set default environment"
                  disabled={
                    environment.is_default ||
                    !canSetDefault(environment) ||
                    props.busyEnvironmentId === environment.id
                  }
                  onClick={() => props.onSetDefault(environment)}
                >
                  <Star className="h-4 w-4" />
                </IconActionButton>
                {environment.is_archived ? (
                  <IconActionButton
                    label="Restore environment"
                    disabled={props.busyEnvironmentId === environment.id}
                    onClick={() => props.onRestore(environment)}
                  >
                    <RotateCcw className="h-4 w-4" />
                  </IconActionButton>
                ) : (
                  <IconActionButton
                    label="Archive environment"
                    disabled={environment.is_default || props.busyEnvironmentId === environment.id}
                    onClick={() => props.onArchive(environment)}
                  >
                    <Archive className="h-4 w-4" />
                  </IconActionButton>
                )}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function renderSupportStatus(value: string): string {
  if (value === 'blocked') {
    return 'Blocked';
  }
  if (value === 'deprecated') {
    return 'Deprecated';
  }
  return value;
}

function renderCompatibilityStatus(value: string): string {
  if (value === 'compatible') {
    return 'Verified';
  }
  if (value === 'incompatible') {
    return 'Incompatible';
  }
  return 'Pending verification';
}

function canSetDefault(environment: DashboardExecutionEnvironmentRecord): boolean {
  return !environment.is_archived && environment.compatibility_status === 'compatible' && environment.support_status !== 'blocked';
}

function buildEnvironmentMeta(environment: DashboardExecutionEnvironmentRecord): string {
  const distro = readString(environment.verified_metadata, 'distro');
  const packageManager = readString(environment.verified_metadata, 'package_manager');

  const parts = [
    distro ? `OS ${distro}` : null,
    packageManager ? `Pkg ${packageManager}` : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(' | ') : 'Awaiting verification metadata';
}

function readString(value: Record<string, unknown>, key: string): string | null {
  const entry = value[key];
  return typeof entry === 'string' && entry.trim().length > 0 ? entry.trim() : null;
}
