export function DockerPage(): JSX.Element {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Docker Management</h1>
      <p className="text-muted-foreground">
        Manage Docker containers, images, and networks used for task execution
        environments. Monitor container health, resource usage, and lifecycle
        events.
      </p>
    </div>
  );
}
