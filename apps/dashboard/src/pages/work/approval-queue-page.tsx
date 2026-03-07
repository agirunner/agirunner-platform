import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Loader2, CheckCircle, XCircle, MessageSquare, Inbox } from 'lucide-react';
import { dashboardApi } from '../../lib/api.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Textarea } from '../../components/ui/textarea.js';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../components/ui/dialog.js';

interface ApprovalTask {
  id: string;
  name?: string;
  title?: string;
  status: string;
  workflow_id?: string;
  workflow_name?: string;
  created_at: string;
  output?: unknown;
}

function normalizeTasks(response: unknown): ApprovalTask[] {
  if (Array.isArray(response)) {
    return response as ApprovalTask[];
  }
  const wrapped = response as { data?: unknown };
  return Array.isArray(wrapped?.data) ? (wrapped.data as ApprovalTask[]) : [];
}

function computeWaitingTime(createdAt: string): string {
  const diffMs = Date.now() - new Date(createdAt).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function truncateOutput(output: unknown): string {
  if (output === undefined || output === null) return '';
  const text = typeof output === 'string' ? output : JSON.stringify(output);
  if (text.length <= 200) return text;
  return `${text.slice(0, 200)}...`;
}

function ApprovalCard({ task }: { task: ApprovalTask }): JSX.Element {
  const queryClient = useQueryClient();
  const [isChangesDialogOpen, setIsChangesDialogOpen] = useState(false);
  const [feedback, setFeedback] = useState('');

  const approveMutation = useMutation({
    mutationFn: () => dashboardApi.approveTask(task.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks', 'awaiting_approval'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: () => dashboardApi.rejectTask(task.id, { feedback: 'Rejected from approval queue' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks', 'awaiting_approval'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const requestChangesMutation = useMutation({
    mutationFn: (changeFeedback: string) =>
      dashboardApi.requestTaskChanges(task.id, { feedback: changeFeedback }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks', 'awaiting_approval'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      setIsChangesDialogOpen(false);
      setFeedback('');
    },
  });

  const isActionPending =
    approveMutation.isPending ||
    rejectMutation.isPending ||
    requestChangesMutation.isPending;

  const outputPreview = truncateOutput(task.output);
  const taskLabel = task.title ?? task.name ?? task.id;

  return (
    <>
      <Card>
        <CardContent className="p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1 space-y-1">
              <Link
                to={`/work/tasks/${task.id}`}
                className="text-sm font-semibold text-accent hover:underline"
              >
                {taskLabel}
              </Link>

              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                {task.workflow_name && (
                  <span>
                    Workflow:{' '}
                    <Link
                      to={`/work/workflows/${task.workflow_id}`}
                      className="text-accent hover:underline"
                    >
                      {task.workflow_name}
                    </Link>
                  </span>
                )}
                <span>Waiting: {computeWaitingTime(task.created_at)}</span>
              </div>

              {outputPreview && (
                <p className="mt-2 rounded-md border bg-border/10 p-2 text-xs text-muted">
                  {outputPreview}
                </p>
              )}
            </div>

            <div className="flex shrink-0 gap-2">
              <Button
                size="sm"
                disabled={isActionPending}
                onClick={() => approveMutation.mutate()}
              >
                {approveMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle className="h-4 w-4" />
                )}
                Approve
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={isActionPending}
                onClick={() => setIsChangesDialogOpen(true)}
              >
                <MessageSquare className="h-4 w-4" />
                Request Changes
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={isActionPending}
                onClick={() => rejectMutation.mutate()}
              >
                {rejectMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <XCircle className="h-4 w-4" />
                )}
                Reject
              </Button>
            </div>
          </div>

          {(approveMutation.isError || rejectMutation.isError) && (
            <p className="mt-2 text-xs text-red-600">Action failed. Please try again.</p>
          )}
        </CardContent>
      </Card>

      <Dialog open={isChangesDialogOpen} onOpenChange={setIsChangesDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request Changes</DialogTitle>
            <DialogDescription>
              Provide feedback for &ldquo;{taskLabel}&rdquo;.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Textarea
              placeholder="Describe the changes needed..."
              rows={4}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
            />

            {requestChangesMutation.isError && (
              <p className="text-sm text-red-600">Failed to submit feedback. Please try again.</p>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsChangesDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={!feedback.trim() || requestChangesMutation.isPending}
                onClick={() => requestChangesMutation.mutate(feedback)}
              >
                {requestChangesMutation.isPending && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                Submit
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ApprovalQueuePage(): JSX.Element {
  const { data, isLoading, error } = useQuery({
    queryKey: ['tasks', 'awaiting_approval'],
    queryFn: () => dashboardApi.listTasks({ status: 'awaiting_approval' }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-red-600">
        Failed to load approval queue. Please try again later.
      </div>
    );
  }

  const tasks = normalizeTasks(data);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">Approval Queue</h1>
        <Badge variant="secondary">{tasks.length}</Badge>
      </div>

      {tasks.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Inbox className="h-12 w-12 text-muted" />
            <p className="mt-4 text-lg font-medium">No tasks awaiting approval</p>
            <p className="mt-1 text-sm text-muted">
              Tasks requiring human review will appear here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => (
            <ApprovalCard key={task.id} task={task} />
          ))}
        </div>
      )}
    </div>
  );
}
