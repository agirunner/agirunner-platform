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
    const content = (
      <TaskRowsContainer tasks={props.tasks}>
        <TaskPreviewRows tasks={props.tasks} isWorkItemSelectable={Boolean(props.onSelectWorkItem)} />
      </TaskRowsContainer>
    );

    if (props.onSelectWorkItem) {
      return (
        <button
          type="button"
          data-work-item-task-area="true"
          className="grid w-full gap-3 rounded-lg border border-border/60 bg-muted/5 p-2.5 text-left transition-colors hover:bg-muted/10"
          onClick={() => props.onSelectWorkItem?.()}
        >
          <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Tasks
          </span>
          {content}
        </button>
      );
    }

    return (
      <section className="rounded-lg border border-border/60 bg-muted/5 p-2.5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Tasks
        </p>
        <TaskRowsContainer tasks={props.tasks}>
          <TaskPreviewRows tasks={props.tasks} isWorkItemSelectable={false} />
        </TaskRowsContainer>
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
      <TaskRowsContainer tasks={props.tasks}>
        <TaskPreviewRows tasks={props.tasks} isWorkItemSelectable={false} />
      </TaskRowsContainer>
    </details>
  );
}

function TaskRowsContainer(props: {
  tasks: WorkflowTaskPreview[];
  children: JSX.Element;
}): JSX.Element {
  const shouldBoundHeight = props.tasks.length > 4;

  return (
    <div className="mt-3 overflow-hidden rounded-md border border-border/50 bg-background/30 p-1.5">
      <div className={shouldBoundHeight ? 'grid max-h-[16rem] overflow-y-auto overscroll-contain pr-1' : 'grid'}>
        {props.children}
      </div>
    </div>
  );
}

function TaskPreviewRows(props: {
  tasks: WorkflowTaskPreview[];
  isWorkItemSelectable: boolean;
}): JSX.Element {
  if (props.tasks.length === 0) {
    return <p className="text-sm text-muted-foreground">No task previews available yet.</p>;
  }

  return (
    <div className="grid gap-2">
      {props.tasks.map((task) => (
        <div
          key={task.id}
          data-work-item-task-row={props.isWorkItemSelectable ? 'true' : undefined}
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
      ))}
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
