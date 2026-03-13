import { Trash2 } from 'lucide-react';

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
  formatCompactId,
  permissionVariant,
  type OrchestratorGrant,
} from './orchestrator-grants-page.support.js';

export function GrantsTableSection(props: {
  grants: OrchestratorGrant[];
  isRevoking: boolean;
  onRevoke(grantId: string): void;
}): JSX.Element {
  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader>
        <CardTitle>Granted orchestration scopes</CardTitle>
        <CardDescription>
          Review the effective scope before revoking. Elevated permissions are highlighted first on
          each card or row.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 lg:hidden">
          {props.grants.map((grant) => (
            <GrantMobileCard
              key={grant.id}
              grant={grant}
              isRevoking={props.isRevoking}
              onRevoke={props.onRevoke}
            />
          ))}
        </div>
        <div className="hidden lg:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Grant</TableHead>
                <TableHead>Agent</TableHead>
                <TableHead>Workflow scope</TableHead>
                <TableHead>Permissions</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {props.grants.map((grant) => (
                <GrantTableRow
                  key={grant.id}
                  grant={grant}
                  isRevoking={props.isRevoking}
                  onRevoke={props.onRevoke}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function GrantMobileCard(props: {
  grant: OrchestratorGrant;
  isRevoking: boolean;
  onRevoke(grantId: string): void;
}): JSX.Element {
  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader className="space-y-3 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base">Grant {formatCompactId(props.grant.id)}</CardTitle>
            <CardDescription>
              Created {new Date(props.grant.created_at).toLocaleString()}
            </CardDescription>
          </div>
          <GrantRevokeButton
            grantId={props.grant.id}
            isRevoking={props.isRevoking}
            onRevoke={props.onRevoke}
          />
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <GrantDetail label="Agent" value={props.grant.agent_id} mono />
        <GrantDetail label="Workflow scope" value={props.grant.workflow_id} mono />
        <GrantPermissionBadges permissions={props.grant.permissions} />
      </CardContent>
    </Card>
  );
}

function GrantTableRow(props: {
  grant: OrchestratorGrant;
  isRevoking: boolean;
  onRevoke(grantId: string): void;
}): JSX.Element {
  return (
    <TableRow>
      <TableCell>
        <div className="space-y-1">
          <p className="font-medium">{formatCompactId(props.grant.id)}</p>
          <p className="font-mono text-xs text-muted">{props.grant.id}</p>
        </div>
      </TableCell>
      <TableCell className="font-mono text-xs text-muted">{props.grant.agent_id}</TableCell>
      <TableCell className="font-mono text-xs text-muted">{props.grant.workflow_id}</TableCell>
      <TableCell>
        <GrantPermissionBadges permissions={props.grant.permissions} />
      </TableCell>
      <TableCell className="text-sm text-muted">
        {new Date(props.grant.created_at).toLocaleString()}
      </TableCell>
      <TableCell className="text-right">
        <GrantRevokeButton
          grantId={props.grant.id}
          isRevoking={props.isRevoking}
          onRevoke={props.onRevoke}
        />
      </TableCell>
    </TableRow>
  );
}

function GrantPermissionBadges(props: { permissions: string[] }): JSX.Element {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted lg:hidden">Permissions</p>
      <div className="flex flex-wrap gap-2">
        {props.permissions.map((permission) => (
          <Badge key={permission} variant={permissionVariant(permission)}>
            {permission}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function GrantRevokeButton(props: {
  grantId: string;
  isRevoking: boolean;
  onRevoke(grantId: string): void;
}): JSX.Element {
  return (
    <Button
      variant="destructive"
      size="sm"
      disabled={props.isRevoking}
      onClick={() => props.onRevoke(props.grantId)}
    >
      <Trash2 className="h-3.5 w-3.5" />
      Revoke grant
    </Button>
  );
}

function GrantDetail(props: {
  label: string;
  value: string;
  mono?: boolean;
}): JSX.Element {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{props.label}</p>
      <p className={props.mono ? 'break-all font-mono text-xs' : 'text-sm'}>{props.value}</p>
    </div>
  );
}
