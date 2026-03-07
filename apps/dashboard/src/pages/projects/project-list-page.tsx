import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '../../lib/api.js';

interface Project {
  id: string;
  name: string;
  description?: string;
  created_at: string;
  status?: string;
}

function normalizeData(response: { data: Project[] } | Project[]): Project[] {
  if (Array.isArray(response)) {
    return response;
  }
  return response?.data ?? [];
}

export function ProjectListPage(): JSX.Element {
  const { data, isLoading, error } = useQuery({
    queryKey: ['projects'],
    queryFn: () => dashboardApi.listProjects(),
  });

  if (isLoading) return <div className="p-4">Loading...</div>;
  if (error) return <div className="p-4 text-destructive">Error loading data</div>;

  const projects = normalizeData(data);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Projects</h1>

      {projects.length === 0 ? (
        <p className="text-muted-foreground">No projects found.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <div
              key={project.id}
              className="rounded-lg border bg-card p-5 shadow-sm hover:shadow-md transition-shadow"
            >
              <h2 className="text-lg font-medium">{project.name}</h2>
              {project.description && (
                <p className="mt-2 text-sm text-muted-foreground line-clamp-2">
                  {project.description}
                </p>
              )}
              <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                <span>{new Date(project.created_at).toLocaleDateString()}</span>
                {project.status && (
                  <span className="capitalize">{project.status}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
