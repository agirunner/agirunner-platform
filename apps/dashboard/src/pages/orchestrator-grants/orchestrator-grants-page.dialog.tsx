import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';

import { SearchableCombobox } from '../../components/log-viewer/ui/searchable-combobox.js';
import { Button } from '../../components/ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';
import { Input } from '../../components/ui/input.js';
import { dashboardApi, type DashboardAgentRecord, type DashboardWorkflowRecord } from '../../lib/api.js';
import { toast } from '../../lib/toast.js';
import { formatAbsoluteTimestamp, formatRelativeTimestamp } from '../governance-shared/governance-lifecycle.support.js';
import {
  agentDisplayName,
  buildAgentItems,
  buildWorkflowItems,
  createGrant,
  describeSelectedAgent,
  describeSelectedWorkflow,
  findAgent,
  findWorkflow,
  formatCompactId,
  GRANT_PERMISSION_OPTIONS,
  permissionVariant,
  sortAgents,
  sortWorkflows,
  type OrchestratorGrant,
} from './orchestrator-grants-page.support.js';
import { Badge } from '../../components/ui/badge.js';

export function CreateGrantDialog(props: {
  isOpen: boolean;
  onClose(): void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [agentId, setAgentId] = useState('');
  const [workflowId, setWorkflowId] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [permissions, setPermissions] = useState<string[]>([]);
  const agentsQuery = useQuery({
    queryKey: ['agent-grant-options'],
    queryFn: () => dashboardApi.listAgents(),
    staleTime: 30_000,
  });
  const workflowsQuery = useQuery({
    queryKey: ['workflow-grant-options'],
    queryFn: () => dashboardApi.listWorkflows(),
  });
  const mutation = useMutation({
    mutationFn: createGrant,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['orchestrator-grants'] });
      toast.success('Grant created');
      resetAndClose();
    },
    onError: () => {
      toast.error('Failed to create grant');
    },
  });

  function resetAndClose(): void {
    setAgentId('');
    setWorkflowId('');
    setExpiresAt('');
    setPermissions([]);
    props.onClose();
  }

  function togglePermission(permission: string): void {
    setPermissions((current) =>
      current.includes(permission)
        ? current.filter((value) => value !== permission)
        : [...current, permission],
    );
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!agentId.trim() || !workflowId.trim() || permissions.length === 0) {
      return;
    }
    mutation.mutate({
      agent_id: agentId.trim(),
      workflow_id: workflowId.trim(),
      permissions,
      expires_at: expiresAt ? new Date(expiresAt).toISOString() : undefined,
    });
  }

  const agents = sortAgents(agentsQuery.data ?? []);
  const workflows = sortWorkflows(workflowsQuery.data?.data ?? []);
  const selectedAgent = findAgent(agents, agentId);
  const selectedWorkflow = findWorkflow(workflows, workflowId);
  const canSubmit =
    Boolean(agentId.trim()) &&
    Boolean(workflowId.trim()) &&
    permissions.length > 0 &&
    !mutation.isPending &&
    !agentsQuery.isLoading &&
    !workflowsQuery.isLoading &&
    !agentsQuery.isError &&
    !workflowsQuery.isError &&
    agents.length > 0 &&
    workflows.length > 0;

  return (
    <Dialog open={props.isOpen} onOpenChange={(open) => !open && resetAndClose()}>
      <DialogContent className="max-h-[calc(100vh-4rem)] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create grant</DialogTitle>
          <DialogDescription>
            Bind an agent to a single workflow scope with only the permissions the orchestration path really needs.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <AgentInventoryField
              value={agentId || null}
              agents={agents}
              isLoading={agentsQuery.isLoading}
              hasError={Boolean(agentsQuery.error)}
              onChange={(value) => setAgentId(value ?? '')}
              onRetry={() => void agentsQuery.refetch()}
            />
            <WorkflowScopeField
              value={workflowId || null}
              workflows={workflows}
              isLoading={workflowsQuery.isLoading}
              hasError={Boolean(workflowsQuery.error)}
              onChange={(value) => setWorkflowId(value ?? '')}
              onRetry={() => void workflowsQuery.refetch()}
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="grant-expires-at" className="text-sm font-medium">
                Expiry (optional)
              </label>
              <Input
                id="grant-expires-at"
                type="datetime-local"
                value={expiresAt}
                onChange={(event) => setExpiresAt(event.target.value)}
              />
              <p className="text-xs leading-5 text-muted">
                Set a deadline for temporary escalations so cleanup does not depend on memory.
              </p>
            </div>
            <PermissionField permissions={permissions} onToggle={togglePermission} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {selectedAgent ? (
              <SelectionPacket
                title="Selected agent"
                name={agentDisplayName(selectedAgent)}
                details={describeSelectedAgent(selectedAgent)}
              />
            ) : null}
            {selectedWorkflow ? (
              <SelectionPacket
                title="Selected workflow"
                name={selectedWorkflow.name}
                details={describeSelectedWorkflow(selectedWorkflow)}
              />
            ) : null}
          </div>
          {mutation.isError ? (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>Failed to create the grant. Check the selected agent and workflow scope, then retry.</p>
            </div>
          ) : null}
          <div className="flex flex-col-reverse gap-2 border-t border-border/70 pt-4 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={resetAndClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {mutation.isPending ? 'Creating…' : 'Create grant'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RevokeGrantDialog(props: {
  isOpen: boolean;
  onClose(): void;
  grant: OrchestratorGrant;
  agent: DashboardAgentRecord | null;
  workflow: DashboardWorkflowRecord | null;
  onConfirm(grantId: string): Promise<void> | void;
  isRevoking: boolean;
}): JSX.Element {
  const [confirmationValue, setConfirmationValue] = useState('');
  const expectedValue = formatCompactId(props.grant.id);
  const canConfirm = confirmationValue.trim() === expectedValue;

  return (
    <Dialog
      open={props.isOpen}
      onOpenChange={(open) => {
        if (!open) {
          setConfirmationValue('');
          props.onClose();
        }
      }}
    >
      <DialogContent className="max-h-[calc(100vh-4rem)] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Revoke grant</DialogTitle>
          <DialogDescription>
            This removes the agent workflow binding immediately. Type the compact grant ID to confirm the revoke.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 rounded-xl border border-border/70 bg-border/10 p-4 sm:grid-cols-2">
          <GrantReviewField label="Grant" value={expectedValue} mono />
          <GrantReviewField
            label="Created"
            value={formatRelativeTimestamp(props.grant.created_at)}
            title={formatAbsoluteTimestamp(props.grant.created_at)}
          />
          <GrantReviewField
            label="Agent"
            value={props.agent ? agentDisplayName(props.agent) : props.grant.agent_id}
          />
          <GrantReviewField
            label="Workflow"
            value={props.workflow ? props.workflow.name : props.grant.workflow_id}
          />
          <div className="space-y-1 sm:col-span-2">
            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted">Permissions</p>
            <div className="flex flex-wrap gap-2">
              {props.grant.permissions.map((permission) => (
                <Badge key={permission} variant={permissionVariant(permission)}>
                  {permission}
                </Badge>
              ))}
            </div>
          </div>
        </div>
        <div className="space-y-2">
          <label htmlFor="confirm-grant-revoke" className="text-sm font-medium">
            Confirm by typing {expectedValue}
          </label>
          <Input
            id="confirm-grant-revoke"
            value={confirmationValue}
            onChange={(event) => setConfirmationValue(event.target.value)}
            placeholder={expectedValue}
          />
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-border/70 pt-4 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={props.onClose} disabled={props.isRevoking}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={props.isRevoking || !canConfirm}
            onClick={async () => {
              await props.onConfirm(props.grant.id);
              setConfirmationValue('');
            }}
          >
            {props.isRevoking ? 'Revoking…' : 'Revoke grant'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function WorkflowScopeField(props: {
  value: string | null;
  workflows: DashboardWorkflowRecord[];
  isLoading: boolean;
  hasError: boolean;
  onChange(value: string | null): void;
  onRetry(): void;
}): JSX.Element {
  const isEmpty = !props.isLoading && !props.hasError && props.workflows.length === 0;

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">Workflow scope</label>
      <SearchableCombobox
        items={buildWorkflowItems(props.workflows)}
        value={props.value}
        onChange={props.onChange}
        placeholder="Select workflow"
        searchPlaceholder="Search workflows by name, state, workspace, or playbook"
        allGroupLabel="Workflow scopes"
        isLoading={props.isLoading}
        disabled={props.isLoading || props.hasError || isEmpty}
      />
      {props.isLoading ? <p className="text-xs leading-5 text-muted">Loading workflow scopes…</p> : null}
      {props.hasError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200">
          <p>Workflow inventory is unavailable right now.</p>
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={props.onRetry}>
            Retry workflow inventory
          </Button>
        </div>
      ) : null}
      {isEmpty ? (
        <div className="rounded-lg border border-border/70 bg-border/10 p-3 text-sm text-muted">
          No workflows are available for grants yet. Create a workflow first, then reopen this dialog.
        </div>
      ) : (
        <p className="text-xs leading-5 text-muted">
          Scope the grant to the exact workflow that needs orchestration access.
        </p>
      )}
    </div>
  );
}

function AgentInventoryField(props: {
  value: string | null;
  agents: DashboardAgentRecord[];
  isLoading: boolean;
  hasError: boolean;
  onChange(value: string | null): void;
  onRetry(): void;
}): JSX.Element {
  const isEmpty = !props.isLoading && !props.hasError && props.agents.length === 0;

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">Agent</label>
      <SearchableCombobox
        items={buildAgentItems(props.agents)}
        value={props.value}
        onChange={props.onChange}
        placeholder="Select agent"
        searchPlaceholder="Search agents by name, status, or agent ID"
        allGroupLabel="Registered agents"
        isLoading={props.isLoading}
        disabled={props.isLoading || props.hasError || isEmpty}
      />
      {props.isLoading ? (
        <p className="text-xs leading-5 text-muted">Loading agents from the live inventory…</p>
      ) : null}
      {isEmpty ? (
        <div className="rounded-lg border border-border/70 bg-border/10 p-3 text-sm text-muted">
          No registered agents are available for grants yet. Register or reconnect an agent, then reopen this dialog.
        </div>
      ) : null}
      {props.hasError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200">
          <p>Agent inventory is unavailable right now.</p>
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={props.onRetry}>
            Retry agent inventory
          </Button>
        </div>
      ) : (
        <p className="text-xs leading-5 text-muted">
          Choose a registered agent from the live inventory instead of typing a raw identifier.
        </p>
      )}
    </div>
  );
}

