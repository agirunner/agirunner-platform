import { describe, expect, it } from 'vitest';

import {
  buildTaskDetailHref,
  normalizeWorkflowBoardHref,
} from './work-href-support.js';

describe('work href support', () => {
  it('builds canonical task detail hrefs under /work/tasks', () => {
    expect(buildTaskDetailHref('task-1')).toBe('/work/tasks/task-1');
    expect(buildTaskDetailHref('task/with spaces')).toBe('/work/tasks/task%2Fwith%20spaces');
  });

  it('normalizes legacy mission-control workflow board hrefs to canonical /workflows links', () => {
    expect(
      normalizeWorkflowBoardHref({
        href: '/mission-control/workflows/workflow-child-2',
        workflowId: null,
      }),
    ).toBe('/workflows?workflow=workflow-child-2');
    expect(
      normalizeWorkflowBoardHref({
        href: '/workflows?workflow=workflow-child-2',
        workflowId: null,
      }),
    ).toBe('/workflows?workflow=workflow-child-2');
    expect(
      normalizeWorkflowBoardHref({
        href: null,
        workflowId: 'workflow-child-3',
      }),
    ).toBe('/workflows?workflow=workflow-child-3');
  });
});
