export function RoleDefinitionsPage(): JSX.Element {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Role Definitions</h1>
      <p className="text-muted-foreground">
        Define and manage agent roles, permissions, and capability sets.
        Roles determine what actions agents and workers can perform within
        workflows.
      </p>
    </div>
  );
}
