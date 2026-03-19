import { formatElapsed } from './workflow-detail-panel-support.js';

export interface TaskCard {
  id: string;
  title: string;
  role?: string;
  state: string;
  columnId: string;
  elapsedMs?: number;
}

export interface BoardColumn {
  id: string;
  name: string;
  isTerminal?: boolean;
}

interface TaskKanbanProps {
  columns: BoardColumn[];
  tasks: TaskCard[];
  onSelectTask: (taskId: string, taskTitle: string) => void;
}

const KNOWN_ROLES = new Set([
  'developer',
  'reviewer',
  'architect',
  'qa',
  'product-manager',
  'orchestrator',
]);

export function getRoleAccentVar(role?: string): string {
  if (role !== undefined && KNOWN_ROLES.has(role)) {
    return `var(--role-${role})`;
  }
  return 'var(--color-text-muted)';
}

export function groupTasksByColumn(
  tasks: TaskCard[],
  columns: BoardColumn[],
): Map<string, TaskCard[]> {
  const grouped = new Map<string, TaskCard[]>();
  for (const column of columns) {
    grouped.set(column.id, []);
  }
  for (const task of tasks) {
    const bucket = grouped.get(task.columnId);
    if (bucket !== undefined) {
      bucket.push(task);
    }
  }
  return grouped;
}

function TaskCardItem({
  task,
  onSelect,
}: {
  task: TaskCard;
  onSelect: () => void;
}) {
  const accentColor = getRoleAccentVar(task.role);
  return (
    <button
      onClick={onSelect}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '8px 10px',
        marginBottom: '6px',
        borderRadius: '6px',
        border: '1px solid var(--color-border-subtle)',
        backgroundColor: 'var(--color-bg-primary)',
        cursor: 'pointer',
        borderLeft: `3px solid ${accentColor}`,
        fontFamily: 'inherit',
        transition: 'var(--transition-fast)',
      }}
    >
      <div style={{
        fontSize: '12px',
        fontWeight: 500,
        color: 'var(--color-text-primary)',
        marginBottom: '4px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {task.title}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
        <span style={{
          fontSize: '10px',
          padding: '1px 5px',
          borderRadius: '4px',
          backgroundColor: 'var(--color-bg-secondary)',
          color: 'var(--color-text-secondary)',
        }}>
          {task.state}
        </span>
        {task.role && (
          <span style={{
            fontSize: '10px',
            color: accentColor,
          }}>
            {task.role}
          </span>
        )}
        {task.elapsedMs !== undefined && (
          <span style={{
            fontSize: '10px',
            color: 'var(--color-text-tertiary)',
            marginLeft: 'auto',
          }}>
            {formatElapsed(task.elapsedMs)}
          </span>
        )}
      </div>
    </button>
  );
}

function KanbanColumn({
  column,
  tasks,
  onSelectTask,
}: {
  column: BoardColumn;
  tasks: TaskCard[];
  onSelectTask: (taskId: string, taskTitle: string) => void;
}) {
  return (
    <div
      data-testid={`kanban-column-${column.id}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        opacity: column.isTerminal ? 0.7 : 1,
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 8px',
        marginBottom: '8px',
        borderBottom: '1px solid var(--color-border-subtle)',
      }}>
        <span style={{
          fontSize: '11px',
          fontWeight: 600,
          color: 'var(--color-text-secondary)',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}>
          {column.name}
        </span>
        <span style={{
          fontSize: '10px',
          color: 'var(--color-text-tertiary)',
          backgroundColor: 'var(--color-bg-secondary)',
          padding: '1px 5px',
          borderRadius: '8px',
        }}>
          {tasks.length}
        </span>
      </div>
      <div>
        {tasks.map((task) => (
          <TaskCardItem
            key={task.id}
            task={task}
            onSelect={() => onSelectTask(task.id, task.title)}
          />
        ))}
      </div>
    </div>
  );
}

export function TaskKanban({ columns, tasks, onSelectTask }: TaskKanbanProps) {
  const grouped = groupTasksByColumn(tasks, columns);

  return (
    <div
      data-testid="task-kanban"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns.length}, 1fr)`,
        gap: '8px',
        padding: '12px',
        overflowX: 'auto',
        height: '100%',
      }}
    >
      {columns.map((column) => (
        <KanbanColumn
          key={column.id}
          column={column}
          tasks={grouped.get(column.id) ?? []}
          onSelectTask={onSelectTask}
        />
      ))}
    </div>
  );
}
