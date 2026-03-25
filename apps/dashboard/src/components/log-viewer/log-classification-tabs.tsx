import { cn } from '../../lib/utils.js';

export interface LogClassification {
  id: string;
  label: string;
  categories: string[];
}

export const LOG_CLASSIFICATIONS: LogClassification[] = [
  { id: 'all', label: 'All', categories: [] },
  { id: 'execution', label: 'Execution', categories: ['llm', 'tool', 'agent_loop'] },
  { id: 'lifecycle', label: 'Lifecycle', categories: ['task_lifecycle', 'runtime_lifecycle'] },
  { id: 'infrastructure', label: 'Infrastructure', categories: ['container'] },
  { id: 'platform', label: 'Platform', categories: ['api', 'config', 'auth'] },
];

export function resolveActiveTab(categories: string[]): string {
  if (categories.length === 0) return 'all';
  const sorted = [...categories].sort().join(',');
  for (const cls of LOG_CLASSIFICATIONS) {
    if (cls.categories.length > 0 && [...cls.categories].sort().join(',') === sorted) {
      return cls.id;
    }
  }
  return 'all';
}

interface LogClassificationTabsProps {
  activeCategories: string[];
  onChange: (categories: string[]) => void;
}

export function LogClassificationTabs({
  activeCategories,
  onChange,
}: LogClassificationTabsProps): JSX.Element {
  const activeTab = resolveActiveTab(activeCategories);

  return (
    <div
      className="flex flex-wrap gap-1 rounded-xl border border-border/70 bg-card/80 p-1 shadow-sm"
      role="tablist"
    >
      {LOG_CLASSIFICATIONS.map((cls) => (
        <button
          key={cls.id}
          type="button"
          role="tab"
          aria-selected={activeTab === cls.id}
          className={cn(
            'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
            activeTab === cls.id
              ? 'border-sky-600 bg-sky-600 text-white shadow-sm dark:border-sky-400 dark:bg-sky-400 dark:text-sky-950'
              : 'border-transparent text-foreground/80 hover:border-border/80 hover:bg-accent/70 hover:text-foreground dark:text-foreground/75 dark:hover:bg-accent/60',
          )}
          onClick={() => onChange(cls.categories)}
        >
          {cls.label}
        </button>
      ))}
    </div>
  );
}
