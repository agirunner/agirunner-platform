import { describe, expect, it } from 'vitest';

import { describeToolAccessScope, describeToolCategory } from './tools-page.support.js';

describe('tools page support', () => {
  it('uses restrained badge styling for access scopes', () => {
    expect(
      describeToolAccessScope({
        id: 'orchestrator-tool',
        name: 'Orchestrator Tool',
        access_scope: 'orchestrator_only',
        is_callable: true,
      }),
    ).toMatchObject({
      badgeVariant: 'outline',
      badgeClassName: expect.stringContaining('bg-slate-700 text-white'),
    });

    expect(
      describeToolAccessScope({
        id: 'shared-tool',
        name: 'Shared Tool',
        access_scope: 'specialist_and_orchestrator',
        is_callable: true,
      }),
    ).toMatchObject({
      badgeVariant: 'outline',
      badgeClassName: expect.stringContaining('bg-slate-700 text-white'),
    });
  });

  it('uses restrained badge styling for tool categories', () => {
    expect(describeToolCategory('workflow')).toMatchObject({
      badgeVariant: 'outline',
      badgeClassName: expect.stringContaining('bg-slate-700 text-white'),
    });

    expect(describeToolCategory('files')).toMatchObject({
      badgeVariant: 'outline',
      badgeClassName: expect.stringContaining('bg-slate-700 text-white'),
    });
  });
});
