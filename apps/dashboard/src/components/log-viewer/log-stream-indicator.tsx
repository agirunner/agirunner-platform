import { Pause, Radio } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import { Button } from '../ui/button.js';

export interface LogStreamIndicatorProps {
  isLive: boolean;
  isConnected: boolean;
  entriesPerSecond: number;
  bufferedCount: number;
  error: string | null;
  onToggle: () => void;
}

function StatusDot({
  color,
  isPulsing,
}: {
  color: 'green' | 'yellow' | 'red';
  isPulsing: boolean;
}): JSX.Element {
  const colorClasses: Record<string, string> = {
    green: 'bg-green-500',
    yellow: 'bg-yellow-500',
    red: 'bg-red-500',
  };

  return (
    <span className="relative flex h-2.5 w-2.5">
      {isPulsing && (
        <span
          className={cn(
            'absolute inline-flex h-full w-full animate-ping rounded-full opacity-75',
            colorClasses[color],
          )}
        />
      )}
      <span
        className={cn(
          'relative inline-flex h-2.5 w-2.5 rounded-full',
          colorClasses[color],
        )}
      />
    </span>
  );
}

function LiveState({ props }: { props: LogStreamIndicatorProps }): JSX.Element {
  const { isConnected, error, entriesPerSecond, onToggle } = props;

  if (error) {
    return (
      <div className="flex items-center gap-2">
        <StatusDot color="red" isPulsing={false} />
        <span className="text-xs font-medium text-red-600">{error}</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={onToggle}
        >
          Stop
        </Button>
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="flex items-center gap-2">
        <StatusDot color="yellow" isPulsing />
        <span className="text-xs font-medium">Connecting...</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={onToggle}
        >
          Stop
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <StatusDot color="green" isPulsing />
      <span className="text-xs font-medium text-green-700">Live</span>
      {entriesPerSecond > 0 && (
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
          {entriesPerSecond}/s
        </span>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="h-6 w-6 p-0"
        onClick={onToggle}
        title="Stop live stream"
      >
        <Pause className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export function LogStreamIndicator(props: LogStreamIndicatorProps): JSX.Element {
  const { isLive, onToggle } = props;

  if (!isLive) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-1.5 text-xs"
        onClick={onToggle}
      >
        <Radio className="h-3.5 w-3.5" />
        Go live
      </Button>
    );
  }

  return <LiveState props={props} />;
}
