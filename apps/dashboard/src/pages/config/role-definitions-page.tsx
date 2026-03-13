import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Loader2, Plus, ShieldCheck } from 'lucide-react';

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
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table.js';
import { dashboardApi } from '../../lib/api.js';
import { readSession } from '../../lib/session.js';
import { toast } from '../../lib/toast.js';
import { DeleteRoleDialog } from './role-definitions-delete-dialog.js';
import {
  OrchestratorControlPlane,
} from './role-definitions-orchestrator.js';
import {
  summarizeOrchestratorReadiness,
  summarizeOrchestratorControlSurfaces,
  summarizeOrchestratorModel,
  summarizeOrchestratorPool,
  summarizeOrchestratorPrompt,
  type RoleAssignmentRecord,
  type SystemDefaultRecord,
} from './role-definitions-orchestrator.support.js';
import {
  buildRolePayload,
  countRoleStateSummary,
  type LlmModelRecord,
  type LlmProviderRecord,
  type RoleDefinition,
  type RoleFormState,
} from './role-definitions-page.support.js';
import { RoleDialog } from './role-definitions-dialog.js';
import { MetricCard, RoleRow } from './role-definitions-list.js';

const API_BASE_URL = import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:8080';

function getAuthHeaders(): Record<string, string> {
  const session = readSession();
  return {
    'Content-Type': 'application/json',
    ...(session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {}),
  };
}

async function requestData<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
    headers: getAuthHeaders(),
    ...init,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  return (body.data ?? body) as T;
}

const fetchRoles = () => requestData<RoleDefinition[]>('/api/v1/config/roles');
const fetchProviders = () => requestData<LlmProviderRecord[]>('/api/v1/config/llm/providers');
const fetchModels = () => requestData<LlmModelRecord[]>('/api/v1/config/llm/models');
const fetchSystemDefault = () => requestData<SystemDefaultRecord>('/api/v1/config/llm/system-default');
const fetchAssignments = () => requestData<RoleAssignmentRecord[]>('/api/v1/config/llm/assignments');

function saveRole(roleId: string | null, form: RoleFormState) {
  return requestData<RoleDefinition>(roleId ? `/api/v1/config/roles/${roleId}` : '/api/v1/config/roles', {
    method: roleId ? 'PUT' : 'POST',
    body: JSON.stringify(buildRolePayload(form)),
  });
}

