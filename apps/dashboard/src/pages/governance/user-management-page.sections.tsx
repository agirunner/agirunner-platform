import { Lock, Pencil, Plus, ShieldAlert, UserCheck2, UserCog2, Users, UserX } from 'lucide-react';

import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table.js';
import {
  formatAbsoluteTimestamp,
  formatDateLabel,
  formatRelativeTimestamp,
} from './governance-lifecycle.support.js';
import {
  formatRoleLabel,
  roleVariant,
  summarizeUsers,
  type User,
} from './user-management-page.support.js';

export function UserManagementHeader(props: { onCreate(): void }): JSX.Element {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Users className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-2xl font-semibold tracking-tight">User Management</h1>
        </div>
        <p className="max-w-3xl text-sm leading-6 text-muted">
          Keep platform access reviewable with clear roles, visible last-activity context, and explicit deactivation confirmations.
        </p>
      </div>
      <Button onClick={props.onCreate} className="w-full sm:w-auto">
        <Plus className="h-4 w-4" />
        Create user
      </Button>
    </div>
  );
}

export function UserManagementOverview(props: { users: User[] }): JSX.Element {
  const summary = summarizeUsers(props.users);
  const packets = [
    {
      title: 'People',
      value: `${summary.total}`,
      detail: 'Total accounts in the current workspace',
      icon: Users,
    },
    {
      title: 'Active access',
      value: `${summary.active}`,
      detail: 'Users who can sign in right now',
      icon: UserCheck2,
    },
    {
      title: 'Admin roles',
      value: `${summary.admins}`,
      detail: 'Higher-impact governance and workflow administrators',
      icon: ShieldAlert,
    },
    {
      title: 'Inactive',
      value: `${summary.inactive}`,
      detail: 'Accounts that retain audit history without access',
      icon: UserCog2,
    },
  ];

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {packets.map((packet) => (
        <Card key={packet.title} className="border-border/70 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted">{packet.title}</CardTitle>
            <packet.icon className="h-4 w-4 text-muted" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{packet.value}</p>
            <p className="mt-2 text-xs leading-5 text-muted">{packet.detail}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function UserEmptyState(props: { onCreate(): void }): JSX.Element {
  return (
    <Card className="border-dashed border-border/70 shadow-sm">
      <CardHeader>
        <CardTitle>No users yet</CardTitle>
        <CardDescription>
          Create the first user account when the workspace is ready for shared operator access.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-2xl text-sm leading-6 text-muted">
          Start with the smallest role, then elevate only when a person truly needs broader lifecycle control.
        </p>
        <Button onClick={props.onCreate} className="w-full sm:w-auto">
          <Plus className="h-4 w-4" />
          Create first user
        </Button>
      </CardContent>
    </Card>
  );
}

export function UserTableSection(props: {
  users: User[];
  onEdit(user: User): void;
  onDeactivate(user: User): void;
}): JSX.Element {
  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader>
        <CardTitle>Workspace users</CardTitle>
        <CardDescription>
          Review role, access status, and last activity before changing or deactivating a user.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <UserCards users={props.users} onEdit={props.onEdit} onDeactivate={props.onDeactivate} />
        <div className="hidden lg:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last login</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {props.users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <div className="space-y-1">
                      <p className="font-medium">{user.display_name}</p>
                      <p className="text-sm text-muted">{user.email}</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={roleVariant(user.role)} className="capitalize">
                      {formatRoleLabel(user.role)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={user.status === 'active' ? 'success' : 'secondary'} className="capitalize">
                      {user.status}
                    </Badge>
                  </TableCell>
                  <TableCell title={formatAbsoluteTimestamp(user.last_login)} className="text-muted">
                    {formatRelativeTimestamp(user.last_login)}
                  </TableCell>
                  <TableCell title={formatAbsoluteTimestamp(user.created_at)} className="text-muted">
                    {formatDateLabel(user.created_at)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => props.onEdit(user)}>
                        <Pencil className="h-3.5 w-3.5" />
                        Edit access
                      </Button>
                      {user.status === 'active' ? (
                        <Button variant="destructive" size="sm" onClick={() => props.onDeactivate(user)}>
                          <UserX className="h-3.5 w-3.5" />
                          Deactivate
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

export function PermissionDeniedState(): JSX.Element {
  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-2">
        <Lock className="h-6 w-6 text-muted-foreground" />
        <h1 className="text-2xl font-semibold tracking-tight">User Management</h1>
      </div>
      <Card className="border-amber-300 bg-amber-50 shadow-sm dark:border-amber-700 dark:bg-amber-950/30">
        <CardHeader>
          <CardTitle>Admin access required</CardTitle>
          <CardDescription className="text-amber-900 dark:text-amber-200">
            Managing user lifecycle requires an authenticated administrator with org-level access.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}

function UserCards(props: {
  users: User[];
  onEdit(user: User): void;
  onDeactivate(user: User): void;
}): JSX.Element {
  return (
    <div className="grid gap-3 lg:hidden">
      {props.users.map((user) => (
        <Card key={user.id} className="border-border/70 shadow-sm">
          <CardHeader className="space-y-3 pb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <CardTitle className="truncate text-base">{user.display_name}</CardTitle>
                <CardDescription className="truncate">{user.email}</CardDescription>
              </div>
              <Badge variant={user.status === 'active' ? 'success' : 'secondary'} className="capitalize">
                {user.status}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge variant={roleVariant(user.role)} className="capitalize">
                {formatRoleLabel(user.role)}
              </Badge>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <ReviewField label="Last login" value={formatRelativeTimestamp(user.last_login)} title={formatAbsoluteTimestamp(user.last_login)} />
              <ReviewField label="Created" value={formatDateLabel(user.created_at)} title={formatAbsoluteTimestamp(user.created_at)} />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="outline" size="sm" onClick={() => props.onEdit(user)}>
                <Pencil className="h-3.5 w-3.5" />
                Edit access
              </Button>
              {user.status === 'active' ? (
                <Button variant="destructive" size="sm" onClick={() => props.onDeactivate(user)}>
                  <UserX className="h-3.5 w-3.5" />
                  Deactivate
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ReviewField(props: {
  label: string;
  value: string;
  title?: string;
}): JSX.Element {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted">{props.label}</p>
      <p className="text-sm" title={props.title}>
        {props.value}
      </p>
    </div>
  );
}
