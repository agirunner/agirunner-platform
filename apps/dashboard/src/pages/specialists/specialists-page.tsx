import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, ShieldCheck } from 'lucide-react';

import { ListPagination } from '../../components/list-pagination/list-pagination.js';
import { DEFAULT_LIST_PAGE_SIZE, paginateListItems } from '../../lib/pagination/list-pagination.js';
import { DashboardPageHeader } from '../../components/layout/dashboard-page-header.js';
import { DashboardSectionCard } from '../../components/layout/dashboard-section-card.js';
import { Button } from '../../components/ui/button.js';
import { Switch } from '../../components/ui/switch.js';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '../../components/ui/table.js';
import { toast } from '../../lib/toast.js';
import { DeleteRoleDialog } from './definitions/role-definitions-delete-dialog.js';
import {
  fetchRemoteMcpServers,
  fetchRoles,
  fetchSpecialistSkills,
  deleteRole,
  saveRole,
  fetchToolCatalog,
  fetchExecutionEnvironments,
} from './definitions/role-definitions-page.api.js';
import { useRolePageOrchestratorState } from './definitions/role-definitions-page.orchestrator.js';
import {
  countRoleStateSummary,
  createRoleForm,
  formatRoleDeleteError,
  type RoleDefinition,
} from './definitions/role-definitions-page.support.js';
import { RoleDialog } from './definitions/role-definitions-dialog.js';
import { MetricCard, RoleRow } from './definitions/role-definitions-list.js';