export function RoleDefinitionsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [editingRole, setEditingRole] = useState<RoleDefinition | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [deletingRole, setDeletingRole] = useState<RoleDefinition | null>(null);
  const rolesQuery = useQuery({ queryKey: ['roles'], queryFn: fetchRoles });
  const providersQuery = useQuery({ queryKey: ['llm-providers'], queryFn: fetchProviders });
  const modelsQuery = useQuery({ queryKey: ['llm-models'], queryFn: fetchModels });
  const instructionsQuery = useQuery({
    queryKey: ['platform-instructions', 'roles-page'],
    queryFn: () => dashboardApi.getPlatformInstructions(),
  });
  const systemDefaultQuery = useQuery({
    queryKey: ['llm-system-default', 'roles-page'],
    queryFn: fetchSystemDefault,
  });
  const assignmentsQuery = useQuery({
    queryKey: ['llm-assignments', 'roles-page'],
    queryFn: fetchAssignments,
  });
  const fleetStatusQuery = useQuery({
    queryKey: ['fleet-status', 'roles-page'],
    queryFn: () => dashboardApi.fetchFleetStatus(),
  });
  const fleetWorkersQuery = useQuery({
    queryKey: ['fleet-workers', 'roles-page'],
    queryFn: () => dashboardApi.fetchFleetWorkers(),
  });
  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!deletingRole) {
        throw new Error('Choose a role to delete.');
      }
      const response = await fetch(`${API_BASE_URL}/api/v1/config/roles/${deletingRole.id}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
    },
    onSuccess: async () => {
      const deletedRoleName = deletingRole?.name ?? 'Role';
      await queryClient.invalidateQueries({ queryKey: ['roles'] });
      if (editingRole?.id === deletingRole?.id) {
        setEditingRole(null);
      }
      setDeletingRole(null);
      toast.success(`Deleted role ${deletedRoleName}.`);
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to delete role.';
      toast.error(message);
    },
  });

  if (rolesQuery.isLoading) {
    return <div className="flex items-center justify-center p-12"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>;
  }
  if (rolesQuery.error) {
    return <div className="p-6"><div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">Failed to load roles: {String(rolesQuery.error)}</div></div>;
  }

  const roles = rolesQuery.data ?? [];
  const summary = countRoleStateSummary(roles);
  const modelCatalogError = modelsQuery.error || providersQuery.error ? String(modelsQuery.error ?? providersQuery.error) : null;
  const orchestratorPromptSummary = summarizeOrchestratorPrompt(instructionsQuery.data);
  const orchestratorModelSummary = summarizeOrchestratorModel(
    assignmentsQuery.data,
    systemDefaultQuery.data,
    modelsQuery.data ?? [],
  );
  const orchestratorPoolSummary = summarizeOrchestratorPool(
    fleetStatusQuery.data,
    fleetWorkersQuery.data,
  );
  const orchestratorReadiness = summarizeOrchestratorReadiness(
    orchestratorPromptSummary,
    orchestratorModelSummary,
    orchestratorPoolSummary,
  );
  const orchestratorControlSurfaces = summarizeOrchestratorControlSurfaces(
    orchestratorPromptSummary,
    orchestratorModelSummary,
    orchestratorPoolSummary,
  );
  const orchestratorQueries = [
    instructionsQuery,
    systemDefaultQuery,
    assignmentsQuery,
    fleetStatusQuery,
    fleetWorkersQuery,
  ];
  const dialogProps = {
    roles,
    providers: providersQuery.data ?? [],
    models: modelsQuery.data ?? [],
    isModelCatalogLoading: providersQuery.isLoading || modelsQuery.isLoading,
    modelCatalogError,
    onSave: saveRole,
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-accent" />
            <h1 className="text-2xl font-semibold">Roles &amp; Orchestrator</h1>
          </div>
          <p className="max-w-3xl text-sm text-muted">
            Configure specialist roles here, and use the orchestrator control plane below to keep
            prompt, model routing, and worker pool posture discoverable from one operator surface.
          </p>
        </div>
        <Button onClick={() => setIsCreating(true)}><Plus className="h-4 w-4" />Create Role</Button>
      </div>

      <OrchestratorControlPlane
        promptSummary={orchestratorPromptSummary}
        modelSummary={orchestratorModelSummary}
        poolSummary={orchestratorPoolSummary}
        readiness={orchestratorReadiness}
        controlSurfaces={orchestratorControlSurfaces}
        isLoading={orchestratorQueries.some((query) => query.isLoading)}
        hasError={orchestratorQueries.some((query) => query.isError)}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total roles" value={summary.total} />
        <MetricCard label="Active roles" value={summary.active} tone="success" />
        <MetricCard label="Built-in roles" value={summary.builtIn} />
        <MetricCard label="Custom roles" value={summary.custom} tone="warning" />
      </div>

      {roles.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/70 bg-muted/10 py-12 text-center text-muted">
          <ShieldCheck className="h-12 w-12" />
          <div>
            <p className="font-medium">No roles defined</p>
            <p className="text-sm">Create the first specialist role definition here. Orchestrator prompt, model, and pool posture stay in the control plane above.</p>
          </div>
        </div>
      ) : (
        <Card id="specialist-role-catalog">
          <CardHeader>
            <CardTitle>Specialist role catalog</CardTitle>
            <CardDescription>Review current specialist role posture at a glance, then expand any row for the full prompt, grants, and escalation details.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Role</TableHead>
                  <TableHead>Capabilities</TableHead>
                  <TableHead>Tools</TableHead>
                  <TableHead>Model policy</TableHead>
                  <TableHead className="w-[180px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roles.map((role) => (
                  <RoleRow
                    key={role.id}
                    role={role}
                    onEdit={setEditingRole}
                    onDelete={setDeletingRole}
                  />
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {isCreating ? <RoleDialog {...dialogProps} onClose={() => setIsCreating(false)} /> : null}
      {editingRole ? <RoleDialog {...dialogProps} role={editingRole} onClose={() => setEditingRole(null)} /> : null}
      <DeleteRoleDialog
        role={deletingRole}
        isDeleting={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
        onOpenChange={(open) => {
          if (!open && !deleteMutation.isPending) {
            setDeletingRole(null);
          }
        }}
      />
    </div>
  );
}
