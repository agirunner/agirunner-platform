export interface WorkflowTaskPreview {
  id: string;
  title: string;
  role: string | null;
  state: string | null;
  recentUpdate?: string | null;
  workItemId?: string | null;
  workItemTitle?: string | null;
  stageName?: string | null;
}

export function WorkflowBoardTaskStack(props: {
  tasks: WorkflowTaskPreview[];
  defaultOpen?: boolean;
  collapsible?: boolean;
  selectedTaskId?: string | null;
  onSelectWorkItem?(): void;
  onSelectTask?(taskId: string): void;
}): JSX.Element {
  if (props.collapsible === false) {
    return (
      <section className="rounded-lg border border-border/60 bg-muted/5 p-2.5">
        {props.onSelectWorkItem ? (
          <button
            type="button"
            className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground"
            onClick={() => props.onSelectWorkItem?.()}
          >
            Tasks
          </button>
        ) : (
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Tasks
          </p>
        )}
        <div className="mt-3">
          <TaskPreviewRows tasks={props.tasks} onSelectWorkItem={props.onSelectWorkItem} />
        </div>
      </section>
    );
  }

  const isOpen = props.defaultOpen ?? true;

  return (
    <details className="rounded-lg border border-border/60 bg-muted/5 p-2.5" open={isOpen}>
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Tasks
        </p>
      </summary>
      <div className="mt-3">
        <TaskPreviewRows tasks={props.tasks} onSelectWorkItem={props.onSelectWorkItem} />
      </div>
    </details>
  );
}

function TaskPreviewRows(props: {
  tasks: WorkflowTaskPreview[];
  onSelectWorkItem?(): void;
}): JSX.Element {
  if (props.tasks.length === 0) {
    return <p className="text-sm text-muted-foreground">No task previews available yet.</p>;
  }

  return (
    <div className="grid gap-2">
      {props.tasks.map((task) =>
        props.onSelectWorkItem ? (
          <button
            key={task.id}
            type="button"
            data-work-item-selectable="true"
            className={buildStaticTaskRowClassName(task.state)}
            onClick={() => props.onSelectWorkItem?.()}
          >
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {describeTaskRowLead(task.state)}
            </span>
            <span className="text-foreground">{task.title}</span>
            <span className="text-xs text-muted-foreground">
              {[humanizeToken(task.role), humanizeToken(task.state)].filter(Boolean).join(' • ')}
            </span>
            {task.recentUpdate ? (
              <span className="text-xs text-muted-foreground">{task.recentUpdate}</span>
            ) : null}
          </button>
        ) : (
          <div
            key={task.id}
            className={buildStaticTaskRowClassName(task.state)}
          >
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {describeTaskRowLead(task.state)}
            </span>
            <span className="text-foreground">{task.title}</span>
            <span className="text-xs text-muted-foreground">
              {[humanizeToken(task.role), humanizeToken(task.state)].filter(Boolean).join(' • ')}
            </span>
            {task.recentUpdate ? (
              <span className="text-xs text-muted-foreground">{task.recentUpdate}</span>
            ) : null}
          </div>
        ),
      )}
    </div>
  );
}

function humanizeToken(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function describeTaskRowLead(state: string | null | undefined): string {
  if (isActiveTaskState(state)) {
    return 'Working now';
  }
  if (state === 'ready') {
    return 'Ready next';
  }
  if (state === 'completed') {
    return 'Completed';
  }
  if (state === 'failed') {
    return 'Needs retry';
  }
  return humanizeToken(state) ?? 'Task';
}

function buildStaticTaskRowClassName(state: string | null | undefined): string {
  if (isActiveTaskState(state)) {
    return 'grid gap-1 rounded-lg border border-amber-300/60 bg-amber-50/50 px-3 py-2 text-left text-sm dark:border-amber-500/40 dark:bg-amber-500/10';
  }
  if (state === 'ready') {
    return 'grid gap-1 rounded-lg border border-border/60 bg-background/80 px-3 py-2 text-left text-sm';
  }
  return 'grid gap-1 rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-left text-sm';
}

function isActiveTaskState(state: string | null | undefined): boolean {
  return state === 'claimed' || state === 'in_progress' || state === 'awaiting_approval';
}
