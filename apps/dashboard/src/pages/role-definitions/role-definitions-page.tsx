import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, ShieldCheck, Users } from 'lucide-react';

import { Button } from '../../components/ui/button.js';
import { Switch } from '../../components/ui/switch.js';
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
import { toast } from '../../lib/toast.js';
import { DeleteRoleDialog } from './role-definitions-delete-dialog.js';
import {
  fetchRoles,
  deleteRole,
  saveRole,
} from './role-definitions-page.api.js';
import { useRolePageOrchestratorState } from './role-definitions-page.orchestrator.js';
import {
  countRoleStateSummary,
  createRoleForm,
  type RoleDefinition,
} from './role-definitions-page.support.js';
import { RoleDialog } from './role-definitions-dialog.js';
import { MetricCard, RoleRow } from './role-definitions-list.js';

export function RoleDefinitionsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [editingRole, setEditingRole] = useState<RoleDefinition | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [duplicateFrom, setDuplicateFrom] = useState<RoleDefinition | null>(null);
  const [deletingRole, setDeletingRole] = useState<RoleDefinition | null>(null);
  const [showActiveOnly, setShowActiveOnly] = useState(false);
  const rolesQuery = useQuery({ queryKey: ['roles'], queryFn: fetchRoles });
  const orchestratorState = useRolePageOrchestratorState();
  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!deletingRole) {
        throw new Error('Choose a role to delete.');
      }
      await deleteRole(deletingRole.id);
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

  const toggleActiveMutation = useMutation({
    mutationFn: async (role: RoleDefinition) => {
      const form = createRoleForm(role);
      form.isActive = !form.isActive;
      await saveRole(role.id, form);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['roles'] });
      toast.success('Updated role active state.');
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to update role.';
      toast.error(message);
    },
  });

  if (rolesQuery.isLoading) {
    return <div className="flex items-center justify-center p-12"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>;
  }
  if (rolesQuery.error) {
    return <div className="p-6"><div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">Failed to load roles: {String(rolesQuery.error)}</div></div>;
  }

  const allRoles = [...(rolesQuery.data ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  const roles = showActiveOnly ? allRoles.filter((r) => r.is_active !== false) : allRoles;
  const summary = countRoleStateSummary(allRoles);

  const { assignments, models } = orchestratorState.roleDialogCatalog;
  const modelLookup = new Map(models.map((m) => [m.id, m.model_id]));
  function getModelLabel(roleName: string): string {
    const assignment = assignments.find((a) => a.role_name.trim().toLowerCase() === roleName.trim().toLowerCase());
    if (!assignment?.primary_model_id) return 'System default';
    return modelLookup.get(assignment.primary_model_id) ?? assignment.primary_model_id;
  }
  const dialogProps = {
    roles: allRoles,
    ...orchestratorState.roleDialogCatalog,
    onSave: saveRole,
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-accent" />
            <h1 className="text-2xl font-semibold">Roles</h1>
          </div>
          <p className="max-w-3xl text-sm text-muted">
            Define specialist roles — identity, prompt, model assignment, and tool grants.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted">Active only</span>
            <Switch checked={showActiveOnly} onCheckedChange={setShowActiveOnly} aria-label="Show active roles only" />
          </div>
          <Button onClick={() => setIsCreating(true)}><Plus className="h-4 w-4" />Create Role</Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <MetricCard label="Total roles" value={summary.total} />
        <MetricCard label="Active roles" value={summary.active} tone="success" />
        <MetricCard label="Inactive roles" value={summary.inactive} tone="warning" />
      </div>

      {roles.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/70 bg-muted/10 py-12 text-center text-muted">
          <ShieldCheck className="h-12 w-12" />
          <div>
            <p className="font-medium">No roles defined</p>
            <p className="text-sm">Create the first specialist role definition.</p>
          </div>
          <Button onClick={() => setIsCreating(true)}>
            <Plus className="h-4 w-4" />
            Create Role
          </Button>
        </div>
      ) : (
        <Card id="specialist-role-definitions">
          <CardHeader>
            <CardTitle>Specialist role definitions</CardTitle>
            <CardDescription>Review roles at a glance, then expand any row for the full prompt and tool details.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Role</TableHead>
                  <TableHead>Tools</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead className="w-[120px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roles.map((role) => (
                  <RoleRow
                    key={role.id}
                    role={role}
                    modelLabel={getModelLabel(role.name)}
                    togglingRoleId={toggleActiveMutation.isPending ? (toggleActiveMutation.variables as RoleDefinition | undefined)?.id ?? null : null}
                    onEdit={setEditingRole}
                    onDelete={setDeletingRole}
                    onToggleActive={(target) => toggleActiveMutation.mutate(target)}
                    onDuplicate={(source) => {
                      setDuplicateFrom(source);
                      setIsCreating(true);
                    }}
                  />
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {isCreating ? <RoleDialog {...dialogProps} duplicateFrom={duplicateFrom} onClose={() => { setIsCreating(false); setDuplicateFrom(null); }} /> : null}
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
