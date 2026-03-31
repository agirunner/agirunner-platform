import { describe, expect, it } from 'vitest';

import { parseBenchmarkLoadArgs } from './benchmark-load.js';

describe('parseBenchmarkLoadArgs', () => {
  it('uses seeded benchmark defaults that stay non-live and repeatable', () => {
    expect(parseBenchmarkLoadArgs([])).toEqual({
      workflows: 10000,
      turns: 2,
      briefs: 1,
      workItems: 3,
      tasks: 4,
      deliverables: 2,
      reloads: 3,
      reset: true,
      lifecycle: 'mixed',
      skipSeed: false,
    });
  });

  it('accepts perf overrides without enabling live workflow execution', () => {
    expect(
      parseBenchmarkLoadArgs([
        '--workflows',
        '15000',
        '--turns',
        '8',
        '--briefs',
        '3',
        '--work-items',
        '5',
        '--tasks',
        '7',
        '--deliverables',
        '4',
        '--reloads',
        '5',
        '--lifecycle',
        'ongoing',
        '--skip-seed',
        '--no-reset',
      ]),
    ).toEqual({
      workflows: 15000,
      turns: 8,
      briefs: 3,
      workItems: 5,
      tasks: 7,
      deliverables: 4,
      reloads: 5,
      reset: false,
      lifecycle: 'ongoing',
      skipSeed: true,
    });
  });
});
