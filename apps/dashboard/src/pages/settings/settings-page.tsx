import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Settings2, Save } from 'lucide-react';
import { dashboardApi } from '../../lib/api.js';
import { toast } from '../../lib/toast.js';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../../components/ui/card.js';
import { Button } from '../../components/ui/button.js';
import { Badge } from '../../components/ui/badge.js';
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from '../../components/ui/select.js';

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
type LogLevel = (typeof LOG_LEVELS)[number];

const LOG_LEVEL_DESCRIPTIONS: Record<LogLevel, string> = {
  debug: 'All events including operational telemetry (docker events, image pulls, network changes)',
  info: 'Standard operational events (task lifecycle, API calls, container actions)',
  warn: 'Warnings and errors only (unhealthy containers, unexpected exits, OOM)',
  error: 'Errors only (OOM kills, critical failures)',
};

export function SettingsPage(): JSX.Element {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['governance-logging-config'],
    queryFn: () => dashboardApi.getLoggingConfig(),
  });

  const [level, setLevel] = useState<LogLevel>('debug');

  useEffect(() => {
    if (data?.level) {
      setLevel(data.level);
    }
  }, [data]);

  const mutation = useMutation({
    mutationFn: (newLevel: LogLevel) => dashboardApi.updateLoggingConfig({ level: newLevel }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['governance-logging-config'] });
      toast.success('Settings saved');
    },
    onError: () => {
      toast.error('Failed to save settings');
    },
  });

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    mutation.mutate(level);
  }

  const hasChanges = data && level !== data.level;

  if (isLoading) {
    return <div className="p-6 text-muted-foreground">Loading settings...</div>;
  }

  if (error) {
    return <div className="p-6 text-red-600">Failed to load settings.</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-2">
        <Settings2 className="h-6 w-6 text-muted-foreground" />
        <h1 className="text-2xl font-semibold">Settings</h1>
      </div>

      <Card className="max-w-lg">
        <form onSubmit={handleSubmit}>
          <CardHeader>
            <CardTitle>Logging</CardTitle>
            <CardDescription>
              Control the minimum log level stored for your tenant. Entries below this level are
              discarded at ingest time.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <label htmlFor="log-level" className="text-sm font-medium">
                Minimum Log Level
              </label>
              <Select value={level} onValueChange={(v) => setLevel(v as LogLevel)}>
                <SelectTrigger id="log-level">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOG_LEVELS.map((l) => (
                    <SelectItem key={l} value={l}>
                      {l.charAt(0).toUpperCase() + l.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{LOG_LEVEL_DESCRIPTIONS[level]}</p>
            </div>

            {mutation.isError && <p className="text-sm text-red-600">Failed to save settings.</p>}
            {mutation.isSuccess && <Badge variant="success">Saved successfully</Badge>}
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
