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
import type { DashboardAgentRecord, DashboardWorkflowRecord } from '../../lib/api.js';
import { formatAbsoluteTimestamp, formatRelativeTimestamp } from './governance-lifecycle.support.js';
import {
  agentDisplayName,
  findAgent,
  findWorkflow,
  formatCompactId,
  permissionVariant,
  workflowDisplayName,
  type OrchestratorGrant,
} from './orchestrator-grants-page.support.js';

export function GrantsTableSection(props: {
  grants: OrchestratorGrant[];
  agents: DashboardAgentRecord[];
  workflows: DashboardWorkflowRecord[];
  isRevoking: boolean;
  onRevoke(grantId: string): void;
}): JSX.Element {
  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader>
        <CardTitle>Granted orchestration scopes</CardTitle>
        <CardDescription>
          Elevated permissions render first, with workflow and agent names kept visible before you revoke a binding.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 lg:hidden">
          {props.grants.map((grant) => (
            <GrantMobileCard
              key={grant.id}
              grant={grant}
              agents={props.agents}
              workflows={props.workflows}
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
                  agents={props.agents}
                  workflows={props.workflows}
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
  agents: DashboardAgentRecord[];
  workflows: DashboardWorkflowRecord[];
  isRevoking: boolean;
  onRevoke(grantId: string): void;
}): JSX.Element {
  const agent = findAgent(props.agents, props.grant.agent_id);
  const workflow = findWorkflow(props.workflows, props.grant.workflow_id);

  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader className="space-y-3 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base">Grant {formatCompactId(props.grant.id)}</CardTitle>
            <CardDescription title={formatAbsoluteTimestamp(props.grant.created_at)}>
              Created {formatRelativeTimestamp(props.grant.created_at)}
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
        <GrantDetail
          label="Agent"
          value={agent ? agentDisplayName(agent) : props.grant.agent_id}
          secondaryValue={agent ? props.grant.agent_id : undefined}
          mono={Boolean(!agent)}
        />
        <GrantDetail
          label="Workflow scope"
          value={workflow ? workflowDisplayName(workflow) : props.grant.workflow_id}
          secondaryValue={workflow ? props.grant.workflow_id : undefined}
          mono={Boolean(!workflow)}
        />
        <GrantPermissionBadges permissions={props.grant.permissions} />
      </CardContent>
    </Card>
  );
}

function GrantTableRow(props: {
  grant: OrchestratorGrant;
  agents: DashboardAgentRecord[];
  workflows: DashboardWorkflowRecord[];
  isRevoking: boolean;
  onRevoke(grantId: string): void;
}): JSX.Element {
  const agent = findAgent(props.agents, props.grant.agent_id);
  const workflow = findWorkflow(props.workflows, props.grant.workflow_id);

  return (
    <TableRow>
      <TableCell>
        <div className="space-y-1">
          <p className="font-medium">{formatCompactId(props.grant.id)}</p>
          <p className="font-mono text-xs text-muted">{props.grant.id}</p>
        </div>
      </TableCell>
      <TableCell>
        <div className="space-y-1">
          <p className="font-medium">{agent ? agentDisplayName(agent) : props.grant.agent_id}</p>
          {agent ? <p className="font-mono text-xs text-muted">{props.grant.agent_id}</p> : null}
        </div>
      </TableCell>
      <TableCell>
        <div className="space-y-1">
          <p className="font-medium">{workflow ? workflowDisplayName(workflow) : props.grant.workflow_id}</p>
          {workflow ? <p className="font-mono text-xs text-muted">{props.grant.workflow_id}</p> : null}
        </div>
      </TableCell>
      <TableCell>
        <GrantPermissionBadges permissions={props.grant.permissions} />
      </TableCell>
      <TableCell className="text-sm text-muted" title={formatAbsoluteTimestamp(props.grant.created_at)}>
        {formatRelativeTimestamp(props.grant.created_at)}
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
  secondaryValue?: string;
  mono?: boolean;
}): JSX.Element {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{props.label}</p>
      <p className={props.mono ? 'break-all font-mono text-xs' : 'text-sm font-medium'}>{props.value}</p>
      {props.secondaryValue ? <p className="break-all font-mono text-xs text-muted">{props.secondaryValue}</p> : null}
    </div>
  );
}
