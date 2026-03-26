import { z } from 'zod';

import type { DatabaseQueryable } from '../db/database.js';
import { ConflictError, NotFoundError } from '../errors/domain-errors.js';

const createSkillSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(120).optional(),
  summary: z.string().min(1).max(500),
  content: z.string().min(1),
}).strict();

const updateSkillSchema = createSkillSchema.partial();

interface SpecialistSkillRow {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  summary: string;
  content: string;
  is_archived: boolean;
  created_at: Date;
  updated_at: Date;
}

export type CreateSpecialistSkillInput = z.input<typeof createSkillSchema>;
export type UpdateSpecialistSkillInput = z.input<typeof updateSkillSchema>;
export type SpecialistSkillRecord = SpecialistSkillRow;

export class SpecialistSkillService {
  constructor(private readonly pool: DatabaseQueryable) {}

  async listSkills(tenantId: string, includeArchived = true): Promise<SpecialistSkillRecord[]> {
    const result = await this.pool.query<SpecialistSkillRow>(
      `SELECT *
         FROM specialist_skills
        WHERE tenant_id = $1
          ${includeArchived ? '' : 'AND is_archived = false'}
        ORDER BY name ASC`,
      [tenantId],
    );
    return result.rows;
  }

  async getSkill(tenantId: string, id: string): Promise<SpecialistSkillRecord> {
    const result = await this.pool.query<SpecialistSkillRow>(
      `SELECT *
         FROM specialist_skills
        WHERE tenant_id = $1
          AND id = $2
        LIMIT 1`,
      [tenantId, id],
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundError('Specialist skill not found');
    }
    return row;
  }

  async createSkill(tenantId: string, input: CreateSpecialistSkillInput): Promise<SpecialistSkillRecord> {
    const validated = createSkillSchema.parse(input);
    const slug = normalizeSlug(validated.slug ?? validated.name);
    await this.assertUniqueSlug(tenantId, slug);
    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO specialist_skills (tenant_id, name, slug, summary, content)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [tenantId, validated.name.trim(), slug, validated.summary.trim(), validated.content],
    ).catch(handleSkillWriteError);
    return this.getSkill(tenantId, result.rows[0].id);
  }

  async updateSkill(
    tenantId: string,
    id: string,
    input: UpdateSpecialistSkillInput,
  ): Promise<SpecialistSkillRecord> {
    const validated = updateSkillSchema.parse(input);
    const current = await this.getSkill(tenantId, id);
    const nextSlug =
      validated.slug !== undefined
        ? normalizeSlug(validated.slug)
        : validated.name !== undefined
          ? normalizeSlug(validated.name)
          : current.slug;
    if (nextSlug !== current.slug) {
      await this.assertUniqueSlug(tenantId, nextSlug, id);
    }
    const result = await this.pool.query(
      `UPDATE specialist_skills
          SET name = $3,
              slug = $4,
              summary = $5,
              content = $6,
              updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
        RETURNING id`,
      [
        tenantId,
        id,
        validated.name?.trim() ?? current.name,
        nextSlug,
        validated.summary?.trim() ?? current.summary,
        validated.content ?? current.content,
      ],
    ).catch(handleSkillWriteError);
    if (!result.rowCount) {
      throw new NotFoundError('Specialist skill not found');
    }
    return this.getSkill(tenantId, id);
  }

  async setArchived(tenantId: string, id: string, archived: boolean): Promise<SpecialistSkillRecord> {
    await this.getSkill(tenantId, id);
    const result = await this.pool.query(
      `UPDATE specialist_skills
          SET is_archived = $3,
              updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
        RETURNING id`,
      [tenantId, id, archived],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Specialist skill not found');
    }
    return this.getSkill(tenantId, id);
  }

  private async assertUniqueSlug(tenantId: string, slug: string, currentId?: string): Promise<void> {
    const result = await this.pool.query<{ id: string }>(
      `SELECT id
         FROM specialist_skills
        WHERE tenant_id = $1
          AND slug = $2
        LIMIT 1`,
      [tenantId, slug],
    );
    const row = result.rows[0];
    if (row && row.id !== currentId) {
      throw new ConflictError(`Specialist skill slug "${slug}" already exists`);
    }
  }
}

function normalizeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function handleSkillWriteError(error: unknown): never {
  if (error instanceof Error && /uq_specialist_skills_tenant_slug/i.test(error.message)) {
    throw new ConflictError('Specialist skill slug already exists');
  }
  throw error;
}
