import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save } from 'lucide-react';

import { DashboardPageHeader } from '../../components/layout/dashboard-page-header.js';
import { DashboardSectionCard } from '../../components/layout/dashboard-section-card.js';
import { Button } from '../../components/ui/button.js';
import { Textarea } from '../../components/ui/textarea.js';
import { dashboardApi } from '../../lib/api.js';
import { toast } from '../../lib/toast.js';
import { useUnsavedChanges } from '../../lib/use-unsaved-changes.js';

export function PlatformInstructionsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [content, setContent] = useState('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const query = useQuery({
    queryKey: ['platform-instructions'],
    queryFn: () => dashboardApi.getPlatformInstructions(),
  });

  useUnsavedChanges(hasUnsavedChanges);

  useEffect(() => {
    if (query.data) {
      setContent(query.data.content);
      setHasUnsavedChanges(false);
    }
  }, [query.data?.content, query.data?.version]);

  const saveMutation = useMutation({
    mutationFn: async () =>
      dashboardApi.updatePlatformInstructions({ content, format: 'markdown' }),
    onSuccess: async (updated) => {
      queryClient.setQueryData(['platform-instructions'], updated);
      setHasUnsavedChanges(false);
      toast.success('Saved platform instructions.');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to save.');
    },
  });

  if (query.isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (query.error) {
    return (
      <div className="p-6">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
          Failed to load platform instructions.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <DashboardPageHeader
        navHref="/platform/instructions"
        description="General instructions applied to all agents — orchestrator and specialists."
        actions={
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !hasUnsavedChanges}
          >
            {saveMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save
          </Button>
        }
      />

      <DashboardSectionCard
        title="Instructions"
        description="These instructions are prepended to every agent's system prompt across all roles, and are meant to provide high-level baseline instruction."
        bodyClassName="space-y-3"
      >
          <Textarea
            value={content}
            onChange={(event) => {
              setContent(event.target.value);
              setHasUnsavedChanges(event.target.value !== (query.data?.content ?? ''));
            }}
            className="min-h-[65vh] font-mono text-sm"
            placeholder="Write org-wide instructions that apply to all agents — coding standards, security policies, communication guidelines."
          />
          <div className="flex items-center justify-between text-xs text-muted">
            <p>{hasUnsavedChanges ? 'Unsaved changes' : 'Up to date'}</p>
            <p>{content.trim().length} characters</p>
          </div>
      </DashboardSectionCard>
    </div>
  );
}
