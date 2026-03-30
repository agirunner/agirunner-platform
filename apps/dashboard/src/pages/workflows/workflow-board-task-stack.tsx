export interface WorkflowTaskPreview {
  id: string;
  title: string;
  role: string | null;
  state: string | null;
  recentUpdate?: string | null;
  operatorSummary?: string[];
  workItemId?: string | null;
  workItemTitle?: string | null;
  stageName?: string | null;
}

const THEMED_SCROLL_STYLE = {
  scrollbarWidth: 'thin',
  scrollbarColor: 'rgba(148, 163, 184, 0.5) transparent',
} as const;

export function WorkflowBoardTaskStack(props: {
  tasks: WorkflowTaskPreview[];
  defaultOpen?: boolean;
  collapsible?: boolean;
  laneWorkItemCount?: number;
  selectedTaskId?: string | null;
  onSelectWorkItem?(): void;
  onSelectTask?(taskId: string): void;
}): JSX.Element {
  const isWorkItemSelectable = Boolean(props.onSelectWorkItem);

  if (props.collapsible === false) {
    const content = (
      <TaskRowsContainer tasks={props.tasks} laneWorkItemCount={props.laneWorkItemCount}>
        <TaskPreviewRows tasks={props.tasks} isWorkItemSelectable={isWorkItemSelectable} />
      </TaskRowsContainer>
    );

    if (isWorkItemSelectable) {
      return (
        <div
          role="button"
          tabIndex={0}
          data-work-item-task-area="true"
          className="grid w-full gap-2 text-left"
          onClick={() => props.onSelectWorkItem?.()}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              props.onSelectWorkItem?.();
            }
          }}
        >
          <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Tasks
          </span>
          {content}
        </div>
      );
    }

    return (
      <section className="grid gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Tasks
        </p>
        <TaskRowsContainer tasks={props.tasks} laneWorkItemCount={props.laneWorkItemCount}>
          <TaskPreviewRows tasks={props.tasks} isWorkItemSelectable={false} />
        </TaskRowsContainer>
      </section>
    );
  }

  const isOpen = props.defaultOpen ?? true;

  return (
    <details
      className="grid gap-2"
      open={isOpen}
      data-work-item-task-area={isWorkItemSelectable ? 'true' : undefined}
      onClick={props.onSelectWorkItem}
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Tasks
        </p>
      </summary>
      <TaskRowsContainer tasks={props.tasks} laneWorkItemCount={props.laneWorkItemCount}>
        <TaskPreviewRows tasks={props.tasks} isWorkItemSelectable={isWorkItemSelectable} />
      </TaskRowsContainer>
    </details>
  );
}

function TaskRowsContainer(props: {
  tasks: WorkflowTaskPreview[];
  laneWorkItemCount?: number;
  children: JSX.Element;
}): JSX.Element {
  const shouldBoundHeight = props.tasks.length > 4;
  const maxHeightClassName =
    props.laneWorkItemCount === 1
      ? 'grid max-h-[22rem] overflow-y-auto overscroll-contain pr-1'
      : 'grid max-h-[16rem] overflow-y-auto overscroll-contain pr-1';

  if (!shouldBoundHeight) {
    return <div className="mt-1">{props.children}</div>;
  }

  return (
    <div className="mt-1">
      <div className={maxHeightClassName} style={THEMED_SCROLL_STYLE}>
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
          {task.operatorSummary?.map((summaryLine) => (
            <span key={summaryLine} className="text-xs text-muted-foreground">
              {summaryLine}
            </span>
          ))}
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
