import { describe, expect, it } from 'vitest';

import {
  buildProjectListPackets,
  formatProjectCreatedAt,
  normalizeProjects,
  statusVariant,
} from './project-list-page.support.js';

describe('project list page support', () => {
  it('builds operator summary packets for populated project lists', () => {
    const packets = buildProjectListPackets([
      {
        id: 'p1',
        name: 'Alpha',
        slug: 'alpha',
        description: 'Primary delivery workspace',
        is_active: true,
        repository_url: 'https://github.com/example/alpha',
        created_at: '2026-03-10T00:00:00.000Z',
      },
      {
        id: 'p2',
        name: 'Beta',
        slug: 'beta',
        description: '',
        is_active: false,
        repository_url: null,
        created_at: '2026-03-11T00:00:00.000Z',
      },
    ]);

    expect(packets[0]).toMatchObject({
      label: 'Workspace coverage',
      value: '2 projects',
    });
    expect(packets[1]).toMatchObject({
      label: 'Repository posture',
      value: '1 linked',
    });
    expect(packets[2].value).toBe('Fill missing project briefs');
  });

  it('keeps empty-state guidance explicit', () => {
    const packets = buildProjectListPackets([]);
    expect(packets[0].detail).toContain('Create the first project');
    expect(packets[2].value).toBe('Create a project');
  });

  it('normalizes list responses and formats simple helpers', () => {
    expect(
      normalizeProjects({
        data: [{ id: 'p1', name: 'Alpha', slug: 'alpha' }],
      } as never),
    ).toHaveLength(1);
    expect(statusVariant(true)).toBe('success');
    expect(statusVariant(false)).toBe('secondary');
    expect(formatProjectCreatedAt('2026-03-10T00:00:00.000Z')).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/);
    expect(formatProjectCreatedAt('invalid')).toBe('Created date unavailable');
  });
});
