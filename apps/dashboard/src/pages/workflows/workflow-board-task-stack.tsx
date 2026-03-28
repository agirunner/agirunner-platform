export interface WorkflowTaskPreview {
  id: string;
  title: string;
  role: string | null;
  state: string | null;
}

export function WorkflowBoardTaskStack(props: {
  tasks: WorkflowTaskPreview[];
  selectedTaskId?: string | null;
  defaultOpen?: boolean;
  onSelectTask?(taskId: string): void;
}): JSX.Element {
  const isOpen = props.selectedTaskId ? true : (props.defaultOpen ?? true);

  return (
    <details className="rounded-xl border border-border/70 bg-muted/10 p-3" open={isOpen}>
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Task stack
        </p>
      </summary>
      <div className="mt-3">
        {props.tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No task previews available yet.</p>
        ) : (
          <div className="grid max-h-56 gap-2 overflow-y-auto pr-1">
            {props.tasks.map((task) => (
              <button
                key={task.id}
                type="button"
                className={
                  props.selectedTaskId === task.id
                    ? 'flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-100/90 px-3 py-2 text-left text-sm dark:border-amber-500/60 dark:bg-amber-500/10'
                    : 'flex flex-wrap items-center justify-between gap-3 rounded-lg border border-transparent px-3 py-2 text-left text-sm transition-colors hover:border-border/70 hover:bg-background/70'
                }
                onClick={() => props.onSelectTask?.(task.id)}
              >
                <span className="min-w-0 flex-1 text-foreground">{task.title}</span>
                <span className="text-muted-foreground">
                  {[humanizeToken(task.role), humanizeToken(task.state)].filter(Boolean).join(' • ')}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

function humanizeToken(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
