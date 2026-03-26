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
      badgeClassName: expect.stringContaining('bg-amber-100 text-amber-900'),
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
      badgeClassName: expect.stringContaining('bg-indigo-100 text-indigo-900'),
    });

    expect(
      describeToolAccessScope({
        id: 'provider-tool',
        name: 'Provider Tool',
        usage_surface: 'provider_capability',
        is_callable: false,
      }),
    ).toMatchObject({
      badgeVariant: 'outline',
      badgeClassName: expect.stringContaining('bg-sky-100 text-sky-900'),
    });
  });

  it('uses differentiated badge styling for tool categories in light mode', () => {
    expect(describeToolCategory('workflow')).toMatchObject({
      badgeVariant: 'outline',
      badgeClassName: expect.stringContaining('bg-amber-100 text-amber-900'),
    });

    expect(describeToolCategory('files')).toMatchObject({
      badgeVariant: 'outline',
      badgeClassName: expect.stringContaining('bg-indigo-100 text-indigo-900'),
    });

    expect(describeToolCategory('search')).toMatchObject({
      badgeVariant: 'outline',
      badgeClassName: expect.stringContaining('bg-sky-100 text-sky-900'),
    });

    expect(describeToolCategory('execution')).toMatchObject({
      badgeVariant: 'outline',
      badgeClassName: expect.stringContaining('bg-emerald-100 text-emerald-900'),
    });
  });
});
