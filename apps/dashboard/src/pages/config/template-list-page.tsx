import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '../../lib/api.js';

interface Template {
  id: string;
  name: string;
  version: string;
  is_published: boolean;
  created_at: string;
}

function normalizeData(response: { data: Template[] } | Template[]): Template[] {
  if (Array.isArray(response)) {
    return response;
  }
  return response?.data ?? [];
}

export function TemplateListPage(): JSX.Element {
  const { data, isLoading, error } = useQuery({
    queryKey: ['templates'],
    queryFn: () => dashboardApi.listTemplates(),
  });

  if (isLoading) return <div className="p-4">Loading...</div>;
  if (error) return <div className="p-4 text-destructive">Error loading data</div>;

  const templates = normalizeData(data);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Templates</h1>

      {templates.length === 0 ? (
        <p className="text-muted-foreground">No templates found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="pb-2 pr-4 font-medium">Name</th>
                <th className="pb-2 pr-4 font-medium">Version</th>
                <th className="pb-2 pr-4 font-medium">Published</th>
                <th className="pb-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((template) => (
                <tr key={template.id} className="border-b hover:bg-muted/50">
                  <td className="py-3 pr-4 font-medium">{template.name}</td>
                  <td className="py-3 pr-4 text-muted-foreground">
                    {template.version}
                  </td>
                  <td className="py-3 pr-4">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        template.is_published
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {template.is_published ? 'Published' : 'Draft'}
                    </span>
                  </td>
                  <td className="py-3 text-muted-foreground">
                    {new Date(template.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