export function SpecialistsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [editingRole, setEditingRole] = useState<RoleDefinition | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [duplicateFrom, setDuplicateFrom] = useState<RoleDefinition | null>(null);
  const [deletingRole, setDeletingRole] = useState<RoleDefinition | null>(null);
  const [showActiveOnly, setShowActiveOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_LIST_PAGE_SIZE);
  const rolesQuery = useQuery({ queryKey: ['roles'], queryFn: fetchRoles });
  const toolsQuery = useQuery({ queryKey: ['role-tools'], queryFn: fetchToolCatalog });
  const environmentsQuery = useQuery({
    queryKey: ['execution-environments'],
    queryFn: fetchExecutionEnvironments,
  });
  const remoteMcpServersQuery = useQuery({
    queryKey: ['remote-mcp-servers'],
    queryFn: fetchRemoteMcpServers,
  });
  const specialistSkillsQuery = useQuery({
    queryKey: ['specialist-skills'],
    queryFn: fetchSpecialistSkills,
  });
  const orchestratorState = useRolePageOrchestratorState();
  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!deletingRole) {
        throw new Error('Choose a specialist to delete.');
      }
      await deleteRole(deletingRole.id);
    },
    onSuccess: async () => {
      const deletedRoleName = deletingRole?.name ?? 'Specialist';
      await queryClient.invalidateQueries({ queryKey: ['roles'] });
      if (editingRole?.id === deletingRole?.id) {
        setEditingRole(null);
      }
      setDeletingRole(null);
      toast.success(`Deleted specialist ${deletedRoleName}.`);
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
      toast.success('Updated specialist active state.');
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to update specialist.';
      toast.error(message);
    },
  });

  if (
    rolesQuery.isLoading ||
    toolsQuery.isLoading ||
    environmentsQuery.isLoading ||
    remoteMcpServersQuery.isLoading ||
    specialistSkillsQuery.isLoading
  ) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }
  if (
    rolesQuery.error ||
    toolsQuery.error ||
    environmentsQuery.error ||
    remoteMcpServersQuery.error ||
    specialistSkillsQuery.error
  ) {
    return (
      <div className="p-6">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
          Failed to load specialists:{' '}
          {String(
            rolesQuery.error ??
              toolsQuery.error ??
              environmentsQuery.error ??
              remoteMcpServersQuery.error ??
              specialistSkillsQuery.error,
          )}
        </div>
      </div>
    );
  }

  const allRoles = [...(rolesQuery.data ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  const roles = showActiveOnly ? allRoles.filter((r) => r.is_active !== false) : allRoles;
  const pagination = paginateListItems(roles, page, pageSize);
  const summary = countRoleStateSummary(allRoles);

  const { assignments, models } = orchestratorState.roleDialogCatalog;
  const modelLookup = new Map(models.map((m) => [m.id, m.model_id]));
  function getModelLabel(roleName: string): string {
    const assignment = assignments.find(
      (a) => a.role_name.trim().toLowerCase() === roleName.trim().toLowerCase(),
    );
    if (!assignment?.primary_model_id) return 'System default';
    return modelLookup.get(assignment.primary_model_id) ?? assignment.primary_model_id;
  }
  const dialogProps = {
    roles: allRoles,
    tools: toolsQuery.data ?? [],
    executionEnvironments: environmentsQuery.data ?? [],
    remoteMcpServers: remoteMcpServersQuery.data ?? [],
    specialistSkills: specialistSkillsQuery.data ?? [],
    ...orchestratorState.roleDialogCatalog,
    onSave: saveRole,
  };

  return (
    <div className="space-y-6 p-6">
      <DashboardPageHeader
        navHref="/design/specialists"
        description="Define specialist identity, prompt, model assignment, and tool grants."
        actions={
          <>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted">Active only</span>
              <Switch
                checked={showActiveOnly}
                onCheckedChange={(value) => {
                  setShowActiveOnly(value);
                  setPage(1);
                }}
                aria-label="Show active specialists only"
              />
            </div>
            <Button onClick={() => setIsCreating(true)}>
              <Plus className="h-4 w-4" />
              Create Specialist
            </Button>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <MetricCard label="Total specialists" value={summary.total} />
        <MetricCard label="Active specialists" value={summary.active} tone="success" />
        <MetricCard label="Inactive specialists" value={summary.inactive} tone="warning" />
      </div>

      {roles.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/70 bg-muted/10 py-12 text-center text-muted">
          <ShieldCheck className="h-12 w-12" />
          <div>
            <p className="font-medium">No specialists defined</p>
            <p className="text-sm">Create the first specialist definition.</p>
          </div>
          <Button onClick={() => setIsCreating(true)}>
            <Plus className="h-4 w-4" />
            Create Specialist
          </Button>
        </div>
      ) : (
        <DashboardSectionCard
          id="specialist-role-definitions"
          title="Specialist definitions"
          description="Review specialists at a glance, then expand any row for the full prompt and tool details."
          bodyClassName="space-y-0 p-0"
        >
          <div className="overflow-x-auto px-6 pb-0">
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
                {pagination.items.map((role) => (
                  <RoleRow
                    key={role.id}
                    role={role}
                    modelLabel={getModelLabel(role.name)}
                    togglingRoleId={
                      toggleActiveMutation.isPending
                        ? ((toggleActiveMutation.variables as RoleDefinition | undefined)?.id ??
                          null)
                        : null
                    }
                    onEdit={setEditingRole}
                    onDelete={(target) => {
                      deleteMutation.reset();
                      setDeletingRole(target);
                    }}
                    onToggleActive={(target) => toggleActiveMutation.mutate(target)}
                    onDuplicate={(source) => {
                      setDuplicateFrom(source);
                      setIsCreating(true);
                    }}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
          <ListPagination
            page={pagination.page}
            pageSize={pageSize}
            totalItems={pagination.totalItems}
            totalPages={pagination.totalPages}
            start={pagination.start}
            end={pagination.end}
            itemLabel="specialists"
            onPageChange={setPage}
            onPageSizeChange={(value) => {
              setPageSize(value);
              setPage(1);
            }}
          />
        </DashboardSectionCard>
      )}

      {isCreating ? (
        <RoleDialog
          {...dialogProps}
          duplicateFrom={duplicateFrom}
          onClose={() => {
            setIsCreating(false);
            setDuplicateFrom(null);
          }}
        />
      ) : null}
      {editingRole ? (
        <RoleDialog {...dialogProps} role={editingRole} onClose={() => setEditingRole(null)} />
      ) : null}
      <DeleteRoleDialog
        role={deletingRole}
        deleteErrorMessage={formatRoleDeleteError(deleteMutation.error)}
        isDeleting={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
        onOpenChange={(open) => {
          if (!open && !deleteMutation.isPending) {
            deleteMutation.reset();
            setDeletingRole(null);
          }
        }}
      />
    </div>
  );
}
