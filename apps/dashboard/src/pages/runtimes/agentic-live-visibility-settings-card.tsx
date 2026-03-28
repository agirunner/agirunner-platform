import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save } from 'lucide-react';

import { Button } from '../../components/ui/button.js';
import { dashboardApi, type DashboardAgenticSettingsRecord } from '../../lib/api.js';
import { toast } from '../../lib/toast.js';

const AGENTIC_SETTINGS_QUERY_KEY = ['agentic-settings'];

type LiveVisibilityMode = DashboardAgenticSettingsRecord['live_visibility_mode_default'];

function formatTimestamp(value: string | null): string {
  if (!value) {
    return 'Not updated yet';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

export function AgenticLiveVisibilitySettingsCard(): JSX.Element {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: AGENTIC_SETTINGS_QUERY_KEY,
    queryFn: () => dashboardApi.getAgenticSettings(),
  });
  const [selectedMode, setSelectedMode] = useState<LiveVisibilityMode>('enhanced');
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    const nextMode = settingsQuery.data?.live_visibility_mode_default;
    if (!nextMode) {
      return;
    }

    setSelectedMode(nextMode);
    setIsDirty(false);
  }, [settingsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const settings = settingsQuery.data;
      if (!settings) {
        throw new Error('Live visibility settings are unavailable.');
      }

      return dashboardApi.updateAgenticSettings({
        live_visibility_mode_default: selectedMode,
        settings_revision: settings.revision,
      });
    },
    onSuccess: async (savedSettings) => {
      queryClient.setQueryData(AGENTIC_SETTINGS_QUERY_KEY, savedSettings);
      await queryClient.invalidateQueries({ queryKey: AGENTIC_SETTINGS_QUERY_KEY });
      setSelectedMode(savedSettings.live_visibility_mode_default);
      setIsDirty(false);
      toast.success('Live visibility settings saved.');
    },
    onError: (errorValue) => {
      const message = errorValue instanceof Error ? errorValue.message : String(errorValue);
      toast.error(`Failed to save live visibility settings: ${message}`);
    },
  });

  if (settingsQuery.isLoading) {
    return (
      <div className="px-6 pb-6">
        <section className="rounded-3xl border border-border/70 bg-background/95 p-6 shadow-sm">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading live visibility settings…
          </div>
        </section>
      </div>
    );
  }

  if (settingsQuery.error) {
    return (
      <div className="px-6 pb-6">
        <section className="rounded-3xl border border-red-200 bg-red-50 p-6 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
          Failed to load live visibility settings: {String(settingsQuery.error)}
        </section>
      </div>
    );
  }

  const settings = settingsQuery.data;
  if (!settings) {
    return <></>;
  }

  return (
    <div className="px-6 pb-6">
      <section className="space-y-5 rounded-3xl border border-border/70 bg-background/95 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              Workflow visibility
            </p>
            <div className="space-y-1">
              <h2 className="text-xl font-semibold text-foreground">Live visibility mode</h2>
              <p className="max-w-3xl text-sm text-muted-foreground">
                Choose the tenant default used by workflows unless a workflow-level override is set.
                Applies immediately without restarting runtimes.
              </p>
            </div>
          </div>
          <Button onClick={() => saveMutation.mutate()} disabled={!isDirty || saveMutation.isPending}>
            {saveMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save live visibility
          </Button>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,24rem)_1fr]">
          <label className="grid gap-2 text-sm">
            <span className="font-medium text-foreground">Workflow live visibility</span>
            <select
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              value={selectedMode}
              onChange={(event) => {
                setSelectedMode(event.target.value as LiveVisibilityMode);
                setIsDirty(true);
              }}
            >
              <option value="standard">Standard</option>
              <option value="enhanced">Enhanced</option>
            </select>
          </label>

          <div className="grid gap-2 rounded-2xl border border-border/60 bg-muted/10 p-4 text-sm text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">Standard</span> keeps the streamlined
              workflow operator view.
            </p>
            <p>
              <span className="font-medium text-foreground">Enhanced</span> enables the richer live
              activity detail introduced by the Workflows redesign.
            </p>
            <p className="text-xs">
              Tenant scope • Revision {settings.revision} • Last updated {formatTimestamp(settings.updated_at)}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
