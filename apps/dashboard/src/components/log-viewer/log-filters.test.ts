import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(fileName: string): string {
  return readFileSync(resolve(import.meta.dirname, fileName), 'utf8');
}

describe('log filters source', () => {
  it('exposes actor, source, and status controls in the raw logs filter bar', () => {
    const source = readSource('./log-filters.tsx');
    expect(source).toContain('const optionBaseFilters = useMemo(');
    expect(source).toContain('applyLogScope(toQueryParams(), scope)');
    expect(source).toContain('delete next.operation;');
    expect(source).toContain('delete next.role;');
    expect(source).toContain('delete next.actor_kind;');
    expect(source).toContain('operationItemsOverride');
    expect(source).toContain('roleItemsOverride');
    expect(source).toContain('actorItemsOverride');
    expect(source).toContain('useLogActors(actorOptionFilters, !actorItemsOverride)');
    expect(source).toContain("placeholder={\n            filters.actors.length > 0");
    expect(source).toContain('allGroupLabel="Actors"');
    expect(source).toContain('allGroupLabel="Execution backend"');
    expect(source).toContain('allGroupLabel="Tool owner"');
    expect(source).toContain('allGroupLabel="Sources"');
    expect(source).toContain('allGroupLabel="Statuses"');
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

    expect(source).toContain('const operationItems = operationItemsOverride ?? toOperationItems(operationsData);');
    expect(source).toContain('const roleItems = roleItemsOverride ?? toRoleItems(rolesData);');
    expect(source).toContain('const actorItems = actorItemsOverride ?? toActorItems(actorsData);');
  });

  it('serializes source and status filters into log query params', () => {
    const source = readSource('./hooks/use-log-filters.ts');
    expect(source).toContain("statuses: parseList(searchParams.get('status'))");
    expect(source).toContain("actors: parseList(searchParams.get('actor_kind') ?? searchParams.get('actor_type') ?? searchParams.get('actor'))");
    expect(source).toContain("if (filters.statuses.length > 0) params.status = filters.statuses.join(',');");
    expect(source).toContain("sources: parseList(searchParams.get('source'))");
    expect(source).toContain("executionBackend: parseList(searchParams.get('execution_backend'))");
    expect(source).toContain("toolOwner: parseList(searchParams.get('tool_owner'))");
    expect(source).toContain("if (filters.actors.length > 0) params.actor_kind = filters.actors.join(',');");
    expect(source).toContain('params.execution_backend = filters.executionBackend.join');
    expect(source).toContain('params.tool_owner = filters.toolOwner.join');
    expect(source).not.toContain('params.work_item_id = filters.workItem');
    expect(source).not.toContain('params.stage_name = filters.stage');
    expect(source).not.toContain('params.activation_id = filters.activation');
  });
});
