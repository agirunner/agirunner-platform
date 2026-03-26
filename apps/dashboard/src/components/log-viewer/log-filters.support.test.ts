import { describe, expect, it } from 'vitest';

import { toActorItems, toOperationItems, toRoleItems } from './log-filters.support.js';

describe('log filter option mapping', () => {
  it('maps operation and role values without summary subtitles', () => {
    expect(
      toOperationItems({
        data: [{ operation: 'tool.shell_exec' }],
      }),
    ).toEqual([{ id: 'tool.shell_exec', label: 'tool.shell_exec' }]);

    expect(
      toRoleItems({
        data: [{ role: 'developer' }],
      }),
    ).toEqual([{ id: 'developer', label: 'Developer' }]);
  });

  it('maps only actual actor kinds without count-based subtitles', () => {
    expect(
      toActorItems({
        data: [{ actor_kind: 'orchestrator_agent' }],
      }),
    ).toEqual([{ id: 'orchestrator_agent', label: 'Orchestrator agent' }]);
  });
});
