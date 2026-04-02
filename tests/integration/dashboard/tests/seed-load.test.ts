import { describe, expect, it } from 'vitest';

import { parseSeedLoadArgs } from '../lib/seed-load.js';

describe('parseSeedLoadArgs', () => {
  it('reads the default seeded load configuration', () => {
    expect(parseSeedLoadArgs([])).toEqual({
      workflows: 10000,
      turns: 2,
      briefs: 1,
      workItems: 3,
      tasks: 4,
      deliverables: 2,
      reset: true,
      lifecycle: 'mixed',
    });
  });

  it('accepts explicit scale overrides for realistic corpus seeding', () => {
    expect(
      parseSeedLoadArgs([
        '--workflows',
        '12000',
        '--turns',
        '9',
        '--briefs',
        '4',
        '--work-items',
        '6',
        '--tasks',
        '9',
        '--deliverables',
        '5',
        '--lifecycle',
        'ongoing',
        '--no-reset',
      ]),
    ).toEqual({
      workflows: 12000,
      turns: 9,
      briefs: 4,
      workItems: 6,
      tasks: 9,
      deliverables: 5,
      reset: false,
      lifecycle: 'ongoing',
    });
  });
});
