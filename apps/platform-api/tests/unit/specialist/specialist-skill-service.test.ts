import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SpecialistSkillService } from '../../../src/services/specialist/specialist-skill-service.js';

function createMockPool() {
  return {
    query: vi.fn(),
  };
}

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const SKILL_ID = '00000000-0000-0000-0000-000000000101';

function buildSkillRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: SKILL_ID,
    tenant_id: TENANT_ID,
    name: 'Git Triage',
    slug: 'git-triage',
    summary: 'Handle git-oriented triage work',
    content: 'Review the repository state before changing code.',
    is_archived: false,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

describe('SpecialistSkillService', () => {
  let pool: ReturnType<typeof createMockPool>;
  let service: SpecialistSkillService;

  beforeEach(() => {
    pool = createMockPool();
    service = new SpecialistSkillService(pool as never);
  });

  it('lists specialist skills for a tenant', async () => {
    pool.query.mockResolvedValueOnce({ rows: [buildSkillRow()], rowCount: 1 });

    const result = await service.listSkills(TENANT_ID);

    expect(result).toEqual([
      expect.objectContaining({
        id: SKILL_ID,
        slug: 'git-triage',
        is_archived: false,
      }),
    ]);
  });

  it('creates a skill with a normalized slug', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ id: SKILL_ID }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [buildSkillRow()], rowCount: 1 });

    const result = await service.createSkill(TENANT_ID, {
      name: 'Git Triage',
      summary: 'Handle git-oriented triage work',
      content: 'Review the repository state before changing code.',
    });

    expect(result.slug).toBe('git-triage');
    expect(pool.query.mock.calls[1]?.[1]).toContain('git-triage');
  });

  it('deletes a skill after confirming it exists', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [buildSkillRow()], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: SKILL_ID }], rowCount: 1 });

    await service.deleteSkill(TENANT_ID, SKILL_ID);

    expect(pool.query).toHaveBeenCalledTimes(2);
    expect(pool.query.mock.calls[1]?.[0]).toContain('DELETE FROM specialist_skills');
    expect(pool.query.mock.calls[1]?.[1]).toEqual([TENANT_ID, SKILL_ID]);
  });
});
