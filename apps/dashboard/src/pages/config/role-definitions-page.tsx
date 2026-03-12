import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Loader2, Pencil, Plus, ShieldCheck } from 'lucide-react';

import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table.js';
import { Textarea } from '../../components/ui/textarea.js';
import { readSession } from '../../lib/session.js';
import { cn } from '../../lib/utils.js';

interface RoleDefinition {
  id: string;
  name: string;
  description?: string;
  system_prompt?: string;
  allowed_tools?: string[];
  capabilities?: string[];
  model_preference?: string;
  verification_strategy?: string;
  escalation_target?: string | null;
  max_escalation_depth?: number;
}

interface RoleFormState {
  name: string;
  description: string;
  systemPrompt: string;
  allowedTools: string[];
  verificationStrategy: string;
  escalationTarget: string | null;
  maxEscalationDepth: number;
}

const API_BASE_URL = import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:8080';
const KNOWN_TOOLS = [
  'shell_exec',
  'file_read',
  'file_write',
  'file_edit',
  'file_list',
  'git_status',
  'git_diff',
  'git_log',
  'git_commit',
  'git_push',
  'artifact_upload',
  'web_fetch',
  'web_search',
  'escalate',
];

function getAuthHeaders(): Record<string, string> {
  const session = readSession();
  return {
    'Content-Type': 'application/json',
    ...(session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {}),
  };
}

function listAvailableTools(role?: RoleDefinition | null): string[] {
  return [...new Set([...(role?.allowed_tools ?? []), ...KNOWN_TOOLS])].sort();
}

function createRoleForm(role?: RoleDefinition | null): RoleFormState {
  return {
    name: role?.name ?? '',
    description: role?.description ?? '',
    systemPrompt: role?.system_prompt ?? '',
    allowedTools: role?.allowed_tools ?? [],
    verificationStrategy: role?.verification_strategy ?? 'none',
    escalationTarget: role?.escalation_target ?? null,
    maxEscalationDepth: role?.max_escalation_depth ?? 5,
  };
}

function buildRolePayload(form: RoleFormState) {
  return {
    name: form.name.trim(),
    description: form.description.trim() || undefined,
    systemPrompt: form.systemPrompt.trim() || undefined,
    allowedTools: form.allowedTools,
    verificationStrategy: form.verificationStrategy,
    escalationTarget: form.escalationTarget,
    maxEscalationDepth: form.escalationTarget ? form.maxEscalationDepth : undefined,
  };
}

