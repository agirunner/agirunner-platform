import { Badge } from '../../components/ui/badge.js';

export interface WorkflowTaskPreview {
  id: string;
  title: string;
  role: string | null;
  state: string | null;
}

export function WorkflowBoardTaskStack(props: {
  tasks: WorkflowTaskPreview[];
}): JSX.Element {
  return (
    <div className="grid gap-2 rounded-xl border border-border/70 bg-muted/10 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Task stack
        </p>
        <Badge variant="outline">{props.tasks.length} tasks</Badge>
      </div>
      {props.tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">No task previews available yet.</p>
      ) : (
        <div className="grid max-h-56 gap-2 overflow-y-auto pr-1">
          {props.tasks.map((task) => (
            <div key={task.id} className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <span className="min-w-0 flex-1 text-foreground">{task.title}</span>
              <span className="text-muted-foreground">
                {[task.role, task.state].filter(Boolean).join(' • ')}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