function PermissionField(props: {
  permissions: string[];
  onToggle(permission: string): void;
}): JSX.Element {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Permission set</p>
      <div className="flex flex-wrap gap-2">
        {GRANT_PERMISSION_OPTIONS.map((permission) => {
          const isSelected = props.permissions.includes(permission);
          return (
            <Button
              key={permission}
              type="button"
              size="sm"
              variant={isSelected ? 'default' : 'outline'}
              onClick={() => props.onToggle(permission)}
            >
              {permission}
            </Button>
          );
        })}
      </div>
      <p className="text-xs leading-5 text-muted">
        Read grants view posture, write grants adjust state, and execute grants allow action-taking orchestration flows.
      </p>
    </div>
  );
}

function SelectionPacket(props: {
  title: string;
  name: string;
  details: Array<{ label: string; value: string }>;
}): JSX.Element {
  return (
    <div className="rounded-xl border border-border/70 bg-border/10 p-4">
      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">{props.title}</p>
        <p className="text-sm text-muted">{props.name}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {props.details.map((detail) => (
            <div key={detail.label} className="rounded-lg border border-border/70 bg-background/80 p-3">
              <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted">
                {detail.label}
              </p>
              <p className="mt-1 text-sm text-foreground">{detail.value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function GrantReviewField(props: {
  label: string;
  value: string;
  title?: string;
  mono?: boolean;
}): JSX.Element {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted">{props.label}</p>
      <p className={props.mono ? 'break-all font-mono text-xs' : 'text-sm'} title={props.title}>
        {props.value}
      </p>
    </div>
  );
}