async function fetchRoles(): Promise<RoleDefinition[]> {
  const response = await fetch(`${API_BASE_URL}/api/v1/config/roles`, {
    headers: getAuthHeaders(),
    credentials: 'include',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  return body.data ?? body;
}

async function createRole(form: RoleFormState): Promise<RoleDefinition> {
  const response = await fetch(`${API_BASE_URL}/api/v1/config/roles`, {
    method: 'POST',
    headers: getAuthHeaders(),
    credentials: 'include',
    body: JSON.stringify(buildRolePayload(form)),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  return body.data ?? body;
}

async function updateRole(roleId: string, form: RoleFormState): Promise<RoleDefinition> {
  const response = await fetch(`${API_BASE_URL}/api/v1/config/roles/${roleId}`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    credentials: 'include',
    body: JSON.stringify(buildRolePayload(form)),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  return body.data ?? body;
}

function RoleDialog(props: {
  role?: RoleDefinition | null;
  roles: RoleDefinition[];
  onClose(): void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<RoleFormState>(createRoleForm(props.role));
  const mutation = useMutation({
    mutationFn: () => (props.role ? updateRole(props.role.id, form) : createRole(form)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['roles'] });
      props.onClose();
    },
  });
  const otherRoles = props.roles.filter((role) => role.id !== props.role?.id);
  const availableTools = listAvailableTools(props.role);

  function toggleTool(tool: string) {
    setForm((current) => ({
      ...current,
      allowedTools: current.allowedTools.includes(tool)
        ? current.allowedTools.filter((value) => value !== tool)
        : [...current.allowedTools, tool],
    }));
  }

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{props.role ? `Edit Role: ${props.role.name}` : 'Create Role'}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Name</span>
            <Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required />
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Description</span>
            <Input value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-medium">System Prompt</span>
            <Textarea value={form.systemPrompt} onChange={(event) => setForm((current) => ({ ...current, systemPrompt: event.target.value }))} rows={6} />
          </label>
          <div className="grid gap-2 text-sm">
            <span className="font-medium">Allowed Tools</span>
            <p className="text-xs text-muted">Existing grants that are no longer in the standard catalog still stay editable here.</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {availableTools.map((tool) => (
                <label key={tool} className="flex items-center gap-2 rounded-md border border-border/70 bg-muted/10 px-3 py-2 text-sm">
                  <input type="checkbox" checked={form.allowedTools.includes(tool)} onChange={() => toggleTool(tool)} className="rounded" />
                  {tool}
                </label>
              ))}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Verification Strategy</span>
              <Select value={form.verificationStrategy} onValueChange={(value) => setForm((current) => ({ ...current, verificationStrategy: value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="peer_review">Peer review</SelectItem>
                  <SelectItem value="human_approval">Human approval</SelectItem>
                  <SelectItem value="automated_test">Automated test</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Escalation Target</span>
              <Select value={form.escalationTarget ?? '__none__'} onValueChange={(value) => setForm((current) => ({ ...current, escalationTarget: value === '__none__' ? null : value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  <SelectItem value="human">Human</SelectItem>
                  {otherRoles.map((role) => <SelectItem key={role.id} value={role.name}>{role.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
          </div>
          {form.escalationTarget ? (
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Max Escalation Depth</span>
              <Input type="number" min={1} max={10} value={form.maxEscalationDepth} onChange={(event) => setForm((current) => ({ ...current, maxEscalationDepth: Math.max(1, Math.min(10, Number(event.target.value) || 1)) }))} />
            </label>
          ) : null}
          {mutation.error ? <p className="text-sm text-red-600">{String(mutation.error)}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={props.onClose}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {props.role ? 'Save' : 'Create Role'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RoleRow(props: { role: RoleDefinition; roles: RoleDefinition[]; onEdit(role: RoleDefinition): void }) {
  const [isExpanded, setIsExpanded] = useState(false);
  return (
    <>
      <TableRow className={cn('cursor-pointer', isExpanded && 'border-b-0')} onClick={() => setIsExpanded((value) => !value)}>
        <TableCell><div className="flex items-center gap-2">{isExpanded ? <ChevronDown className="h-4 w-4 text-muted" /> : <ChevronRight className="h-4 w-4 text-muted" />}<span className="font-medium">{props.role.name}</span></div></TableCell>
        <TableCell className="text-sm text-muted">{props.role.description ?? '-'}</TableCell>
        <TableCell><Badge variant="outline">{props.role.allowed_tools?.length ?? 0}</Badge></TableCell>
        <TableCell className="font-mono text-xs">{props.role.model_preference ?? 'default'}</TableCell>
        <TableCell><Button size="icon" variant="ghost" onClick={(event) => { event.stopPropagation(); props.onEdit(props.role); }}><Pencil className="h-4 w-4" /></Button></TableCell>
      </TableRow>
      {isExpanded ? (
        <TableRow>
          <TableCell colSpan={5} className="bg-border/10">
            <div className="space-y-3 py-2">
              {props.role.system_prompt ? <p className="rounded bg-surface p-3 font-mono text-sm whitespace-pre-wrap">{props.role.system_prompt}</p> : null}
              {props.role.capabilities?.length ? <div className="flex flex-wrap gap-1">{props.role.capabilities.map((capability) => <Badge key={capability} variant="secondary">{capability}</Badge>)}</div> : null}
              {props.role.allowed_tools?.length ? <div className="flex flex-wrap gap-1">{props.role.allowed_tools.map((tool) => <Badge key={tool} variant="outline">{tool}</Badge>)}</div> : null}
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

export function RoleDefinitionsPage(): JSX.Element {
  const [editingRole, setEditingRole] = useState<RoleDefinition | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const rolesQuery = useQuery({ queryKey: ['roles'], queryFn: fetchRoles });

  if (rolesQuery.isLoading) {
    return <div className="flex items-center justify-center p-12"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>;
  }
  if (rolesQuery.error) {
    return <div className="p-6"><div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">Failed to load roles: {String(rolesQuery.error)}</div></div>;
  }

  const roles = rolesQuery.data ?? [];
  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Role Definitions</h1>
          <p className="text-sm text-muted">Define agent roles, prompts, tool grants, and escalation behavior.</p>
        </div>
        <Button onClick={() => setIsCreating(true)}><Plus className="h-4 w-4" />Create Role</Button>
      </div>
      {roles.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/70 bg-muted/10 py-12 text-center text-muted">
          <ShieldCheck className="h-12 w-12" />
          <div>
            <p className="font-medium">No roles defined</p>
            <p className="text-sm">Create the first role definition to configure specialists and orchestrator behavior.</p>
          </div>
        </div>
      ) : (
        <Table>
          <TableHeader><TableRow><TableHead>Role Name</TableHead><TableHead>Description</TableHead><TableHead>Tools</TableHead><TableHead>Model</TableHead><TableHead className="w-[60px]">Actions</TableHead></TableRow></TableHeader>
          <TableBody>{roles.map((role) => <RoleRow key={role.id} role={role} roles={roles} onEdit={setEditingRole} />)}</TableBody>
        </Table>
      )}
      {isCreating ? <RoleDialog roles={roles} onClose={() => setIsCreating(false)} /> : null}
      {editingRole ? <RoleDialog role={editingRole} roles={roles} onClose={() => setEditingRole(null)} /> : null}
    </div>
  );
}
