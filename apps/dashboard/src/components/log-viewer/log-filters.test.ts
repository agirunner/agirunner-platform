import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(fileName: string): string {
  return readFileSync(resolve(import.meta.dirname, fileName), 'utf8');
}

describe('log filters source', () => {
  it('exposes actor and status controls while hiding transport-detail controls in the raw logs filter bar', () => {
    const source = readSource('./log-filters.tsx');
    expect(source).toContain('const [isRoleMenuOpen, setRoleMenuOpen] = useState(false);');
    expect(source).toContain('const [isActorMenuOpen, setActorMenuOpen] = useState(false);');
    expect(source).toContain('const [isOperationMenuOpen, setIsOperationMenuOpen] = useState(false);');
    expect(source).toContain('buildFilterOptionScope(filters, scope)');
    expect(source).toContain('useLogActors(');
    expect(source).toContain('isActorMenuOpen && !actorItemsOverride && !disableOptionQueries');
    expect(source).toContain('isRoleMenuOpen && !roleItemsOverride && !disableOptionQueries');
    expect(source).toContain('isOperationMenuOpen && !operationItemsOverride && !disableOptionQueries');
    expect(source).toContain("placeholder={\n            filters.actors.length > 0");
    expect(source).toContain('allGroupLabel="Actors"');
    expect(source).toContain('allGroupLabel="Statuses"');
    expect(source).not.toContain('allGroupLabel="Execution backend"');
    expect(source).not.toContain('allGroupLabel="Tool owner"');
    expect(source).not.toContain('allGroupLabel="Sources"');
    expect(source).not.toContain('Execution backend');
    expect(source).not.toContain('Tool owner');
    expect(source).not.toContain('Sources');
  });

  it('keeps a visible reset button in the top filter row', () => {
    const source = readSource('./log-filters.tsx');

    expect(source).toContain('<RotateCcw className="h-4 w-4" />');
    expect(source).toContain('Reset');
    expect(source).toContain('onClick={resetFilters}');
  });

  it('debounces text filter inputs to avoid per-keystroke refetches', () => {
    const source = readSource('./log-filters.tsx');

    // Search is debounced
    expect(source).toContain('searchDraft');
    expect(source).toContain('useDebounced(searchDraft');
    expect(source).not.toContain('workItemDraft');
    expect(source).not.toContain('stageDraft');
    expect(source).not.toContain('activationDraft');
    expect(source).not.toContain('placeholder="Work item ID"');
    expect(source).not.toContain('placeholder="Stage name"');
    expect(source).not.toContain('placeholder="Activation ID"');

    // Combobox/select controls remain immediate
    expect(source).toContain('onChange={toggleRole}');
    expect(source).toContain('onChange={toggleActor}');
    expect(source).toContain('onChange={toggleOperation}');
  });

  it('can reuse already-fetched option lists instead of always re-querying them', () => {
    const source = readSource('./log-filters.tsx');

    expect(source).toContain('operationItemsOverride?: ComboboxItem[];');
    expect(source).toContain('roleItemsOverride?: ComboboxItem[];');
    expect(source).toContain('actorItemsOverride?: ComboboxItem[];');
    expect(source).toContain('const operationItems = operationItemsOverride ?? toOperationItems(operationsData);');
    expect(source).toContain('const roleItems = roleItemsOverride ?? toRoleItems(rolesData);');
    expect(source).toContain('const actorItems = actorItemsOverride ?? toActorItems(actorsData);');
    expect(source).toContain('onOpenChange={setRoleMenuOpen}');
    expect(source).toContain('onOpenChange={setActorMenuOpen}');
    expect(source).toContain('onOpenChange={setIsOperationMenuOpen}');
    expect(source).toContain('disableOptionQueries = false');
  });

  it('serializes source and status filters into log query params', () => {
    const source = readSource('./hooks/use-log-filters.ts');
    expect(source).toContain("statuses: parseList(searchParams.get('status'))");
    expect(source).toContain("actors: parseList(searchParams.get('actor_kind') ?? searchParams.get('actor_type') ?? searchParams.get('actor'))");
    expect(source).toContain("executionEnvironment: searchParams.get('execution_environment') ?? ''");
    expect(source).toContain("if (filters.statuses.length > 0) params.status = filters.statuses.join(',');");
    expect(source).toContain("sources: parseList(searchParams.get('source'))");
    expect(source).toContain("executionBackend: parseList(searchParams.get('execution_backend'))");
    expect(source).toContain("toolOwner: parseList(searchParams.get('tool_owner'))");
    expect(source).toContain("if (filters.actors.length > 0) params.actor_kind = filters.actors.join(',');");
    expect(source).toContain('if (filters.executionEnvironment) params.execution_environment = filters.executionEnvironment;');
    expect(source).toContain('params.execution_backend = filters.executionBackend.join');
    expect(source).toContain('params.tool_owner = filters.toolOwner.join');
    expect(source).not.toContain('params.work_item_id = filters.workItem');
    expect(source).not.toContain('params.stage_name = filters.stage');
    expect(source).not.toContain('params.activation_id = filters.activation');
  });

  it('surfaces an execution environment text filter without reintroducing transport-detail comboboxes', () => {
    const source = readSource('./log-filters.tsx');

    expect(source).toContain('environmentDraft');
    expect(source).toContain("placeholder=\"Execution environment\"");
    expect(source).toContain("setFilter('executionEnvironment'");
    expect(source).not.toContain('allGroupLabel="Execution environment"');
  });

  it('renders combobox option labels with explicit foreground text so multi-select rows stay visible in dark theme', () => {
    const source = readSource('./ui/searchable-combobox.tsx');

    expect(source).toContain('className="truncate text-foreground"');
    expect(source).toContain("'truncate text-xs text-muted'");
  });
});
