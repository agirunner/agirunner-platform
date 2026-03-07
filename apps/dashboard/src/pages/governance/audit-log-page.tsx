import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '../../lib/api.js';

interface AuditLogEntry {
  id: string;
  action: string;
  actor: string;
  resource: string;
  details?: string;
  created_at: string;
}

function normalizeData(response: { data: AuditLogEntry[] } | AuditLogEntry[]): AuditLogEntry[] {
  if (Array.isArray(response)) {
    return response;
  }
  return response?.data ?? [];
}

export function AuditLogPage(): JSX.Element {
  const [filterAction, setFilterAction] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['audit-logs'],
    queryFn: () => dashboardApi.listAuditLogs(),
  });

  if (isLoading) return <div className="p-4">Loading...</div>;
  if (error) return <div className="p-4 text-destructive">Error loading data</div>;

  const allEntries = normalizeData(data);
  const entries = filterAction
    ? allEntries.filter((entry) =>
        entry.action.toLowerCase().includes(filterAction.toLowerCase()),
      )
    : allEntries;

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Audit Log</h1>

      <div className="mb-4">
        <input
          type="text"
          placeholder="Filter by action..."
          value={filterAction}
          onChange={(e) => setFilterAction(e.target.value)}
          className="rounded-md border px-3 py-2 text-sm w-full max-w-xs focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {entries.length === 0 ? (
        <p className="text-muted-foreground">No audit log entries found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="pb-2 pr-4 font-medium">Action</th>
                <th className="pb-2 pr-4 font-medium">Actor</th>
                <th className="pb-2 pr-4 font-medium">Resource</th>
                <th className="pb-2 pr-4 font-medium">Details</th>
                <th className="pb-2 font-medium">Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-b hover:bg-muted/50">
                  <td className="py-3 pr-4 font-medium">{entry.action}</td>
                  <td className="py-3 pr-4 text-muted-foreground">
                    {entry.actor}
                  </td>
                  <td className="py-3 pr-4 text-muted-foreground">
                    {entry.resource}
                  </td>
                  <td className="py-3 pr-4 text-muted-foreground truncate max-w-xs">
                    {entry.details ?? '-'}
                  </td>
                  <td className="py-3 text-muted-foreground">
                    {new Date(entry.created_at).toLocaleString()}
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
