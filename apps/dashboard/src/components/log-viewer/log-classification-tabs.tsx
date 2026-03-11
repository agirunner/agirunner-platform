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
    <div className="flex gap-1 rounded-lg bg-muted/50 p-1" role="tablist">
      {LOG_CLASSIFICATIONS.map((cls) => (
        <button
          key={cls.id}
          type="button"
          role="tab"
          aria-selected={activeTab === cls.id}
          className={cn(
            'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
            activeTab === cls.id
              ? 'bg-surface text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-surface/50',
          )}
          onClick={() => onChange(cls.categories)}
        >
          {cls.label}
        </button>
      ))}
    </div>
  );
}
