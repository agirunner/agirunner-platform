import { describe, expect, it } from 'vitest';

import type { DashboardPlaybookRecord } from '../../lib/api.js';
import { readWorkflowsRailPlaybooks } from './workflows-page.playbooks.js';

describe('workflows page playbooks', () => {
  it('reads the canonical playbook list payload shape for the rail filters', () => {
    const playbooks = [createPlaybook({ id: 'playbook-1', name: 'Requirements Review' })];

    expect(readWorkflowsRailPlaybooks({ data: playbooks })).toEqual(playbooks);
    expect(readWorkflowsRailPlaybooks(undefined)).toEqual([]);
  });
});

function createPlaybook(
  overrides: Partial<DashboardPlaybookRecord> & Pick<DashboardPlaybookRecord, 'id' | 'name'>,
): DashboardPlaybookRecord {
  const { id, name, ...rest } = overrides;
  return {
    id,
    name,
    slug: `${name.toLowerCase().replaceAll(/\s+/g, '-')}-${id}`,
    outcome: 'Review requirements and capture the decision.',
    lifecycle: 'planned',
    version: 1,
    definition: {},
    ...rest,
  };
}
