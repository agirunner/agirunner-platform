import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, Save } from 'lucide-react';
import { dashboardApi, type DashboardGovernanceRetentionPolicy } from '../../lib/api.js';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../../components/ui/card.js';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import { Badge } from '../../components/ui/badge.js';

export function RetentionPolicyPage(): JSX.Element {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['retention-policy'],
    queryFn: () => dashboardApi.getRetentionPolicy(),
  });

  const [taskArchiveDays, setTaskArchiveDays] = useState('');
  const [taskDeleteDays, setTaskDeleteDays] = useState('');
  const [execLogDays, setExecLogDays] = useState('');

  useEffect(() => {
    if (data) {
      setTaskArchiveDays(String(data.task_archive_after_days));
      setTaskDeleteDays(String(data.task_delete_after_days));
      setExecLogDays(String(data.execution_log_retention_days));
    }
  }, [data]);

  const mutation = useMutation({
    mutationFn: (payload: Partial<DashboardGovernanceRetentionPolicy>) =>
      dashboardApi.updateRetentionPolicy(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['retention-policy'] });
    },
  });

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    const archive = parseInt(taskArchiveDays, 10);
    const del = parseInt(taskDeleteDays, 10);
    const exec = parseInt(execLogDays, 10);

    if (isNaN(archive) || isNaN(del) || isNaN(exec)) return;
    if (archive < 0 || del < 0 || exec < 0) return;

    mutation.mutate({
      task_archive_after_days: archive,
      task_delete_after_days: del,
      execution_log_retention_days: exec,
    });
  }

  const hasChanges =
    data &&
    (taskArchiveDays !== String(data.task_archive_after_days) ||
      taskDeleteDays !== String(data.task_delete_after_days) ||
      execLogDays !== String(data.execution_log_retention_days));

  if (isLoading) {
    return <div className="p-6 text-muted-foreground">Loading retention policy...</div>;
  }

  if (error) {
    return <div className="p-6 text-red-600">Failed to load retention policy.</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-2">
        <Clock className="h-6 w-6 text-muted-foreground" />
        <h1 className="text-2xl font-semibold">Retention Policy</h1>
      </div>

      <Card className="max-w-lg">
        <form onSubmit={handleSubmit}>
          <CardHeader>
            <CardTitle>Data Retention Settings</CardTitle>
            <CardDescription>
              Configure how long data is retained before archival and deletion.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <label htmlFor="task-archive" className="text-sm font-medium">
                Task Archive After (days)
              </label>
              <Input
                id="task-archive"
                type="number"
                min={0}
                value={taskArchiveDays}
                onChange={(e) => setTaskArchiveDays(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Tasks older than this will be moved to archive storage.
              </p>
            </div>
            <div className="space-y-2">
              <label htmlFor="task-delete" className="text-sm font-medium">
                Task Delete After (days)
              </label>
              <Input
                id="task-delete"
                type="number"
                min={0}
                value={taskDeleteDays}
                onChange={(e) => setTaskDeleteDays(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Archived tasks older than this will be permanently deleted.
              </p>
            </div>
            <div className="space-y-2">
              <label htmlFor="exec-log" className="text-sm font-medium">
                Execution Log Retention (days)
              </label>
              <Input
                id="exec-log"
                type="number"
                min={1}
                value={execLogDays}
                onChange={(e) => setExecLogDays(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Execution log partitions older than this will be dropped.
              </p>
            </div>

            {mutation.isError && (
              <p className="text-sm text-red-600">Failed to save retention policy.</p>
            )}
            {mutation.isSuccess && (
              <Badge variant="success">Saved successfully</Badge>
            )}
          </CardContent>
          <CardFooter>
            <Button type="submit" disabled={mutation.isPending || !hasChanges}>
              <Save className="h-4 w-4" />
              {mutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
